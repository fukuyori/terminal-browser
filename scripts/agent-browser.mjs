import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ref = "v0.33.0";

if (process.argv.includes("--ref")) {
  process.stdout.write(`${ref}\n`);
  process.exit(0);
}

const known = new Set(["--path", "--force"]);
const unknown = process.argv.slice(2).find((arg) => !known.has(arg));
if (unknown) {
  process.stderr.write(`unknown option ${unknown}\n`);
  process.exit(2);
}

function cacheHome() {
  if (process.env.TERMINAL_BROWSER_AGENT_CACHE) {
    return path.resolve(process.env.TERMINAL_BROWSER_AGENT_CACHE);
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    return local && path.isAbsolute(local)
      ? path.join(local, "terminal-browser", "agent-browser")
      : path.join(os.homedir(), "AppData", "Local", "terminal-browser", "agent-browser");
  }
  const configured = process.env.XDG_CACHE_HOME;
  const base = configured && path.isAbsolute(configured) ? configured : path.join(os.homedir(), ".cache");
  return path.join(base, "terminal-browser", "agent-browser");
}

const root = path.join(cacheHome(), ref);
const binary = path.join(root, "bin", process.platform === "win32" ? "agent-browser.exe" : "agent-browser");
const force = process.argv.includes("--force");

if (!fs.existsSync(binary) || force) {
  process.stderr.write(`building agent-browser ${ref} (first run may take a few minutes)…\n`);
  const args = [
    "install",
    "--git",
    "https://github.com/vercel-labs/agent-browser",
    "--tag",
    ref,
    "--locked",
    "--root",
    root,
    ...(force ? ["--force"] : []),
    "agent-browser",
  ];
  const result = spawnSync("cargo", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fs.existsSync(binary)) {
  throw new Error(`cargo did not create ${binary}`);
}
process.stdout.write(`${binary}\n`);
