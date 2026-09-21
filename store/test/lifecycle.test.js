const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const modulePath = path.resolve(__dirname, "../dist/lifecycle.js");

function run(t, tail, blocked = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-lifecycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = path.join(root, "state");
  if (blocked) fs.writeFileSync(state, "not a directory");
  const result = spawnSync(process.execPath, ["-e", `
    const {observeProcessExit, logLifecycle} = require(${JSON.stringify(modulePath)});
    observeProcessExit('cli');
    observeProcessExit('cli');
    ${tail}
  `], { env: { ...process.env, XDG_STATE_HOME: state }, encoding: "utf8", windowsHide: true, timeout: 10000 });
  const files = blocked ? [] : fs.readdirSync(state, { recursive: true }).filter(file => file.endsWith(".jsonl"));
  const records = files.flatMap(file => fs.readFileSync(path.join(state, file), "utf8").trim().split("\n").map(JSON.parse));
  return { result, files, records };
}

test("lifecycle records survive immediate exit without writing to stdout", t => {
  const { result, files, records } = run(t, "process.stdout.write('reply'); process.exit(7);");
  assert.equal(result.status, 7);
  assert.equal(result.stdout, "reply");
  assert.equal(files.length, 1);
  assert.deepEqual(records.map(r => r.event), ["process started", "process exited"]);
  assert.equal(records[1].code, 7);
  for (const record of records) {
    assert.equal(record.pid, result.pid);
    assert.equal(record.ppid, process.pid);
    assert.equal(record.run, records[0].run);
    assert.ok(Number.isFinite(Date.parse(record.time)));
  }
});

test("observing an uncaught exception does not suppress failure or record its contents", t => {
  const { result, records } = run(t, "throw new Error('secret-input-and-token');");
  assert.equal(result.status, 1);
  assert.ok(records.some(r => r.event === "uncaught exception" && r.origin === "uncaughtException"));
  assert.equal(records.at(-1).code, 1);
  assert.ok(!JSON.stringify(records).includes("secret-input-and-token"));
});

test("a log directory that cannot be created does not prevent exit", t => {
  const { result } = run(t, "process.stdout.write('reply'); process.exit(7);", true);
  assert.equal(result.status, 7);
  assert.equal(result.stdout, "reply");
});
