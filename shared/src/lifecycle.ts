import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LOGS_DIR } from "./paths";

type Component = "cli" | "daemon" | "bridge";
type Detail = Record<string, string | number | boolean | null | undefined>;

const run = crypto.randomUUID();
const file = path.join(LOGS_DIR, `lifecycle-${process.pid}-${run}.jsonl`);
const previous = file.replace(/\.jsonl$/, ".1.jsonl");
const observed = new Set<Component>();
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_RETAINED_BYTES = 32 * MAX_FILE_BYTES;
const MAX_RETAINED_FILES = 128;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;
const NAME = /^lifecycle-([1-9]\d*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.1)?\.jsonl$/;
let lastCleanup: number | undefined;

function processStopped(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function cleanup(exiting = false): void {
  try {
    const now = Date.now();
    if (!exiting && lastCleanup !== undefined && now - lastCleanup < CLEANUP_INTERVAL_MS) return;
    lastCleanup = now;
    const stopped = new Map<number, boolean>();
    const files: { path: string; size: number; modified: number }[] = [];
    for (const entry of fs.readdirSync(LOGS_DIR, { withFileTypes: true })) {
      const match = NAME.exec(entry.name);
      if (!entry.isFile() || !match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid)) continue;
      const own = pid === process.pid && match[2] === run;
      if (!(exiting && own)) {
        if (!stopped.has(pid)) stopped.set(pid, processStopped(pid));
        if (!stopped.get(pid)) continue;
      }
      try {
        const candidate = path.join(LOGS_DIR, entry.name);
        const stat = fs.lstatSync(candidate);
        if (stat.isFile()) files.push({ path: candidate, size: stat.size, modified: stat.mtimeMs });
      } catch {}
    }
    files.sort((a, b) => a.modified - b.modified || a.path.localeCompare(b.path));
    let count = files.length;
    let bytes = files.reduce((total, entry) => total + entry.size, 0);
    for (const entry of files) {
      if (now - entry.modified <= RETENTION_MS && count <= MAX_RETAINED_FILES && bytes <= MAX_RETAINED_BYTES) break;
      try {
        fs.unlinkSync(entry.path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
      }
      count--;
      bytes -= entry.size;
    }
  } catch {}
}

function fileSize(): number {
  try {
    return fs.statSync(file).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export function logLifecycle(component: Component, event: string, detail: Detail = {}): void {
  try {
    const identity = { time: new Date().toISOString(), pid: process.pid, ppid: process.ppid, run, component };
    let line = JSON.stringify({ ...detail, ...identity, event }) + "\n";
    const bytes = Buffer.byteLength(line);
    if (bytes > MAX_FILE_BYTES) {
      line = JSON.stringify({ ...identity, event: "oversized record omitted", bytes }) + "\n";
    }
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    if (fileSize() + Buffer.byteLength(line) > MAX_FILE_BYTES) {
      fs.renameSync(file, previous);
    }
    fs.appendFileSync(file, line, { encoding: "utf8", mode: 0o600 });
    cleanup();
  } catch {}
}

export function observeProcessExit(component: Component): void {
  if (observed.has(component)) return;
  observed.add(component);
  logLifecycle(component, "process started");
  process.on("exit", code => {
    logLifecycle(component, "process exited", { code });
    cleanup(true);
  });
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    logLifecycle(component, "uncaught exception", { origin, errorName: error.name });
  });
}
