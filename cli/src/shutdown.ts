import { control } from "./control";
import type { InstanceRecord } from "./registry";

const QUIT_REPLY_MS = 2000;
const QUIT_WAIT_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function gone(pid: number, within: number): Promise<boolean> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await sleep(100);
  }
  return false;
}

export interface QuitOutcome {
  quit: number[];
  killed: number[];
}

/**
 * Asks every browser to quit the way its quit key does, which puts each terminal
 * back, and kills only the ones still running after the wait.
 */
export async function quitBrowsers(
  records: Pick<InstanceRecord, "pid" | "socket">[],
  waitMs = QUIT_WAIT_MS,
): Promise<QuitOutcome> {
  await Promise.all(
    records.map((record) => control(record.socket, { cmd: "quit" }, QUIT_REPLY_MS).catch(() => null)),
  );
  const pids = [...new Set(records.map((record) => record.pid))];
  const stayed = (
    await Promise.all(pids.map(async (pid) => ((await gone(pid, waitMs)) ? null : pid)))
  ).filter((pid): pid is number => pid !== null);
  for (const pid of stayed) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  return { quit: pids.filter((pid) => !stayed.includes(pid)), killed: stayed };
}
