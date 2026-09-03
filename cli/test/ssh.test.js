const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  parseSshTarget,
  resolveSshTarget,
  sshCommandArgs,
  sshTunnelArgs,
  validateBundleDir,
  validateSshTarget,
} = require("../dist/ssh.js");

test("SSH targets preserve connection arguments and explicit ports", () => {
  assert.deepEqual(parseSshTarget("dev@build-box:2222"), {
    destination: "dev@build-box",
    sshPort: "2222",
  });
  assert.deepEqual(resolveSshTarget("ssh -J jump -i key dev@build-box:2222"), {
    destination: "dev@build-box",
    hostArgs: ["-J", "jump", "-i", "key", "-p", "2222"],
    aliasCommand: null,
  });
  assert.doesNotThrow(() => validateSshTarget("-F config build-box"));
  assert.throws(() => validateSshTarget("first second"), /both first and second/);
});

test("Windows tunnel arguments keep ssh in the foreground", () => {
  assert.deepEqual(sshTunnelArgs("build-box", ["-p", "2222"], 43123, null), [
    "-N",
    "-D",
    "127.0.0.1:43123",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-p",
    "2222",
    "build-box",
  ]);
});

test("remote commands reuse host arguments without ControlMaster", () => {
  const tunnel = {
    destination: "build-box",
    hostArgs: ["-J", "jump", "-p", "2222"],
    socksPort: 43123,
    controlPath: null,
    localFilesNeedChmod: true,
    stop() {},
  };
  assert.deepEqual(sshCommandArgs(tunnel, "true", true), [
    "-tt",
    "-J",
    "jump",
    "-p",
    "2222",
    "build-box",
    "true",
  ]);
});

test("Windows bundles do not require a local executable bit", () => {
  const root = fs.mkdtempSync(path.join(__dirname, ".ssh-"));
  try {
    fs.writeFileSync(path.join(root, "start"), "#!/bin/sh\necho READY http://localhost:3000\n");
    assert.doesNotThrow(() => validateBundleDir(root, "win32"));
    assert.throws(() => validateBundleDir(root, "linux"), /start is not executable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
