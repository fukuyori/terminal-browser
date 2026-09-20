import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AGENT_SOCKETS_DIR } from "pixel-store";
import type { Terminal } from "@zenbu-labs/pixel/terminal";

import { control } from "./control";
import { browsers, describe, recordKey, targets } from "./instances";
import type { Browser, TabTarget } from "./instances";

const DIST_ROOT = process.env.TERMINAL_BROWSER_DIST_ROOT ?? null;

interface AgentTab {
  tabId: string;
  url: string;
  title: string;
  active: boolean;
}

interface Selection {
  browser: Browser;
  tab: TabTarget;
}

export interface ActionOptions {
  browserKey?: string;
  tabId?: number;
  targetId?: string;
  follow: boolean;
  done: boolean;
  passthrough: string[];
}

function repoScript(): string {
  return path.resolve(__dirname, "..", "..", "scripts", "agent-browser.mjs");
}

export function agentBrowserPath(): string {
  const override = process.env.TERMINAL_BROWSER_AGENT;
  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`TERMINAL_BROWSER_AGENT points at a missing file: ${override}`);
    }
    return override;
  }
  if (DIST_ROOT) {
    const shipped = path.join(
      DIST_ROOT,
      "agent-browser",
      "bin",
      process.platform === "win32" ? "agent-browser.exe" : "agent-browser",
    );
    if (fs.existsSync(shipped)) return shipped;
    throw new Error(`missing ${shipped} — the release is incomplete`);
  }
  const script = repoScript();
  if (!fs.existsSync(script)) throw new Error(`missing ${script}`);
  return execFileSync(process.execPath, [script, "--path"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function sessionName(browser: Browser): string {
  return `terminal-browser-${recordKey(browser)}`;
}

function childEnv(): NodeJS.ProcessEnv {
  fs.mkdirSync(AGENT_SOCKETS_DIR, { recursive: true });
  return { ...process.env, AGENT_BROWSER_SOCKET_DIR: AGENT_SOCKETS_DIR };
}

const AGENT_TIMEOUT_MS = 20_000;

/** How long one agent-browser call may take. Tests shorten it; so can a slow machine. */
function agentTimeout(): number {
  const asked = Number(process.env.TERMINAL_BROWSER_AGENT_TIMEOUT_MS);
  return Number.isSafeInteger(asked) && asked > 0 ? asked : AGENT_TIMEOUT_MS;
}

export type AgentRun = { status: number; stdout: string; timedOut: boolean; ms: number };

/**
 * An agent call that never answers would otherwise be waited on forever, so it
 * is given a deadline. A call that runs out of time is not the same as one
 * that could not start: the caller decides whether to try again.
 */
export function runAgent(binary: string, args: string[]): AgentRun {
  const started = Date.now();
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: agentTimeout(),
  });
  const ms = Date.now() - started;
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (result.error && !timedOut) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  return { status: timedOut ? 1 : result.status ?? 1, stdout: result.stdout ?? "", timedOut, ms };
}

const FLAGS_WITH_A_VALUE = new Set(["--session", "--cdp"]);

function agentGaveUp(args: string[], runs: AgentRun[]): Error {
  const spent = runs.reduce((total, run) => total + run.ms, 0);
  const what = args
    .filter((arg, i) => !arg.startsWith("-") && !FLAGS_WITH_A_VALUE.has(args[i - 1]))
    .join(" ");
  return new Error(
    `agent-browser did not answer "${what}" after ${runs.length} attempts in ${Math.round(spent / 1000)}s`,
  );
}

function parseTabs(stdout: string): AgentTab[] {
  const parsed = JSON.parse(stdout) as { data?: { tabs?: unknown[] }; tabs?: unknown[] };
  const rows = (parsed.data?.tabs ?? parsed.tabs ?? []) as Record<string, unknown>[];
  return rows.map((row) => ({
    tabId: String(row.tabId ?? ""),
    url: String(row.url ?? ""),
    title: String(row.title ?? ""),
    active: row.active === true,
  }));
}

function evalResult(stdout: string): unknown {
  const parsed = JSON.parse(stdout) as { data?: { result?: unknown } };
  return parsed.data?.result;
}

/**
 * The tabs agent-browser can see on this browser. A first call that never
 * answers is what the reconnect below is for; `run` is how a test drives that
 * without an agent to stall.
 */
