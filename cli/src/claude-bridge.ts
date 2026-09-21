import { execFile as execFileCb, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { attachWindowsConsole, callerTty } from "@zenbu-labs/pixel/terminal";
import { ipcEndpoint, logLifecycle, observeProcessExit } from "pixel-store";

import { installedVersion } from "./upgrade";
import { FrameHost } from "./claude-frame-host";
import { encodeFrame, type ImageSource } from "./claude-frame";

const execFile = promisify(execFileCb);


const LOG_DIR = path.join(os.homedir(), ".terminal-browser", "logs");
const LOG_FILE = path.join(LOG_DIR, "claude-code-plugin-bridge.log");
const DEFAULT_CELL: [number, number] = [16, 34];
const DEBUG = process.env.CC_BROWSER_DEBUG === "1";

function log(event: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} ${event}${detail === undefined ? "" : " " + JSON.stringify(detail)}\n`;
  process.stderr.write(line);
}

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

function selfCommand(): string[] {
  return [process.execPath, process.argv[1]];
}


export function clipboardWriter(
  text: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; bytes: Buffer } | null {
  if (platform === "darwin") return { command: "pbcopy", args: [], bytes: Buffer.from(text, "utf8") };
  if (platform === "win32") {
    const script = '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); $text = [Console]::In.ReadToEnd(); if ($text.Length) { Set-Clipboard -Value $text } else { Set-Clipboard }';
    return { command: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script], bytes: Buffer.from(text, "utf8") };
  }
  return null;
}

function copyToClipboard(text: string): void {
  const writer = clipboardWriter(text);
  if (!writer) return;
  try {
    const child = spawn(writer.command, writer.args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    child.on("error", () => {});
    child.stdin!.on("error", () => {});
    child.stdin!.end(writer.bytes);
  } catch {}
}

function parseCell(text: string | undefined): [number, number] | null {
  const m = /^(\d+)x(\d+)$/.exec(text ?? "");
  return m ? Cell.safeParse([Number(m[1]), Number(m[2])]).data ?? null : null;
}




function report(value: unknown, exitCode = 0): never {
  process.stdout.write(JSON.stringify(value) + "\n");
  process.exit(exitCode);
}

async function launch(argv: string[]): Promise<never> {
  const tty = flag(argv, "--tty") ?? callerTty().path;
  if (!tty) report({ error: "no tty: Claude Code is not running on a terminal", code: "tty" }, 2);
  const cellOverride = flag(argv, "--cell") ?? process.env.CC_BROWSER_CELL ?? "";
  const token = crypto.randomBytes(24).toString("hex");
  const name = `cc-browser-${process.pid}-${Date.now().toString(36)}`;
  const socket =
    process.platform === "win32"
      ? ipcEndpoint(name)
      : path.join(os.tmpdir(), `${name}.sock`);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFd = fs.openSync(LOG_FILE, "a");
  const [self, ...selfArgs] = selfCommand();
  const consoleArgs = process.platform === "win32" ? ["--console-pid", String(process.pid)] : [];
  let child: ChildProcess;
  try {
    child = spawn(
      self,
      [...selfArgs, "claude-bridge", "serve", "--tty", tty, "--socket", socket, "--cell", cellOverride, "--token", token, ...consoleArgs],
      { detached: true, stdio: ["ignore", "pipe", logFd], windowsHide: true },
    );
  } finally {
    fs.closeSync(logFd);
  }
  let port: number;
  try {
    port = await new Promise<number>((resolve, reject) => {
      let line = "";
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error("bridge did not report its port")), 10_000);
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        line += chunk;
        if (line.includes("\n")) {
          clearTimeout(timer);
          try {
            const ready = JSON.parse(line.split("\n")[0]) as { port?: number; error?: string };
            if (ready.error) throw new Error(ready.error);
            if (typeof ready.port !== "number" || !Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535) {
              throw new Error("bridge reported an invalid port");
            }
            resolve(ready.port);
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        }
      });
      child.once("error", fail);
      child.once("exit", (code) => {
        fail(new Error(`bridge exited with ${code}`));
      });
    });
  } catch (error) {
    child.kill();
    report({ error: error instanceof Error ? error.message : String(error), code: "start" }, 1);
  }
  child.stdout!.destroy();
  child.unref();
  const launched = { port, pid: child.pid, tty, terminalBrowser: installedVersion() ?? "dev", token };
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} launch ${JSON.stringify({ ...launched, token: undefined })}\n`);
  report(launched);
}


const Cell = z.tuple([z.number().int().positive().max(256), z.number().int().positive().max(256)]);

const Size = z.object({ cols: z.number().int().positive().max(255), rows: z.number().int().positive().max(255) });
type Size = z.infer<typeof Size>;

