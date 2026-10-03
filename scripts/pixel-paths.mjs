// Prints where browser/ resolves a part of pixel, for the build scripts.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "browser", "index.js"));
const pixelDir = path.dirname(require.resolve("@zenbu-labs/pixel/package.json"));

const what = process.argv[2];
if (what === "electron") {
  process.stdout.write(path.join(pixelDir, "electron", "dist"));
} else if (what === "native") {
  const target = `${process.platform}-${process.arch}`;
  const nested = createRequire(path.join(pixelDir, "index.js"));
  const manifest = nested.resolve(`@zenbu-labs/pixel-native-${target}/package.json`);
  process.stdout.write(fs.realpathSync(path.dirname(manifest)));
} else {
  process.stderr.write("usage: node scripts/pixel-paths.mjs electron|native\n");
  process.exit(2);
}
