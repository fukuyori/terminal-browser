const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { ipcEndpoint } = require("pixel-store");

const windowsOnly = { skip: process.platform !== "win32", timeout: 20000 };
const fixture = path.join(__dirname, "fixtures", "bridge-launch.cjs");

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function consoleProcesses(pid) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-File", path.join(__dirname, "fixtures", "console-processes.ps1"),
    "-ProcessId", String(pid),
  ], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function holdConsole(t, pid) {
  const child = spawn("powershell.exe", [
    "-NoProfile", "-File", path.join(__dirname, "fixtures", "console-processes.ps1"),
    "-ProcessId", String(pid), "-Hold",
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (isRunning(child.pid)) child.kill(); });
  const ready = new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("console observer did not start")), 10000);
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("\n")) {
        clearTimeout(timer);
        resolve(JSON.parse(stdout));
      }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(stderr)); });
  });
  return { child, ready };
}

function startLauncher(t, detached = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tb-launch-test-"));
  const child = spawn(process.execPath, [fixture, home], {
    detached, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const ready = new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("launcher exited before starting")));
  });
  const finished = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      try {
        resolve({ code, report: JSON.parse(stdout.trim().split("\n").pop()), stderr });
      } catch {
        reject(new Error(`launcher returned no report: ${stderr}`));
      }
    });
  });
  finished.catch(() => {});
  t.after(async () => {
    if (isRunning(child.pid)) child.kill();
    await finished.catch(() => {});
    const root = path.resolve(home);
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("tb-launch-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { child, ready, finished };
}

async function checkEmbeddedEngine(t, pid) {
  const socket = ipcEndpoint(`launch-engine-test-${process.pid}`);
  const connections = new Set();
  const server = net.createServer((connection) => {
    connections.add(connection);
    connection.on("close", () => connections.delete(connection));
    connection.once("data", () => connection.write(JSON.stringify({
      type: "init", cols: 80, rows: 24, cell: [16, 34], transport: "file", imageId: 1,
    }) + "\n"));
  });
  t.after(() => {
    for (const connection of connections) connection.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
  const child = spawn(process.execPath, [path.join(__dirname, "fixtures", "engine-console.cjs"), String(pid), socket], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (isRunning(child.pid)) child.kill(); });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("embedded engine timed out")); }, 8000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(code, 0, stderr);
  assert.equal(stdout.trim(), "attached, guarded, released, reattached");
}

test("launch exits while the bridge keeps the caller's console and serves requests", windowsOnly, async (t) => {
  const launcher = startLauncher(t);
  await launcher.ready;
  const observer = holdConsole(t, launcher.child.pid);
  const originalMembers = await observer.ready;
  assert.ok(originalMembers.includes(launcher.child.pid));
  assert.ok(originalMembers.includes(observer.child.pid));
  launcher.child.send("launch");
  const { code, report } = await launcher.finished;
  assert.equal(code, 0, report.error);
  t.after(() => { if (isRunning(report.pid)) process.kill(report.pid); });
  assert.ok(!isRunning(launcher.child.pid));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(isRunning(report.pid), "serve must outlive launch");
  assert.ok(consoleProcesses(report.pid).includes(observer.child.pid), "serve must keep the caller's console");

  const headers = { authorization: `Bearer ${report.token}` };
  const base = `http://127.0.0.1:${report.port}`;
  const state = await fetch(`${base}/state`, { headers, signal: AbortSignal.timeout(3000) });
  assert.equal(state.status, 200);
  assert.equal((await state.json()).alive, false);
  await checkEmbeddedEngine(t, report.pid);
  const close = await fetch(`${base}/close`, { method: "POST", headers, signal: AbortSignal.timeout(3000) });
  assert.equal(close.status, 200);
  const deadline = Date.now() + 5000;
  while (isRunning(report.pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(!isRunning(report.pid), "serve must exit after /close");
  await assert.rejects(fetch(`${base}/state`, { headers, signal: AbortSignal.timeout(1000) }));
});

test("launch reports a console attachment failure without reporting a port", windowsOnly, async (t) => {
  const launcher = startLauncher(t, true);
  await launcher.ready;
  launcher.child.send("launch");
  const { code, report } = await launcher.finished;
  assert.equal(code, 1);
  assert.equal(report.code, "start");
  assert.match(report.error, /could not attach to the caller's console/);
  assert.equal(report.port, undefined);
});