export function agentTabs(
  binary: string,
  browser: Browser,
  run: (binary: string, args: string[]) => AgentRun = runAgent,
): AgentTab[] {
  const session = sessionName(browser);
  const port = String(browser.cdpPort);
  const listArgs = ["--session", session, "tab", "list", "--json"];
  const listing = run(binary, ["--session", session, "--cdp", port, "tab", "list", "--json"]);
  if (listing.status === 0) {
    try {
      return parseTabs(listing.stdout);
    } catch {}
  }
  const reconnect = run(binary, ["--session", session, "connect", port, "--json"]);
  if (reconnect.status !== 0) {
    if (reconnect.timedOut) throw agentGaveUp(["connect"], [listing, reconnect]);
    throw new Error(`could not connect agent-browser to terminal browser ${recordKey(browser)} on port ${port}`);
  }
  const retry = run(binary, listArgs);
  if (retry.status !== 0) {
    if (retry.timedOut) throw agentGaveUp(listArgs, [listing, reconnect, retry]);
    throw new Error("agent-browser could not list tabs after reconnecting");
  }
  return parseTabs(retry.stdout);
}

function matchTab(
  binary: string,
  session: string,
  agentView: AgentTab[],
  tab: TabTarget,
): AgentTab {
  if (agentView.length === 0) throw new Error("agent-browser sees no tabs on this browser");
  const sameUrl = agentView.filter((entry) => entry.url === tab.url);
  if (sameUrl.length === 1) return sameUrl[0];
  const candidates = sameUrl.length > 0 ? sameUrl : agentView;
  if (candidates.length === 1) return candidates[0];
  if (typeof tab.timeOrigin !== "number") {
    throw new Error(
      `cannot tell which of ${candidates.length} tabs on ${tab.url} is terminal browser tab ${tab.id}`,
    );
  }
  const slow: AgentRun[] = [];
  for (const candidate of candidates) {
    const chosen = runAgent(binary, ["--session", session, "tab", candidate.tabId]);
    if (chosen.timedOut) {
      slow.push(chosen);
      continue;
    }
    const probe = runAgent(binary, [
      "--session",
      session,
      "eval",
      "performance.timeOrigin",
      "--json",
    ]);
    if (probe.timedOut) slow.push(probe);
    if (probe.status !== 0) continue;
    try {
      if (evalResult(probe.stdout) === tab.timeOrigin) return { ...candidate, active: true };
    } catch {}
  }
  if (slow.length > 0) throw agentGaveUp(["tab", "eval"], slow);
  throw new Error(`could not find terminal browser tab ${tab.id} (${tab.url}) among agent-browser's tabs`);
}

async function select(terminal: Terminal | null, options: ActionOptions): Promise<Selection> {
  const all = await browsers(terminal);
  if (all.length === 0) throw new Error("no terminal browsers running — start one with: terminal-browser open");

  if (options.targetId) {
    for (const browser of all) {
      const tab = (await targets(browser)).find((entry) => entry.targetId === options.targetId);
      if (tab) return { browser, tab };
    }
    throw new Error(`no tab with target id ${options.targetId}`);
  }

  let candidates = all;
  if (options.browserKey) {
    candidates = all.filter((browser) => recordKey(browser) === options.browserKey);
    if (candidates.length === 0) {
      throw new Error(
        `no browser ${options.browserKey}\n\nrunning:\n  ${all.map(describe).join("\n  ")}`,
      );
    }
  } else {
    const here = all.filter((browser) => browser.inCurrentTab);
    if (here.length === 0) {
      throw new Error(
        `no terminal browser in this terminal tab — pass --browser <key>\n\nrunning:\n  ${all
          .map(describe)
          .join("\n  ")}`,
      );
    }
    candidates = here;
  }
  if (candidates.length > 1) {
    throw new Error(
      `several browsers match — pass --browser <key>\n\nmatching:\n  ${candidates
        .map(describe)
        .join("\n  ")}`,
    );
  }

  const browser = candidates[0];
  const tabs = await targets(browser);
  if (tabs.length === 0) throw new Error(`browser ${recordKey(browser)} has no tabs`);
  if (options.tabId === undefined) {
    return { browser, tab: tabs.find((tab) => tab.active) ?? tabs[0] };
  }
  const tab = tabs.find((entry) => entry.id === options.tabId);
  if (!tab) {
    const known = tabs.map((entry) => `${entry.id} ${entry.url}`).join("\n  ");
    throw new Error(`no tab ${options.tabId} in browser ${recordKey(browser)}\n\ntabs:\n  ${known}`);
  }
  return { browser, tab };
}

