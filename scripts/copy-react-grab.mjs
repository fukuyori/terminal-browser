import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const source = require.resolve("react-grab/dist/index.global.js", {
  paths: [path.join(root, "browser")],
});
const destination = path.join(root, "assets", "react-grab", "index.global.js");

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
