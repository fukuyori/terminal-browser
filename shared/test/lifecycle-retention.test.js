const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { APP_DIR_NAME } = require("../dist/paths.js");
const modulePath = path.resolve(__dirname, "../dist/lifecycle.js");
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const prelude = `const {observeProcessExit, logLifecycle} = require(${JSON.stringify(modulePath)});`;
const deadPid = spawnSync(process.execPath, ["-e", ""], { windowsHide: true, timeout: 10000 }).pid;

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-log-retention-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const state = path.join(root, "state");
  const logs = path.join(state, APP_DIR_NAME, "logs");
  fs.mkdirSync(logs, { recursive: true });
  const env = { ...process.env, XDG_STATE_HOME: state };
  const run = script => {
    const result = spawnSync(process.execPath, ["-e", prelude + script], {
      env, encoding: "utf8", windowsHide: true, timeout: 15000,
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result;
  };
  const files = () => fs.readdirSync(logs).filter(name => name.startsWith("lifecycle-") && name.endsWith(".jsonl"));
  const recordFile = (pid = deadPid, size = 128, modified = Date.now(), previous = false) => {
    const name = `lifecycle-${pid}-${crypto.randomUUID()}${previous ? ".1" : ""}.jsonl`;
    const file = path.join(logs, name);
    fs.writeFileSync(file, "");
    fs.truncateSync(file, size);
    fs.utimesSync(file, new Date(modified), new Date(modified));
    return file;
  };
  const records = pid => files().filter(name => name.startsWith(`lifecycle-${pid}-`))
    .flatMap(name => fs.readFileSync(path.join(logs, name), "utf8").trim().split("\n").map(JSON.parse));
  return { root, logs, env, run, files, recordFile, records };
}

test("rotation keeps only two valid UTF-8 generations within 1 MiB each", t => {
  const w = workspace(t);
  const result = w.run(`
    observeProcessExit('cli');
    for (let index = 0; index < 85; index++) logLifecycle('cli', 'sample', {index, text: 'あ'.repeat(20000)});
  `);
  const files = w.files();
  assert.equal(files.length, 2);
  assert.equal(files.filter(name => name.endsWith(".1.jsonl")).length, 1);
  for (const file of files) assert.ok(fs.statSync(path.join(w.logs, file)).size <= MB);
  const records = w.records(result.pid);
  assert.ok(records.some(r => r.event === "sample" && r.index === 84));
  assert.ok(records.some(r => r.event === "process exited"));
  assert.ok(!records.some(r => r.event === "sample" && r.index === 0));
  for (const record of records.filter(r => r.event === "sample")) assert.equal(record.text, "あ".repeat(20000));
});

test("an oversized record is replaced by metadata and never breaks the file bound", t => {
  const w = workspace(t);
  const result = w.run(`
    observeProcessExit('cli');
    logLifecycle('cli', 'large', {text: 'sensitive'.repeat(200000)});
    logLifecycle('cli', 'after');
  `);
  const records = w.records(result.pid);
  assert.ok(records.some(r => r.event === "oversized record omitted" && r.bytes > MB));
  assert.ok(records.some(r => r.event === "after"));
  assert.ok(!JSON.stringify(records).includes("sensitive"));
  for (const file of w.files()) assert.ok(fs.statSync(path.join(w.logs, file)).size <= MB);
});

test("cleanup expires stopped processes only and leaves other files and directories alone", t => {
  const w = workspace(t);
  const old = w.recordFile(deadPid, 128, Date.now() - 8 * DAY);
  const recent = w.recordFile(deadPid, 128, Date.now() - 6 * DAY, true);
  const live = w.recordFile(process.pid, 128, Date.now() - 8 * DAY);
  const unknown = path.join(w.logs, "lifecycle-not-a-process.jsonl");
  const stderr = path.join(w.logs, "stderr.log");
  const directory = path.join(w.logs, `lifecycle-${deadPid}-${crypto.randomUUID()}.jsonl`);
  fs.writeFileSync(unknown, "keep");
  fs.writeFileSync(stderr, "keep");
  fs.mkdirSync(directory);
  w.run("observeProcessExit('cli');");
  assert.equal(fs.existsSync(old), false);
  for (const file of [recent, live, unknown, stderr, directory]) assert.equal(fs.existsSync(file), true);
});

test("stopped logs are reduced to 128 files including the process that is exiting", t => {
  const w = workspace(t);
  const seeded = Array.from({ length: 140 }, (_, index) => w.recordFile(deadPid, 128, Date.now() - DAY + index * 100));
  w.run("observeProcessExit('cli');");
  assert.equal(w.files().length, 128);
  for (const file of seeded.slice(0, 13)) assert.equal(fs.existsSync(file), false);
  for (const file of seeded.slice(13)) assert.equal(fs.existsSync(file), true);
});

test("the 32 MiB stopped-log cap deletes the oldest files before newer evidence", t => {
  const w = workspace(t);
  const seeded = Array.from({ length: 40 }, (_, index) => w.recordFile(deadPid, MB, Date.now() - DAY + index * 100, index % 2 === 0));
  w.run("observeProcessExit('cli');");
  const bytes = w.files().reduce((total, file) => total + fs.statSync(path.join(w.logs, file)).size, 0);
  assert.ok(bytes <= 32 * MB);
  for (const file of seeded.slice(0, 9)) assert.equal(fs.existsSync(file), false);
  for (const file of seeded.slice(9)) assert.equal(fs.existsSync(file), true);
});

test("failed deletion preserves application behavior and is retried on the next run", t => {
  const w = workspace(t);
  const denied = w.recordFile(deadPid, 128, Date.now() - 9 * DAY);
  const removable = w.recordFile(deadPid, 128, Date.now() - 8 * DAY);
  const result = w.run(`
    const fs = require('node:fs');
    const unlink = fs.unlinkSync;
    fs.unlinkSync = file => {
      if (file === ${JSON.stringify(denied)}) throw Object.assign(new Error('denied'), {code: 'EACCES'});
      return unlink(file);
    };
    observeProcessExit('cli');
    process.stdout.write('normal output');
  `);
  assert.equal(result.stdout, "normal output");
  assert.equal(fs.existsSync(denied), true);
  assert.equal(fs.existsSync(removable), false);
  assert.ok(w.records(result.pid).some(r => r.event === "process exited"));
  w.run("observeProcessExit('cli');");
  assert.equal(fs.existsSync(denied), false);
});

test("unknown process status is protected when probing returns EPERM", t => {
  const w = workspace(t);
  const protectedFile = w.recordFile(deadPid, 128, Date.now() - 8 * DAY);
  w.run(`
    const kill = process.kill;
    process.kill = (pid, signal) => {
      if (pid === ${deadPid}) throw Object.assign(new Error('denied'), {code: 'EPERM'});
      return kill(pid, signal);
    };
    observeProcessExit('cli');
  `);
  assert.equal(fs.existsSync(protectedFile), true);
});

test("failed rotation drops the write without exceeding the size cap and later recovers", t => {
  const w = workspace(t);
  const result = w.run(`
    observeProcessExit('cli');
    const fs = require('node:fs');
    for (let index = 0; index < 20; index++) logLifecycle('cli', 'sample', {index, text: 'x'.repeat(60000)});
    const dir = ${JSON.stringify(w.logs)};
    const previous = require('node:path').join(dir, fs.readdirSync(dir).find(name => name.endsWith('.1.jsonl')));
    const saved = fs.readFileSync(previous);
    const rename = fs.renameSync;
    fs.renameSync = () => { throw Object.assign(new Error('locked'), {code: 'EACCES'}); };
    for (let index = 0; index < 40; index++) logLifecycle('cli', 'sample', {index, text: 'x'.repeat(60000)});
    require('node:assert/strict').deepEqual(fs.readFileSync(previous), saved);
    fs.renameSync = rename;
    logLifecycle('cli', 'recovered', {text: 'x'.repeat(60000)});
  `);
  for (const file of w.files()) assert.ok(fs.statSync(path.join(w.logs, file)).size <= MB);
  assert.ok(w.records(result.pid).some(r => r.event === "recovered"));
  assert.ok(w.records(result.pid).some(r => r.event === "process exited"));
});

test("a long-running process cleans newly expired files on a later write", t => {
  const w = workspace(t);
  const old = path.join(w.logs, `lifecycle-${deadPid}-${crypto.randomUUID()}.jsonl`);
  w.run(`
    observeProcessExit('cli');
    const fs = require('node:fs');
    const file = ${JSON.stringify(old)};
    fs.writeFileSync(file, 'expired');
    fs.utimesSync(file, new Date(Date.now() - ${8 * DAY}), new Date(Date.now() - ${8 * DAY}));
    logLifecycle('cli', 'before cleanup interval');
    require('node:assert/strict').equal(fs.existsSync(file), true);
    const now = Date.now;
    Date.now = () => now() + 60001;
    logLifecycle('cli', 'after cleanup interval');
    require('node:assert/strict').equal(fs.existsSync(file), false);
    Date.now = now;
  `);
});

test("concurrent writers rotate independently and retain active files during cleanup", { timeout: 20000 }, async t => {
  const w = workspace(t);
  for (let index = 0; index < 180; index++) w.recordFile(deadPid, 128, Date.now() - DAY + index * 100);
  const protectedFile = w.recordFile(process.pid, 128, Date.now() - 8 * DAY);
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
  });
  await Promise.all(Array.from({ length: 4 }, async () => {
    const child = spawn(process.execPath, ["-e", prelude + `
      observeProcessExit('cli');
      for (let index = 0; index < 45; index++) logLifecycle('cli', 'sample', {index, text: 'x'.repeat(60000)});
      process.send('ready');
      process.on('message', () => process.exit(0));
    `], { env: w.env, stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
    children.push(child);
    assert.deepEqual(await once(child, "message"), ["ready", undefined]);
  }));
  const active = children.flatMap(child => w.files().filter(file => file.startsWith(`lifecycle-${child.pid}-`)));
  assert.equal(active.length, 8);
  for (const name of active) fs.utimesSync(path.join(w.logs, name), new Date(Date.now() - 8 * DAY), new Date(Date.now() - 8 * DAY));
  w.run("observeProcessExit('cli');");
  for (const name of active) assert.equal(fs.existsSync(path.join(w.logs, name)), true);
  assert.equal(fs.existsSync(protectedFile), true);
  await Promise.all(children.map(async child => {
    const exited = once(child, "exit");
    child.send("exit");
    assert.deepEqual(await exited, [0, null]);
  }));
  w.run("observeProcessExit('cli');");
  assert.ok(w.files().length <= 129);
  for (const child of children) {
    assert.ok(w.records(child.pid).some(record => record.event === "process exited"));
  }
});
