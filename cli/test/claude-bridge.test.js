const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { ipcEndpoint } = require("pixel-store");
const { clipboardWriter } = require("../dist/claude-bridge.js");

const MAIN = path.join(__dirname, "..", "dist", "main.js");
// Writing the clipboard replaces whatever the person had on it, and a copied
// image cannot be put back, so the end-to-end check is opt in.
const clipboardAllowed = {
  skip: process.platform !== "win32" || process.env.TB_TEST_CLIPBOARD !== "1",
};

function endpoint(name) {
  return process.platform === "win32"
    ? ipcEndpoint(name)
    : path.join(os.tmpdir(), `${name}.sock`);
}

function ask(port, token, method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: route,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve(JSON.parse(text || "{}")));
      },
    );
    request.once("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

/** Sends a request body one byte at a time, so multi-byte characters split. */
function askByteByByte(port, token, route, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: route,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": payload.length,
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve(JSON.parse(text || "{}")));
      },
    );
    request.once("error", reject);
    // Without this the bytes are coalesced and never split mid character.
    request.on("socket", (socket) => socket.setNoDelay(true));
    let at = 0;
    const next = () => {
      if (at >= payload.length) return request.end();
      request.write(payload.subarray(at, at + 1), () => {
        at += 1;
        setTimeout(next, 2);
      });
    };
    next();
  });
}

/** Starts the bridge's server half the way `launch` does, and waits for its port. */
function serve(tty, socket) {
  const token = "test-token";
  const child = spawn(
    process.execPath,
    [MAIN, "claude-bridge", "serve", "--tty", tty, "--transport", "file", "--socket", socket, "--cell", "", "--token", token],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const port = new Promise((resolve, reject) => {
    let line = "";
    const timer = setTimeout(() => reject(new Error(`no port; stderr: ${stderr}`)), 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      line += chunk;
      const at = line.indexOf("\n");
      if (at !== -1) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice(0, at)).port);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`serve exited with ${code}; stderr: ${stderr}`));
    });
  });
  return { child, token, port };
}

