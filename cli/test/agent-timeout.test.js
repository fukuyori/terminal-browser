const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { agentTabs, runAgent } = require("../dist/action.js");

/**
 * Stands in for agent-browser without one running. A call named in `stall`
 * runs out of time the first time it is asked and answers on a later ask,
 * which is the shape of what was seen on Windows. Every call is recorded, so
 * a test can read back what was asked for and in what order.
 */
function fakeAgent({ stall = [], fail = [], tabs = [] } = {}) {
  const asked = [];
  const run = (_binary, args) => {
    const what = args
      .filter((arg, i) => !arg.startsWith("-") && args[i - 1] !== "--session" && args[i - 1] !== "--cdp")
      .join(" ");
    const firstTime = !asked.includes(what);
    asked.push(what);
    if (fail.some((name) => what.startsWith(name))) {
      return { status: 3, stdout: "", timedOut: false, ms: 5 };
    }
    if (stall.some((name) => what.startsWith(name)) && firstTime) {
      return { status: 1, stdout: "", timedOut: true, ms: 20_000 };
    }
    if (what.startsWith("tab list")) {
      return { status: 0, stdout: JSON.stringify({ data: { tabs } }), timedOut: false, ms: 12 };
    }
    return { status: 0, stdout: "{}", timedOut: false, ms: 8 };
  };
  return { run, asked };
}

const browser = { key: "test-browser", pid: 1234, cdpPort: 9222 };
const TAB = { tabId: "1", url: "https://example.com", title: "t", active: true };

test("a listing that runs out of time still reaches the reconnect", () => {
  const { run, asked } = fakeAgent({ stall: ["tab list"], tabs: [TAB] });
  const tabs = agentTabs("agent", browser, run);

  assert.deepEqual(
    tabs.map((tab) => tab.tabId),
    ["1"],
    "the tabs came back after the stall",
  );
  assert.deepEqual(
    asked,
    ["tab list", "connect 9222", "tab list"],
    "it reconnected between the two listings",
  );
});

test("a listing that answers at once is not asked twice", () => {
  const { run, asked } = fakeAgent({ tabs: [TAB] });
  const tabs = agentTabs("agent", browser, run);

  assert.equal(tabs.length, 1);
  assert.deepEqual(asked, ["tab list"], "no reconnect when none was needed");
});

test("a reconnect that runs out of time says so, with what it spent", () => {
  const { run, asked } = fakeAgent({ stall: ["tab list", "connect"], tabs: [TAB] });
  assert.throws(
    () => agentTabs("agent", browser, run),
    (error) => {
      assert.match(error.message, /did not answer/, error.message);
      assert.match(error.message, /attempts in \d+s/, error.message);
      return true;
    },
  );
  assert.deepEqual(asked, ["tab list", "connect 9222"], "it stopped rather than asking again");
});

test("a second listing that runs out of time says so too", () => {
  // Stall the listing every time: the reconnect works, the retry does not.
  const asked = [];
  const run = (_binary, args) => {
    const what = args
      .filter((arg, i) => !arg.startsWith("-") && args[i - 1] !== "--session" && args[i - 1] !== "--cdp")
      .join(" ");
    asked.push(what);
    if (what.startsWith("tab list")) return { status: 1, stdout: "", timedOut: true, ms: 20_000 };
    return { status: 0, stdout: "{}", timedOut: false, ms: 8 };
  };
  assert.throws(
    () => agentTabs("agent", browser, run),
    (error) => {
      assert.match(error.message, /did not answer "tab list"/, error.message);
      assert.match(error.message, /3 attempts in 40s/, error.message);
      return true;
    },
  );
  assert.deepEqual(asked, ["tab list", "connect 9222", "tab list"]);
});

test("a reconnect that refuses is reported as a refusal, not a timeout", () => {
  const { run } = fakeAgent({ stall: ["tab list"], fail: ["connect"] });
  assert.throws(
    () => agentTabs("agent", browser, run),
    (error) => {
      assert.match(error.message, /could not connect agent-browser/, error.message);
      assert.doesNotMatch(error.message, /did not answer/, error.message);
      return true;
    },
  );
});

/**
 * Calls `runAgent` in a child, because `runAgent` blocks on `spawnSync` and a
 * deadline inside this process could never fire while it did. The child is
 * given its own deadline, so a `runAgent` that stopped passing one along fails
 * this test rather than hanging the suite.
 */
function runAgentInChild({ script, deadlineMs, allowMs, tempDir }) {
  const driver = path.join(path.dirname(script), "driver.cjs");
  tempDir ??= path.join(path.dirname(script), "captures");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(
    driver,
    [
      `const { runAgent } = require(${JSON.stringify(path.resolve(__dirname, "..", "dist", "action.js"))});`,
      `process.env.TERMINAL_BROWSER_AGENT_TIMEOUT_MS = ${JSON.stringify(String(deadlineMs))};`,
      `const result = runAgent(process.execPath, [${JSON.stringify(script)}]);`,
      "process.stdout.write(JSON.stringify(result));",
    ].join("\n"),
  );
  const outcome = spawnSync(process.execPath, [driver], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: allowMs,
    env: { ...process.env, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir },
  });
  if (outcome.error?.code === "ETIMEDOUT") {
    assert.fail(`runAgent did not come back within ${allowMs}ms; it is not giving spawnSync a deadline`);
  }
  assert.equal(outcome.status, 0, outcome.stderr);
  assert.deepEqual(fs.readdirSync(tempDir), [], "agent output capture is cleaned up");
  return { ...JSON.parse(outcome.stdout), stderr: outcome.stderr };
}

