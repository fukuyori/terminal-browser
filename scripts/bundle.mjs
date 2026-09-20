import fs from "node:fs";
import path from "node:path";

import { build } from "esbuild";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error("usage: node scripts/bundle.mjs <source> <destination>");
}

const root = path.resolve(import.meta.dirname, "..");
await build({
  entryPoints: [source],
  outfile: destination,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "*.node"],
  alias: {
    "pixel-react": path.join(root, "engine", "packages", "pixel-react", "src", "index.ts"),
    "pixel-terminals": path.join(root, "terminals", "src", "index.ts"),
    "pixel-store": path.join(root, "store", "src", "index.ts"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  sourcemap: true,
  logLevel: "warning",
});
fs.writeFileSync(path.join(path.dirname(destination), "package.json"), '{"type":"commonjs"}\n');
