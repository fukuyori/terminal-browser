const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const main = path.resolve(__dirname, "../dist/main.js");
const fixture = path.join(__dirname, "fixtures/lifecycle-daemon.cjs");

function ask(port, route, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: route,
      method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer secret-test-token" } }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => text += chunk);
      response.on("end", () => resolve(JSON.parse(text)));
    });
    request.on("error", reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function until(check) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for lifecycle evidence");
}

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-lifecycle-chain-"));
  const state = path.join(root, "state");
  const env = { ...process.env, XDG_STATE_HOME: state, XDG_RUNTIME_DIR: state,
    XDG_DATA_HOME: path.join(root, "data"), GHOSTTY_SURFACE_ID: path.basename(root) };
  for (const key of ["WEZTERM_PANE", "TERMINAL_BROWSER_DIST_ROOT", "PIXEL_EMBED", "PIXEL_TTY"]) delete env[key];
  fs.mkdirSync(state);
  const children = [];
  let port;
  t.after(async () => {
    if (port) {
      await ask(port, "/close", {}).catch(() => {});
      await until(() => children.at(-1).exitCode !== null || children.at(-1).signalCode !== null).catch(() => {});
    }
    for (const child of children.reverse()) {
      if (child.exitCode === null && child.signalCode === null) {
        const done = once(child, "exit");
        child.kill();
        await done;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const daemon = spawn(process.execPath, [fixture], { env, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
  children.push(daemon);
  await once(daemon, "message");
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${path.basename(root)}` : path.join(root, "frame.sock");
  const bridge = spawn(process.execPath, [main, "claude-bridge", "serve", "--tty", "test-tty",
    "--socket", endpoint, "--token", "secret-test-token"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  children.push(bridge);
  let output = "";
  let stderr = "";
  bridge.stderr.on("data", chunk => stderr += chunk);
  daemon.stderr.on("data", chunk => stderr += chunk);
  bridge.stdout.on("data", chunk => output += chunk);
  await until(() => output.includes("\n") || (bridge.exitCode !== null && assert.fail(stderr)));
  port = JSON.parse(output.split("\n")[0]).port;
  const read = () => fs.readdirSync(state, { recursive: true })
    .filter(file => file.endsWith(".jsonl"))
    .flatMap(file => fs.readFileSync(path.join(state, file), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
  await ask(port, "/open", { url: "https://example.invalid/secret-page" });
  const attached = await until(() => read().find(r => r.event === "session attached"));
  assert.equal(attached.daemonPid, daemon.pid);
  assert.ok(read().some(r => r.component === "daemon" && r.event === "session opened" && r.session === attached.session));
  assert.ok(read().some(r => r.component === "bridge" && r.event === "browser child started" && r.childPid === attached.pid));
  return { daemon, bridge, port, attached, read };
}

for (const mode of ["close session", "exit daemon", "signal daemon"]) {
  test(`lifecycle distinguishes ${mode} across the real bridge, CLI and daemon`, { timeout: 15000 }, async t => {
    const { daemon, bridge, port, attached, read } = await setup(t);
    daemon.send(mode);
    await until(() => read().some(r => r.event === "browser child exited"));
    const records = read();
    const closed = mode !== "exit daemon";
    assert.ok(records.some(r => r.pid === attached.pid && r.event === (closed ? "session closed" : "daemon connection closed")));
    assert.ok(!records.some(r => r.pid === attached.pid && r.event === (closed ? "daemon connection closed" : "session closed")));
    const childExit = records.find(r => r.event === "browser child exited");
    assert.equal(childExit.childPid, attached.pid);
    assert.equal(childExit.code, 0);
    assert.equal(childExit.signal, null);
    assert.equal(childExit.stopping, false);
    if (mode === "exit daemon") assert.ok(records.some(r => r.pid === daemon.pid && r.event === "process exited" && r.code === 23));
    if (mode === "signal daemon") assert.ok(records.some(r => r.pid === daemon.pid && r.event === "signal received" && r.signal === "SIGTERM"));
    for (const record of records) {
      assert.ok(Number.isFinite(Date.parse(record.time)));
      assert.ok(record.pid > 0);
      assert.ok(record.run);
    }
    assert.ok(!JSON.stringify(records).includes("secret-test-token"));
    assert.ok(!JSON.stringify(records).includes("secret-page"));
    const state = await ask(port, "/state");
    assert.equal(state.alive, false);
    const stopped = once(bridge, "exit");
    await ask(port, "/close", {});
    assert.deepEqual(await stopped, [0, null]);
    assert.ok(read().some(r => r.event === "shutdown requested" && r.reason === "close request"));
  });
}

test("closing the bridge records child termination and daemon orphan cleanup", { timeout: 15000 }, async t => {
  const { bridge, port, attached, read } = await setup(t);
  const stopped = once(bridge, "exit");
  await ask(port, "/close", {});
  assert.deepEqual(await stopped, [0, null]);
  const records = read();
  assert.ok(records.some(r => r.event === "child termination requested" && r.childPid === attached.pid));
  assert.ok(records.some(r => r.event === "browser child exited" && r.stopping === true));
  await until(() => read().some(r => r.event === (process.platform === "win32" ? "closing orphan session" : "client requested close") && r.session === attached.session));
});
