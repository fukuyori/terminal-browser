import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

import type { Pane } from "./terminal";

export interface CallerTty {
  path: string | null;
  denied: boolean;
}

/** Windows has one console device name, so name the pane to tell instances apart. */
export function windowsConsoleId(): string {
  const pane = process.env.WEZTERM_PANE ?? process.env.WT_SESSION ?? "default";
  return `CONIN$#${pane.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function callerTty(): CallerTty {
  if (process.platform === "win32") {
    const attached =
      process.env.WEZTERM_PANE !== undefined ||
      process.env.TERM_PROGRAM !== undefined ||
      process.env.WT_SESSION !== undefined;
    return {
      path: attached ? windowsConsoleId() : null,
      denied: false,
    };
  }
  let pid = process.pid;
  for (let hops = 0; hops < 30 && pid > 1; hops++) {
    let out: string;
    try {
      out = execFileSync("ps", ["-o", "ppid=,tty=", "-p", String(pid)], {
        encoding: "utf8",
      }).trim();
    } catch {
      return { path: null, denied: hops === 0 };
    }
    if (!out) return { path: null, denied: hops === 0 };
    const [ppid, tty] = out.split(/\s+/);
    if (tty && tty !== "??" && tty !== "?") return { path: `/dev/${tty}`, denied: false };
    pid = Number(ppid);
    if (!Number.isFinite(pid)) return { path: null, denied: false };
  }
  return { path: null, denied: false };
}


export function setPaneWorkingDirectory(tty: string, directory: string): void {
  const encoded = directory.split("/").map(encodeURIComponent).join("/");
  fs.writeFileSync(tty, `\x1b]7;file://${os.hostname()}${encoded}\x07`);
}

export async function paneById(
  panes: () => Promise<Pane[]>,
  id: string | null | undefined,
): Promise<Pane | null> {
  if (!id) return null;
  return (await panes()).find((pane) => pane.id === id) ?? null;
}

export function shellQuote(argv: string[]): string {
  return argv
    .map((arg) =>
      arg !== "" && /^[\w\-./:=+@%,]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
