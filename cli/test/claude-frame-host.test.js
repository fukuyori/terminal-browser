const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { ipcEndpoint } = require("pixel-store");
const { FrameHost } = require("../dist/claude-frame-host.js");

async function peer(endpoint) {
  const socket = net.connect(endpoint);
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  let buffer = "";
  const lines = [], waiters = [];
  socket.setEncoding("utf8");
  socket.on("data", chunk => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const value = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(value); else lines.push(value);
    }
  });
  return {
    send: value => socket.write(JSON.stringify(value) + "\n"),
    next: () => lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("missing host reply")), 3000);
      waiters.push(value => { clearTimeout(timer); resolve(value); });
    }),
    close: () => socket.destroy(),
  };
}

test("file frames are copied before acknowledgement and invalid paths do not poison the next frame", async () => {
  const name = `claude-frame-${process.pid}`;
  const endpoint = process.platform === "win32" ? ipcEndpoint(name) : path.join(os.tmpdir(), name + ".sock");
  const host = new FrameHost(endpoint, () => [16, 34]);
  const pictures = [], errors = [], peers = [];
  host.onMessage = message => { if (message.type === "join") host.send({ type: "init", cols: 1, rows: 1 }); };
  host.onFrame = frame => pictures.push(frame);
  host.onError = error => errors.push(error.message);
  host.listen();
  await new Promise(resolve => setImmediate(resolve));
  try {
    const control = await peer(endpoint); peers.push(control);
    control.send({ type: "join", pane: "p" });
    assert.equal((await control.next()).type, "init");
    const info = await peer(endpoint); peers.push(info);
    info.send({ id: "info", method: "pane.graphics.info" });
    const metadata = (await info.next()).result;
    assert.deepEqual(metadata.file_frame_formats, ["rgba"]);
    assert.equal(metadata.cell_width_px, 16);
    const stream = await peer(endpoint); peers.push(stream);
    stream.send({ id: "stream", method: "pane.graphics.stream", params: { pane_id: "p" } });
    assert.equal((await stream.next()).result.type, "ok");
    const file = path.join(metadata.file_frame_directory, "pixels");
    const bytes = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
    fs.writeFileSync(file, bytes);
    const frame = { format: "rgba", image_width: 2, image_height: 1, file: { path: file } };
    stream.send(frame);
    assert.equal((await stream.next()).result.type, "pane_graphics_frame_ack");
    fs.writeFileSync(file, Buffer.alloc(8));
    assert.deepEqual(pictures[0].pixels, bytes);
    stream.send({ ...frame, file: { path: __filename } });
    await stream.next();
    assert.match(errors[0], /outside its frame directory/);
    stream.send(frame);
    await stream.next();
    assert.deepEqual(pictures[1].pixels, Buffer.alloc(8));
    stream.send({ ...frame, image_height: 2 });
    await stream.next();
    assert.match(errors[1], /invalid browser frame size/);
  } finally {
    for (const connection of peers) connection.close();
    host.stop();
  }
  assert.equal(fs.existsSync(host.directory), false);
});