test("runAgent returns while a Windows daemon still holds its output handles", { skip: process.platform !== "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-inherited-output-"));
  const captures = path.join(dir, "captures");
  const pidFile = path.join(dir, "daemon.pid");
  fs.mkdirSync(captures);
  try {
    const script = path.join(dir, "agent.cjs");
    fs.writeFileSync(script, [
      "const { spawn } = require('node:child_process');",
      "const daemon = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { detached: true, windowsHide: true, stdio: ['ignore', 1, 2] });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(daemon.pid));`,
      "daemon.unref();",
      `process.stdout.write(${JSON.stringify('日本語 stdout\n')});`,
      `process.stderr.write(${JSON.stringify('日本語 stderr\n')});`,
    ].join("\n"));
    const result = runAgentInChild({ script, deadlineMs: 1500, allowMs: 20000, tempDir: captures });
    assert.equal(result.timedOut, false);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "日本語 stdout\n");
    assert.ok(result.stderr.includes("日本語 stderr\n"));
    process.kill(Number(fs.readFileSync(pidFile, "utf8")), 0);
    assert.deepEqual(fs.readdirSync(captures), [], "capture files are removed while the daemon is alive");
  } finally {
    if (fs.existsSync(pidFile)) {
      try { process.kill(Number(fs.readFileSync(pidFile, "utf8"))); } catch {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function stallingScript(dir, extra = []) {
  const script = path.join(dir, "forever.cjs");
  fs.writeFileSync(script, [...extra, "process.stdout.write('x');", "setInterval(() => {}, 1000);"].join("\n"));
  return script;
}

test("runAgent gives up on a call that never answers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-stall-"));
  try {
    const result = runAgentInChild({
      script: stallingScript(dir),
      deadlineMs: 1500,
      allowMs: 20_000,
    });

    assert.equal(result.timedOut, true, "it reports running out of time, not a failure to start");
    assert.equal(result.status, 1, "a call that ran out of time did not succeed");
    assert.equal(result.stdout, "x", "what it managed to write is still there");
    assert.ok(result.ms >= 1000 && result.ms < 8000, `it waited ${result.ms}ms, about the deadline`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a deadline that is not a whole number of milliseconds is ignored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bad-deadline-"));
  try {
    // spawnSync refuses a fractional timeout, so a bad value has to fall back
    // to the default rather than reach it.
    const driver = path.join(dir, "driver.cjs");
    fs.writeFileSync(
      driver,
      [
        `const { runAgent } = require(${JSON.stringify(path.resolve(__dirname, "..", "dist", "action.js"))});`,
        `process.env.TERMINAL_BROWSER_AGENT_TIMEOUT_MS = process.argv[2];`,
        `const result = runAgent(process.execPath, ["-e", "process.stdout.write('ok')"]);`,
        "process.stdout.write(JSON.stringify(result));",
      ].join("\n"),
    );

    for (const asked of ["1.5", "-1", "0", "lots", ""]) {
      const outcome = spawnSync(process.execPath, [driver, asked], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
      });
      assert.equal(outcome.status, 0, `${JSON.stringify(asked)} threw: ${outcome.stderr}`);
      assert.deepEqual(JSON.parse(outcome.stdout).stdout, "ok", `with ${JSON.stringify(asked)}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runAgent still throws when the binary cannot be started", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-start-failure-"));
  const names = ["TEMP", "TMP", "TMPDIR"];
  const previous = names.map(name => process.env[name]);
  try {
    for (const name of names) process.env[name] = directory;
    const missing = path.join(directory, "no-such-agent-binary.exe");
    assert.throws(
      () => runAgent(missing, ["--session", "s", "tab", "list"]),
      (error) => {
        assert.equal(error.code, "ENOENT");
        return true;
      },
    );
    assert.deepEqual(fs.readdirSync(directory), [], "failed startup leaves no capture files");
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a call's own child does not hold the deadline open", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-kid-"));
  try {
    const pidFile = path.join(dir, "pid.txt");
    const script = stallingScript(dir, [
      "const { spawn } = require('node:child_process');",
      "const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(kid.pid));`,
    ]);

    const result = runAgentInChild({ script, deadlineMs: 1500, allowMs: 20_000 });
    assert.equal(result.timedOut, true);

    const kid = Number(fs.readFileSync(pidFile, "utf8"));
    let alive = true;
    try {
      process.kill(kid, 0);
    } catch {
      alive = false;
    }
    if (alive) {
      try {
        process.kill(kid);
      } catch {}
    }
    assert.equal(alive, false, "nothing of the timed-out call is left running");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