const Mods = z.object({ shift: z.boolean(), alt: z.boolean(), ctrl: z.boolean(), super: z.boolean() }).partial();

const PixelMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), pane: z.string().optional(), name: z.string().optional(), pid: z.number().optional() }),
  z.object({ type: z.literal("title"), text: z.string() }),
  z.object({ type: z.literal("pointer"), shape: z.string() }),
  z.object({ type: z.literal("clipboard"), text: z.string() }),
]);

const InputEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mouse"),
    kind: z.enum(["down", "up", "move", "scrollup", "scrolldown"]),
    button: z.enum(["left", "middle", "right", "none"]).optional(),
    x: z.number(),
    y: z.number(),
    mods: Mods.optional(),
  }),
  z.object({ type: z.literal("key"), key: z.string(), text: z.string().optional(), mods: Mods.optional() }),
  z.object({ type: z.literal("paste"), text: z.string() }),
  z.object({ type: z.literal("focus"), focused: z.boolean() }),
]);

const OpenBody = Size.partial().extend({ url: z.string().optional() });
const InputBody = z.object({ events: z.array(z.unknown()) });
const TextBody = z.object({ text: z.string().trim().min(1) });

class Bridge {
  port: number | null = null;
  size: Size = { cols: 80, rows: 24 };
  url: string | null = null;
  private picture: { sequence: number; cols: number; rows: number; width: number; height: number; pixels: Buffer } | null = null;
  private sequence = 0;
  private encoded: { sequence: number; source: Promise<ImageSource> } | null = null;
  private visible = false;
  private host: FrameHost;
  title = "";
  alive = false;
  error: string | null = null;
  inbox: string[] = [];
  private child: ChildProcess | null = null;
  private stopping = false;

  constructor(
    readonly tty: string,
    readonly socketPath: string,
    readonly cellOverride: [number, number] | null,
    readonly token: string,
  ) {
    this.host = new FrameHost(socketPath, () => this.cell());
    this.host.onMessage = message => this.handlePixelMessage(message);
    this.host.onFrame = frame => {
      const [cw, ch] = this.cell();
      if (!this.visible || frame.width !== this.size.cols * cw || frame.height !== this.size.rows * ch) return;
      this.picture = { ...frame, ...this.size, sequence: ++this.sequence };
      this.error = null;
    };
    this.host.onDisconnect = () => {
      this.picture = null;
      this.encoded = null;
      log("browser frame connection closed", { alive: this.alive, stopping: this.stopping });
      logLifecycle("bridge", "frame connection closed", { childPid: this.child?.pid, alive: this.alive, stopping: this.stopping });
    };
    this.host.onError = error => {
      this.error = error.message;
      log("frame host error", error.message);
      logLifecycle("bridge", "frame host error", { childPid: this.child?.pid, errorName: error.name });
    };
  }

  state() {
    return {
      url: this.url,
      frame: this.picture ? { sequence: this.picture.sequence, cols: this.picture.cols, rows: this.picture.rows } : null,
      title: this.title,
      alive: this.alive,
      error: this.error,
      inbox: this.inbox.length,
    };
  }


  private sizeMessage(type: "init" | "size") {
    const [cw, ch] = this.cell();
    return { type, ...this.size, cell: [cw, ch], width: this.size.cols * cw, height: this.size.rows * ch };
  }

  private send(message: unknown): void {
    this.host.send(message);
  }

  listenForPixel(): void {
    this.host.listen();
  }

