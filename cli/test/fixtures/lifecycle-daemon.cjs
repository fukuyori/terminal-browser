const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");
const ts = require("typescript");

const sourcePath = path.resolve(__dirname, "../../../browser/src/daemon.ts");
const daemonPath = path.resolve(__dirname, "../../../browser/dist/daemon.js");
const load = Module._load;
let session;
Module._load = function (name, parent, ...rest) {
  if (parent?.filename === daemonPath) {
    if (name === "electron") return { app: { exit: code => process.exit(code) } };
    if (name === "./pages/scheme") return { servePages() {} };
    if (name === "./session/session") return {
      createSession(ctx) {
        session = ctx;
        process.send({ event: "session", session: ctx.key });
        return { close: () => ctx.onClose(0), nudgeResize() {} };
      },
    };
  }
  return load.call(this, name, parent, ...rest);
};

process.on("message", message => {
  if (message === "close session") session.onClose(0);
  if (message === "exit daemon") process.exit(23);
  if (message === "signal daemon") process.emit("SIGTERM");
});
const daemon = new Module(daemonPath, module);
daemon.filename = daemonPath;
daemon.paths = Module._nodeModulePaths(path.dirname(daemonPath));
daemon._compile(ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, daemonPath);
Module._load = load;
daemon.exports.runDaemon(null).then(() => process.send({ event: "ready" }));
