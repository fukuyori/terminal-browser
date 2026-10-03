const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { attachWindowsConsole } = require("@zenbu-labs/pixel/terminal");

const pid = Number(process.argv[2]);
const socket = process.argv[3];
const pixelRequire = createRequire(require.resolve("@zenbu-labs/pixel"));
const { PixelEngine } = pixelRequire(`@zenbu-labs/pixel-native-win32-${process.arch}/pixel.node`);
const open = () => new PixelEngine(undefined, undefined, {
  TERMINAL_BROWSER_CONSOLE_PID: String(pid),
}, { socket, tty: "CONIN$#launch-test", pane: "test", name: "test" });

attachWindowsConsole(pid);
const first = open();
assert.equal(JSON.parse(first.info()).hosted, true);
assert.throws(() => attachWindowsConsole(pid), /already owns this process' console/);
first.stop();
attachWindowsConsole(pid);
const second = open();
second.stop();
process.stdout.write("attached, guarded, released, reattached\n");
