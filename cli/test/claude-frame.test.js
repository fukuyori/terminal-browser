const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomBytes } = require("node:crypto");
const { inflateSync, crc32 } = require("node:zlib");
const { encodeFrame } = require("../dist/claude-frame.js");

test("PNG frames preserve RGBA pixels and dimensions", async () => {
  const width = 41, height = 19;
  const pixels = randomBytes(width * height * 4);
  const source = await encodeFrame(pixels, width, height);
  const png = Buffer.from(source.png, "base64");
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const data = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), name = png.toString("ascii", at + 4, at + 8);
    assert.equal(png.readUInt32BE(at + 8 + length), crc32(png.subarray(at + 4, at + 8 + length)));
    if (name === "IHDR") { assert.equal(png.readUInt32BE(at + 8), width); assert.equal(png.readUInt32BE(at + 12), height); }
    if (name === "IDAT") data.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const scanlines = inflateSync(Buffer.concat(data)), restored = Buffer.alloc(pixels.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    assert.equal(scanlines[y * (stride + 1)], 1);
    for (let x = 0; x < stride; x++) restored[y * stride + x] = scanlines[y * (stride + 1) + 1 + x] + (x >= 4 ? restored[y * stride + x - 4] : 0);
  }
  assert.deepEqual(restored, pixels);
});

test("incompressible frames fit the inline Image limit without changing the input buffer", async () => {
  const width = 1000, height = 1000;
  const pixels = randomBytes(width * height * 4), before = Buffer.from(pixels);
  const source = await encodeFrame(pixels, width, height);
  assert.ok(source.rgba);
  const rgba = Buffer.from(source.rgba, "base64");
  assert.ok(rgba.length <= 2 * 1024 * 1024);
  assert.equal(rgba.length, source.width * source.height * 4);
  const x = Math.floor(0.5 * width / source.width), y = Math.floor(0.5 * height / source.height);
  assert.deepEqual(rgba.subarray(0, 4), pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
  assert.deepEqual(pixels, before);
});

test("long narrow frames also stay within Image dimension limits", async () => {
  const source = await encodeFrame(Buffer.alloc(4096 * 64 * 4, 255), 4096, 64);
  assert.equal(source.width, 2048);
  assert.equal(source.height, 32);
  await assert.rejects(encodeFrame(Buffer.alloc(3), 1, 1), /invalid RGBA/);
});
