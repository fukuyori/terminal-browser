import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const browser = path.join(root, "browser");

if (process.platform !== "win32") {
  const result = spawnSync("bash", [path.join(root, "scripts", "fetch-electron.sh")], {
    cwd: root,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const require = createRequire(import.meta.url);
const packageFile = require.resolve("electron/package.json", { paths: [browser] });
const electronRoot = path.dirname(packageFile);
const executable = path.join(electronRoot, "dist", "electron.exe");

if (!fs.existsSync(executable)) {
  const result = spawnSync(process.execPath, [path.join(electronRoot, "install.js")], {
    cwd: electronRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fs.existsSync(executable)) {
  throw new Error(`Electron did not install ${executable}`);
}