  private handlePixelMessage(raw: unknown): void {
    const parsed = PixelMessage.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.type) {
      case "join":
        logLifecycle("bridge", "frame connection joined", { childPid: this.child?.pid, browserPid: message.pid ?? null });
        this.send({ ...this.sizeMessage("init"), focused: true });
        break;
      case "title":
        this.title = message.text;
        break;
      case "clipboard":
        if (DEBUG) log("clipboard from browser", { chars: message.text.length });
        copyToClipboard(message.text);
        break;
      case "pointer":
        break;
    }
  }

  private cell(): [number, number] {
    return this.cellOverride ?? DEFAULT_CELL;
  }

  async frame(after: number) {
    const picture = this.picture;
    if (!this.visible || !picture || picture.sequence === after) return { frame: null };
    if (this.encoded?.sequence !== picture.sequence) {
      this.encoded = { sequence: picture.sequence, source: encodeFrame(picture.pixels, picture.width, picture.height) };
    }
    const source = await this.encoded.source;
    return { frame: { sequence: picture.sequence, cols: picture.cols, rows: picture.rows, source } };
  }


  open(url: string | undefined, size: Size | null): void {
    this.visible = true;
    this.resize(size ?? this.size);
    if (this.alive) {
      if (url && url !== this.url) void this.navigate(url);
      this.send(this.sizeMessage("size"));
      this.send({ type: "visible", value: true });
      return;
    }
    this.url = url ?? this.url ?? "about:blank";
    this.error = null;
    this.picture = null;
    this.encoded = null;
    const env = { ...process.env };
    delete env.PIXEL_PANE;
    env.PIXEL_EMBED = this.socketPath;
    env.PIXEL_EMBED_FRAMES = "1";
    env.PIXEL_TTY = this.tty;
    // Keep the caller's console attached until the browser stops.
    if (process.platform === "win32") env.TERMINAL_BROWSER_CONSOLE_PID = String(process.pid);
    env.TERMINAL_BROWSER_COPY_ON_SELECT = "1";
    env.TERMINAL_BROWSER_START_PAGE = "1";
    if (this.port) {
      env.TERMINAL_BROWSER_AGENT_BRIDGE = `http://127.0.0.1:${this.port}`;
      env.TERMINAL_BROWSER_AGENT_TOKEN = this.token;
    }
    const [command, ...args] = selfCommand();
    const child = spawn(command, [...args, "open", this.url], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on("error", (error) => {
      this.alive = false;
      this.error = error.message;
      log("browser process error", { pid: child.pid, error: error.message });
      logLifecycle("bridge", "browser child error", { childPid: child.pid, errorCode: (error as NodeJS.ErrnoException).code });
    });
    child.on("exit", (code, signal) => {
      logLifecycle("bridge", "browser child exited", { childPid: child.pid, code, signal, stopping: this.stopping });
      log("browser process exited", { pid: child.pid, code, signal, stopping: this.stopping, stderr: stderr.trim() });
      if (this.child !== child) return;
      this.child = null;
      this.alive = false;
      this.picture = null;
      this.encoded = null;
      if (!this.stopping) {
        this.error = code || signal
          ? stderr.trim() || `terminal-browser exited with ${signal ?? code}`
          : "Browser stopped. Run /browser <url> to reopen.";
      }
    });
    child.on("close", (code, signal) => {
      logLifecycle("bridge", "browser child streams closed", { childPid: child.pid, code, signal });
    });
    this.child = child;
    this.alive = true;
    log("browser process started", { pid: child.pid });
    logLifecycle("bridge", "browser child started", { childPid: child.pid });
  }

  private async browserKey(): Promise<string | null> {
    const [command, ...args] = selfCommand();
    try {
      const { stdout } = await execFile(command, [...args, "ls", "--all", "--json"], { timeout: 5000 });
      const list = JSON.parse(stdout);
      const rows = Array.isArray(list) ? list : list.browsers ?? [];
      const mine = rows.find((b: { tty?: string }) => b.tty === this.tty);
      return mine?.key ?? null;
    } catch {
      return null;
    }
  }

  private async navigate(url: string): Promise<void> {
    this.url = url;
    const key = await this.browserKey();
    const [command, ...args] = selfCommand();
    const selectors = key ? ["--browser", key] : [];
    spawn(command, [...args, "action", ...selectors, "--", "open", url], {
      env: process.env,
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => {});
  }

  resize(size: Size): void {
    const [cw, ch] = this.cell();
    if (size.cols * cw * size.rows * ch > 40_000_000) throw new Error("browser viewport exceeds the frame size limit");
    if (size.cols === this.size.cols && size.rows === this.size.rows) return;
    if (DEBUG) log("browser size changed", { previous: this.size, next: size, width: size.cols * cw, height: size.rows * ch });
    this.size = size;
    this.picture = null;
    this.encoded = null;
    const message = this.sizeMessage("size");
    this.send(message);
  }

  input(events: unknown[]): void {
    const [cw, ch] = this.cell();
    if (DEBUG) log("input", events);
    for (const raw of events) {
      const parsed = InputEvent.safeParse(raw);
      if (!parsed.success) continue;
      const event = parsed.data;
      switch (event.type) {
        case "mouse": {
          const x = Math.max(0, Math.round(event.x * cw));
          const y = Math.max(0, Math.round(event.y * ch));
          this.send({ type: "mouse", kind: event.kind, button: event.button ?? "none", mods: event.mods ?? {}, x, y });
          break;
        }
        case "key":
          this.send({ type: "key", key: event.key, kind: "press", text: event.text, mods: event.mods ?? {} });
          break;
        case "paste":
          this.send({ type: "paste", text: event.text });
          break;
        case "focus":
          this.send({ type: "focus", focused: event.focused });
          break;
      }
    }
  }

  hide(): void {
    this.visible = false;
    this.send({ type: "visible", value: false });
  }

  close(reason: string): void {
    if (this.stopping) return;
    this.stopping = true;
    const child = this.child;
    logLifecycle("bridge", "shutdown requested", { reason, childPid: child?.pid, alive: this.alive });
    const finish = () => {
      logLifecycle("bridge", "shutdown finished");
      try {
        this.host.stop();
      } catch {}
      if (process.platform !== "win32") fs.rmSync(this.socketPath, { force: true });
      process.exit(0);
    };
    if (child && child.exitCode === null) {
      logLifecycle("bridge", "child termination requested", { childPid: child.pid, signal: "SIGTERM" });
      child.kill("SIGTERM");
      child.once("exit", () => setTimeout(finish, 200));
      setTimeout(() => {
        logLifecycle("bridge", "child termination wait expired", { childPid: child.pid, signal: "SIGKILL" });
        try {
          child.kill("SIGKILL");
        } catch {}
        finish();
      }, 3500).unref();
    } else {
      setTimeout(finish, 300).unref();
    }
  }
}

function readJson(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    request.on("error", () => resolve({}));
  });
}