/** Plays the engine: joins, then keeps whatever lines the bridge sends back. */
function joinAsPixel(socket) {
  return new Promise((resolve, reject) => {
    const client = net.connect(socket);
    const lines = [];
    let buffer = "";
    client.setEncoding("utf8");
    client.once("error", reject);
    client.on("data", (chunk) => {
      buffer += chunk;
      let at = buffer.indexOf("\n");
      while (at !== -1) {
        lines.push(JSON.parse(buffer.slice(0, at)));
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf("\n");
      }
    });
    client.once("connect", () =>
      resolve({
        lines,
        /** Writes one byte at a time, so multi-byte characters split. */
        sendByteByByte(message) {
          const payload = Buffer.from(`${JSON.stringify(message)}\n`);
          return new Promise((done) => {
            let at = 0;
            const next = () => {
              if (at >= payload.length) return done();
              client.write(payload.subarray(at, at + 1), () => {
                at += 1;
                // Without a gap the bytes arrive as one read and never split.
                setTimeout(next, 2);
              });
            };
            next();
          });
        },
        end: () => client.end(),
      }),
    );
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

test("the bridge serves state over http and takes a pixel connection", async () => {
  const socket = endpoint(`cc-browser-test-${process.pid}`);
  const bridge = serve("test-tty", socket);
  try {
    const port = await bridge.port;
    const state = await ask(port, bridge.token, "GET", "/state");
    assert.equal(state.alive, false);
    assert.equal(state.inbox, 0);

    const pixel = await joinAsPixel(socket);
    await pixel.sendByteByByte({ type: "join", pane: "p", name: "n" });
    await settle();
    const init = pixel.lines.find((line) => line.type === "init");
    assert.ok(init, `no init in ${JSON.stringify(pixel.lines)}`);
    assert.equal(init.transport, "file");
    assert.ok(init.cols > 0 && init.rows > 0);
    pixel.end();

    const unauthorized = await ask(port, "wrong", "GET", "/state");
    assert.equal(unauthorized.error, "unauthorized");
  } finally {
    bridge.child.kill();
  }
});

test("a title split mid character arrives whole", async () => {
  const socket = endpoint(`cc-browser-title-${process.pid}`);
  const bridge = serve("test-tty", socket);
  const title = "日本語のタイトル — ＆ 記号";
  try {
    const port = await bridge.port;
    const pixel = await joinAsPixel(socket);
    await pixel.sendByteByByte({ type: "title", text: title });
    await settle();
    const state = await ask(port, bridge.token, "GET", "/state");
    assert.equal(state.title, title);
    pixel.end();
  } finally {
    bridge.child.kill();
  }
});

test("agent text split mid character arrives whole", async () => {
  const socket = endpoint(`cc-browser-text-${process.pid}`);
  const bridge = serve("test-tty", socket);
  const text = "日本語 メモ\n2行目 ＆ 記号";
  try {
    const port = await bridge.port;
    await askByteByByte(port, bridge.token, "/agent-text", { text });
    const taken = await ask(port, bridge.token, "POST", "/inbox/take");
    assert.deepEqual(taken.texts, [text]);
  } finally {
    bridge.child.kill();
  }
});

test("a path with spaces and non-ascii characters reaches the bridge intact", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc bridge-"));
  const tty = path.join(root, "日本語 パス", "tty");
  fs.mkdirSync(path.dirname(tty), { recursive: true });
  const socket =
    process.platform === "win32"
      ? endpoint(`cc-browser-space-${process.pid}`)
      : path.join(root, "s.sock");
  const bridge = serve(tty, socket);
  try {
    const port = await bridge.port;
    const state = await ask(port, bridge.token, "GET", "/state");
    assert.equal(state.error, null);
  } finally {
    bridge.child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("serve without its endpoint says so and stops", () => {
  const result = spawnSync(process.execPath, [MAIN, "claude-bridge", "serve"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /needs --tty and --socket/);
});

test("each platform's clipboard command gets the encoding it reads", () => {
  const text = "日本語テスト\n2行目\tタブ";
  const windows = clipboardWriter(text, "win32");
  assert.equal(windows.command, "clip.exe");
  assert.equal(windows.bytes.toString("utf16le"), text);
  assert.ok(!windows.bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])), "no byte order mark");

  const mac = clipboardWriter(text, "darwin");
  assert.equal(mac.command, "pbcopy");
  assert.equal(mac.bytes.toString("utf8"), text);

  assert.equal(clipboardWriter(text, "linux"), null);
});

/**
 * Reads and writes the clipboard through a file, so nothing rewrites line
 * endings or drops the trailing ones on the way.
 */
function clipboardFile(direction, file) {
  const script =
    direction === "save"
      ? `$t = Get-Clipboard -Raw; if ($null -eq $t) { $t = '' }; [IO.File]::WriteAllText('${file}', $t)`
      : `$t = [IO.File]::ReadAllText('${file}'); Set-Clipboard -Value $t`;
  const run = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  assert.equal(run.status, 0, `clipboard ${direction} failed: ${run.stderr}`);
}

test("a copy request reaches the clipboard whole", clipboardAllowed, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cc-clip-"));
  const kept = path.join(scratch, "before.txt");
  clipboardFile("save", kept);
  const before = fs.readFileSync(kept);

  const socket = endpoint(`cc-browser-clip-${process.pid}`);
  const bridge = serve("test-tty", socket);
  const text = "日本語テスト\n2行目 with spaces\tタブ";
  try {
    await bridge.port;
    const pixel = await joinAsPixel(socket);
    await pixel.sendByteByByte({ type: "clipboard", text });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const seen = path.join(scratch, "after.txt");
    clipboardFile("save", seen);
    assert.equal(fs.readFileSync(seen, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, ""), text);
    pixel.end();
  } finally {
    bridge.child.kill();
    clipboardFile("restore", kept);
    const back = path.join(scratch, "restored.txt");
    clipboardFile("save", back);
    const restored = fs.readFileSync(back);
    fs.rmSync(scratch, { recursive: true, force: true });
    assert.ok(restored.equals(before), "the clipboard did not come back as it was");
  }
});
