import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { app } from "electron";

// why is this defined in pixel store?
import { DAEMON_SOCKET, logLifecycle, observeProcessExit } from "pixel-store";
import { createSession } from "./session/session";
import type { SessionHandle } from "./session/session";
import { servePages } from "./pages/scheme";

// what
const IDLE_EXIT_MS = 15_000;


interface OpenRequest {
  cmd: "open";
  tty: string;
  argv?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  build?: string;
}

export function buildStamp(): string {
  try {
    return String(Math.floor(fs.statSync(path.join(__dirname, "main.js")).mtimeMs));
  } catch {
    return "unknown";
  }
}

export async function runDaemon(cdpPort: number | null): Promise<void> {
  observeProcessExit("daemon");
  const exit = (code: number, reason: string) => {
    logLifecycle("daemon", "exit requested", { code, reason });
    app.exit(code);
  };
  if (await socketAlive()) {
    process.stderr.write("terminal-browser daemon already running\n");
    exit(3, "already running");
    return;
  }
  if (process.platform !== "win32") {
    fs.mkdirSync(path.dirname(DAEMON_SOCKET), { recursive: true });
    fs.rmSync(DAEMON_SOCKET, { force: true });
  }

  const build = buildStamp();
  const sessions = new Map<string, SessionHandle>();
  servePages(() => {
    const all = [...sessions.values()];
    const shown = all.filter((open) => open.showsStartPage());
    const chosen = shown[shown.length - 1] ?? all[all.length - 1];
    return chosen?.pageContext() ?? { cwd: process.cwd(), theme: null };
  });
  let seq = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleIdleExit = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (sessions.size === 0) exit(0, "idle timeout");
    }, IDLE_EXIT_MS);
  };
  scheduleIdleExit();

  const stopEverything = (code: number, signal: string) => {
    logLifecycle("daemon", "signal received", { code, signal, sessions: sessions.size });
    for (const open of [...sessions.values()]) {
      try {
        open.close();
      } catch {}
    }
    sessions.clear();
    setTimeout(() => exit(code, signal), 200);
  };
  process.on("SIGINT", () => stopEverything(130, "SIGINT"));
  process.on("SIGTERM", () => stopEverything(143, "SIGTERM"));

  const server = net.createServer((connection) => {
    let key: string | null = null;
    let session: SessionHandle | null = null;
    const reply = (value: unknown) => {
      try {
        connection.write(`${JSON.stringify(value)}\n`);
      } catch {}
    };

    let buffer = "";
    connection.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        let message: Omit<OpenRequest, "cmd"> & { cmd: string };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.cmd === "open" && !session) {
          if (message.build && message.build !== build) {
            logLifecycle("daemon", "stale build requested", { sessions: sessions.size });
            reply({ ok: false, error: "stale" });
            connection.end();
            if (sessions.size === 0) exit(0, "stale build");
            return;
          }
          if (!message.tty) {
            reply({ ok: false, error: "no tty" });
            connection.end();
            return;
          }
          if (idleTimer) clearTimeout(idleTimer);
          key = `${process.pid}-${++seq}`;
          const sessionKey = key;
          logLifecycle("daemon", "session opening", { session: sessionKey });
          try {
            session = createSession({
              tty: message.tty,
              key: sessionKey,
              argv: message.argv ?? [],
              env: message.env ?? {},
              cwd: message.cwd ?? process.cwd(),
              cdpPort,
              onClose: (code) => {
                logLifecycle("daemon", "session closed", { session: sessionKey, code });
                sessions.delete(sessionKey);
                reply({ event: "closed", code });
                connection.end();
                scheduleIdleExit();
              },
            });
          } catch (error) {
            logLifecycle("daemon", "session creation failed", { session: sessionKey });
            reply({ ok: false, error: String(error) });
            connection.end();
            scheduleIdleExit();
            return;
          }
          sessions.set(sessionKey, session);
          logLifecycle("daemon", "session opened", { session: sessionKey });
          reply({ ok: true, session: sessionKey, pid: process.pid });
        } else if (message.cmd === "resize") {
          session?.nudgeResize();
        } else if (message.cmd === "close") {
          logLifecycle("daemon", "client requested close", { session: key });
          session?.close();
        } else if (message.cmd === "shutdown") {
          logLifecycle("daemon", "client requested shutdown", { sessions: sessions.size });
          reply({ ok: true, sessions: sessions.size });
          connection.end();
          setTimeout(() => exit(0, "shutdown command"), 50);
        }
      }
    });
    connection.on("error", (error: NodeJS.ErrnoException) => {
      logLifecycle("daemon", "client connection error", { session: key, errorCode: error.code });
    });
    connection.on("close", (hadError) => {
      if (key) logLifecycle("daemon", "client connection closed", { session: key, hadError, active: sessions.has(key) });
      if (key && sessions.has(key)) {
        logLifecycle("daemon", "closing orphan session", { session: key });
        const orphan = sessions.get(key)!;
        sessions.delete(key);
        orphan.close();
        scheduleIdleExit();
      }
    });
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    logLifecycle("daemon", "server error", { errorCode: error.code });
    process.stderr.write(`terminal-browser daemon socket error: ${error}\n`);
    exit(1, "server error");
  });
  server.listen(DAEMON_SOCKET, () => logLifecycle("daemon", "listening"));
}

function socketAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.connect(DAEMON_SOCKET);
    probe.once("connect", () => {
      probe.end();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}
