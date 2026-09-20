const assert = require("node:assert/strict");
const net = require("node:net");
const { test } = require("node:test");

const { DAEMON_SOCKET, consoleScope, daemonName, ipcEndpoint } = require("../dist/paths.js");

const windowsOnly = { skip: process.platform !== "win32" };

test("a terminal that names its pane gets a scope of its own", () => {
  assert.equal(consoleScope({ WEZTERM_PANE: "8" }), "8");
  assert.equal(consoleScope({ GHOSTTY_SURFACE_ID: "0xb352563abc664447" }), "0xb352563abc664447");
  assert.equal(consoleScope({ WT_SESSION: "a-b-c" }), "a-b-c");
});

test("two ghostty surfaces never share a scope", () => {
  const first = consoleScope({ GHOSTTY_SURFACE_ID: "0xaaa" });
  const second = consoleScope({ GHOSTTY_SURFACE_ID: "0xbbb" });
  assert.notEqual(first, second);
  assert.notEqual(daemonName({ GHOSTTY_SURFACE_ID: "0xaaa" }), daemonName({ GHOSTTY_SURFACE_ID: "0xbbb" }));
});

test("a terminal that names no pane falls back to one shared scope", () => {
  assert.equal(consoleScope({}), "default");
  assert.equal(consoleScope({ TERM_PROGRAM: "ghostty" }), "default");
});

test("wezterm wins over ghostty when a shell reports both", () => {
  assert.equal(consoleScope({ WEZTERM_PANE: "8", GHOSTTY_SURFACE_ID: "0xaaa" }), "8");
});

test("characters an endpoint name cannot carry are replaced", () => {
  assert.equal(consoleScope({ WT_SESSION: "{9c8f}\\pipe" }), "_9c8f__pipe");
});

test("the same name gives the same endpoint to whoever asks", () => {
  assert.equal(ipcEndpoint("instance-7"), ipcEndpoint("instance-7"));
  assert.notEqual(ipcEndpoint("instance-7"), ipcEndpoint("instance-8"));
});

test("the daemon endpoint is the one its scope names", windowsOnly, () => {
  assert.equal(DAEMON_SOCKET, ipcEndpoint(daemonName()));
  assert.ok(DAEMON_SOCKET.startsWith("\\\\.\\pipe\\"), DAEMON_SOCKET);
});

test("a caller reaches the endpoint a listener opened", async () => {
  const endpoint = ipcEndpoint(`selftest-${process.pid}`);
  const server = net.createServer((connection) => {
    connection.setEncoding("utf8");
    connection.once("data", (asked) => connection.end(`re:${asked.trim()}\n`));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, resolve);
  });
  try {
    const answer = await new Promise((resolve, reject) => {
      const client = net.connect(endpoint);
      client.setEncoding("utf8");
      client.once("error", reject);
      client.once("connect", () => client.write("hello\n"));
      let buffer = "";
      client.on("data", (chunk) => (buffer += chunk));
      client.once("close", () => resolve(buffer.trim()));
    });
    assert.equal(answer, "re:hello");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
