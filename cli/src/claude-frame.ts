import { crc32, deflate } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(deflate);
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 2048;

export type ImageSource = { png: string } | { rgba: string; width: number; height: number };

function chunk(name: string, bytes: Buffer): Buffer {
  const result = Buffer.allocUnsafe(bytes.length + 12);
  result.writeUInt32BE(bytes.length, 0);
  result.write(name, 4, 4, "ascii");
  bytes.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}

export async function encodeFrame(pixels: Buffer, width: number, height: number): Promise<ImageSource> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new Error("invalid RGBA frame");
  }
  if (width <= MAX_SIDE && height <= MAX_SIDE) {
    const stride = width * 4;
    const scanlines = Buffer.allocUnsafe((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      const target = y * (stride + 1);
      scanlines[target] = 1;
      for (let x = 0; x < stride; x++) {
        scanlines[target + 1 + x] = pixels[y * stride + x] - (x >= 4 ? pixels[y * stride + x - 4] : 0);
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
      chunk("IDAT", await compress(scanlines, { level: 1 })), chunk("IEND", Buffer.alloc(0)),
    ]);
    if (png.length <= MAX_BYTES) return { png: png.toString("base64") };
  }
  const scale = Math.min(1, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_BYTES / (width * height * 4)));
  const outputWidth = Math.max(1, Math.floor(width * scale));
  const outputHeight = Math.max(1, Math.floor(height * scale));
  const rgba = Buffer.allocUnsafe(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const source = (Math.min(height - 1, Math.floor((y + 0.5) * height / outputHeight)) * width
        + Math.min(width - 1, Math.floor((x + 0.5) * width / outputWidth))) * 4;
      pixels.copy(rgba, (y * outputWidth + x) * 4, source, source + 4);
    }
  }
  return { rgba: rgba.toString("base64"), width: outputWidth, height: outputHeight };
}
