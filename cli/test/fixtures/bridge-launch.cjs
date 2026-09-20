const os = require("node:os");
const path = require("node:path");

const home = process.argv[2];
process.once("message", () => {
  process.disconnect();
  os.homedir = () => home;
  const main = path.resolve(__dirname, "../../dist/main.js");
  process.argv = [process.execPath, main, "claude-bridge", "launch", "--tty", "CONIN$#launch-test"];
  require(main);
});
process.send({ pid: process.pid });