const BLOCKED_COMMANDS = new Map([
  ["launch", "terminal-browser drives the browser you already have open — use: terminal-browser open"],
  ["install", "terminal-browser never downloads a second browser engine"],
  ["connect", "terminal-browser manages the CDP connection for you"],
  ["disconnect", "terminal-browser manages the CDP connection for you"],
]);

const BLOCKED_FLAGS = new Map([
  ["--cdp", "terminal-browser picks the port from the browser you target"],
  ["--auto-connect", "terminal-browser picks the port from the browser you target"],
  ["--session", "terminal-browser names the session after the browser you target"],
  ["--headed", "the browser is already visible in your terminal"],
  ["--executable-path", "terminal-browser drives its own browser, not another engine"],
  ["--profile", "terminal-browser drives its own browser, not another engine"],
  ["--provider", "terminal-browser drives the local browser, not a cloud one"],
]);

function checkGuardrails(args: string[]) {
  for (const arg of args) {
    const flag = arg.split("=")[0];
    const reason = BLOCKED_FLAGS.get(flag);
    if (reason) throw new Error(`${flag} is not available through terminal-browser action — ${reason}`);
  }
  const command = args.find((arg) => !arg.startsWith("-"));
  if (!command) return;
  const reason = BLOCKED_COMMANDS.get(command);
  if (reason) throw new Error(`${command} is not available through terminal-browser action — ${reason}`);
}

async function interceptTabLifecycle(
  selection: Selection,
  args: string[],
): Promise<unknown | null> {
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const [command, sub, value] = positional;
  if (command === "open") {
    return control(selection.browser.socket, { cmd: "open-tab", url: sub });
  }
  if (command !== "tab") return null;
  if (sub === "new") {
    return control(selection.browser.socket, { cmd: "open-tab", url: value });
  }
  if (sub === "close") {
    const id = value ? Number(value.replace(/^t/, "")) : selection.tab.id;
    if (!Number.isFinite(id)) throw new Error(`cannot read a tab id from ${value}`);
    return control(selection.browser.socket, { cmd: "close-tab", tab: id });
  }
  return null;
}

export async function actionCommand(terminal: Terminal | null, options: ActionOptions) {
  const selection = await select(terminal, options);
  const { browser, tab } = selection;

  if (options.done) {
    const reply = await control(browser.socket, { cmd: "agent-release" });
    process.stdout.write(`${JSON.stringify(reply, null, 2)}\n`);
    return 0;
  }

  if (options.passthrough.length === 0) {
    throw new Error("nothing to run — pass a command after --, e.g. terminal-browser action -- snapshot");
  }
  checkGuardrails(options.passthrough);
  await control(browser.socket, { cmd: "agent-touch", tab: tab.id }).catch(() => {});

  const intercepted = await interceptTabLifecycle(selection, options.passthrough);
  if (intercepted !== null) {
    process.stdout.write(`${JSON.stringify(intercepted, null, 2)}\n`);
    return 0;
  }

  if (browser.cdpPort === null) {
    throw new Error(`browser ${recordKey(browser)} has no debugging port`);
  }
  if (!tab.targetId) {
    throw new Error(`tab ${tab.id} has no CDP target yet — is the page still starting?`);
  }

  const binary = agentBrowserPath();
  const session = sessionName(browser);
  const match = matchTab(binary, session, agentTabs(binary, browser), tab);
  if (!match.active) {
    const switched = runAgent(binary, ["--session", session, "tab", match.tabId]);
    if (switched.timedOut) throw agentGaveUp(["tab", match.tabId], [switched]);
    if (switched.status !== 0) throw new Error(`agent-browser could not switch to ${match.tabId}`);
  }
  if (options.follow && !tab.active) {
    await control(browser.socket, { cmd: "activate-tab", tab: tab.id });
  }

  const child = spawnSync(binary, ["--session", session, ...options.passthrough], {
    env: childEnv(),
    stdio: "inherit",
  });
  if (child.error) throw child.error;
  return child.status ?? 1;
}