function sizeOf(body: z.infer<typeof OpenBody>): Size | null {
  const { cols, rows } = body;
  return cols && rows ? Size.safeParse({ cols, rows }).data ?? null : null;
}

type Reply = [number, unknown];

function withBody<T>(schema: z.ZodType<T>, handler: (body: T) => Reply): (body: unknown) => Reply {
  return (body) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) return [400, { error: "invalid body" }];
    return handler(parsed.data);
  };
}

function routes(bridge: Bridge): Record<string, (body: unknown) => Reply | Promise<Reply>> {
  return {
    "GET /state": () => [200, bridge.state()],
    "GET /frame": async body => [200, await bridge.frame(Number((body as { after?: string }).after ?? 0))],
    "POST /open": withBody(OpenBody, (body) => {
      bridge.open(body.url, sizeOf(body));
      return [200, bridge.state()];
    }),
    "POST /size": withBody(OpenBody, (body) => {
      const size = sizeOf(body);
      if (size) bridge.resize(size);
      return [200, bridge.state()];
    }),
    "POST /input": withBody(InputBody, (body) => {
      bridge.input(body.events);
      return [200, {}];
    }),
    "POST /agent-text": withBody(TextBody, (body) => {
      bridge.inbox.push(body.text);
      return [200, {}];
    }),
    "POST /inbox/take": () => [200, { texts: bridge.inbox.splice(0, bridge.inbox.length) }],
    "POST /browser/close": () => {
      bridge.hide();
      return [200, bridge.state()];
    },
    "POST /close": () => {
      setTimeout(() => bridge.close("close request"), 0);
      return [200, {}];
    },
  };
}

const IDLE_EXIT_MS = 60_000;

function serve(argv: string[]): void {
  observeProcessExit("bridge");
  const tty = flag(argv, "--tty");
  const socket = flag(argv, "--socket");
  const cellOverride = parseCell(flag(argv, "--cell"));
  const token = flag(argv, "--token") ?? "";
  if (!tty || !socket) {
    process.stderr.write("claude-bridge serve needs --tty and --socket\n");
    process.exit(2);
  }
  const consolePid = flag(argv, "--console-pid");
  if (process.platform === "win32" && consolePid !== undefined) {
    try {
      attachWindowsConsole(Number(consolePid));
    } catch (error) {
      report({ error: `could not attach to the caller's console: ${error instanceof Error ? error.message : String(error)}` }, 1);
    }
  }
  const bridge = new Bridge(tty, socket, cellOverride, token);
  bridge.listenForPixel();
  const table = routes(bridge);
  let lastSeen = Date.now();
  const server = http.createServer(async (request, response) => {
    if (token && request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    lastSeen = Date.now();
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const handler = table[`${request.method} ${url.pathname}`];
    let status: number, value: unknown;
    try {
      [status, value] = handler ? await handler(request.method === "POST" ? await readJson(request) : Object.fromEntries(url.searchParams)) : [404, { error: "not found" }];
    } catch (error) {
      status = 500;
      value = { error: error instanceof Error ? error.message : String(error) };
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") process.exit(1);
    bridge.port = address.port;
    logLifecycle("bridge", "listening", { port: address.port });
    process.stdout.write(JSON.stringify({ port: bridge.port }) + "\n");
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => bridge.close(signal));
  setInterval(() => {
    if (Date.now() - lastSeen > IDLE_EXIT_MS) bridge.close("idle timeout");
  }, 10_000).unref();
}

export async function claudeBridgeCommand(args: string[]): Promise<number> {
  const [mode, ...rest] = args;
  if (mode === "launch") await launch(rest);
  if (mode === "serve") {
    serve(rest);
    return new Promise<never>(() => {});
  }
  process.stderr.write("usage: terminal-browser claude-bridge launch|serve ...\n");
  return 2;
}
