const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { quitBrowsers } = require("../dist/shutdown.js");

const BROWSER = `
const net = require("node:net");
const [endpoint, mode] = process.argv.slice(1);
net.createServer((connection) => {
  let buffer = "";
  connection.on("data", (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf("\\n");
    if (newline < 0 || mode === "stubborn") return;
    const request = JSON.parse(buffer.slice(0, newline));
    if (request.cmd !== "quit") return;
    connection.end(JSON.stringify({ id: request.id, ok: true, data: {} }) + "\\n", () => process.exit(0));
  });
}).listen(endpoint, () => process.send("ready"));
`;

function endpoint(name) {
  const unique = `tb-shutdown-${process.pid}-${name}-${Math.random().toString(36).slice(2)}`;
  return process.platform === "win32"
    ? `\\\\.\\pipe\\${unique}`
    : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tb-shutdown-")), `${unique}.sock`);
}

async function browser(t, mode) {
  const socket = endpoint(mode);
  const child = spawn(process.execPath, ["-e", BROWSER, socket, mode], {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true,
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  await once(child, "message");
  return { child, record: { pid: child.pid, socket } };
}

test("a browser that honours quit ends by itself and is not killed", async (t) => {
  const { child, record } = await browser(t, "polite");
  const exited = once(child, "exit");
  const outcome = await quitBrowsers([record]);
  assert.deepEqual(outcome, { quit: [record.pid], killed: [] });
  const [code] = await exited;
  assert.equal(code, 0);
});

test("a browser that never answers is killed once the wait runs out", async (t) => {
  const { child, record } = await browser(t, "stubborn");
  const exited = once(child, "exit");
  const outcome = await quitBrowsers([record], 300);
  assert.deepEqual(outcome, { quit: [], killed: [record.pid] });
  await exited;
});

test("two browsers in one process count as one process", async (t) => {
  const { record } = await browser(t, "polite");
  const outcome = await quitBrowsers([record, { ...record }]);
  assert.deepEqual(outcome, { quit: [record.pid], killed: [] });
});

test("nothing registered means nothing to stop", async () => {
  assert.deepEqual(await quitBrowsers([]), { quit: [], killed: [] });
});
