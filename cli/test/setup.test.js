const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { editorSupportDir } = require("../dist/editors.js");
const { linkSkills } = require("../dist/setup.js");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(__dirname, ".setup-"));
}

test("Windows editor setup uses APPDATA", () => {
  const appData = path.join(__dirname, "app-data");
  assert.equal(editorSupportDir("win32", { APPDATA: appData }, "C:\\Users\\test"), appData);
});

test("skill setup links packaged variants and preserves user directories", () => {
  const root = temporaryDirectory();
  try {
    const dist = path.join(root, "dist");
    const home = path.join(root, "home");
    const state = path.join(root, "state");
    const shared = path.join(root, "shared");
    const defaultSkill = path.join(dist, "skills", "default", "terminal-browser");
    const codexSkill = path.join(dist, "skills", "codex", "terminal-browser");
    fs.mkdirSync(defaultSkill, { recursive: true });
    fs.mkdirSync(codexSkill, { recursive: true });
    fs.writeFileSync(path.join(defaultSkill, "SKILL.md"), "default\n");
    fs.writeFileSync(path.join(codexSkill, "SKILL.md"), "codex\n");
    fs.writeFileSync(
      path.join(dist, "skills", "manifest"),
      "agent codex .codex/skills codex\nagent cursor .cursor/skills default\nskill terminal-browser\n",
    );
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    const userSkill = path.join(home, ".cursor", "skills", "terminal-browser");
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, "SKILL.md"), "user\n");

    const staleTarget = path.join(dist, "skills", "default", "removed-skill");
    const staleLink = path.join(shared, "removed-skill");
    fs.mkdirSync(staleTarget, { recursive: true });
    fs.mkdirSync(shared, { recursive: true });
    fs.symlinkSync(staleTarget, staleLink, process.platform === "win32" ? "junction" : "dir");
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, "skills.links"), `${staleLink}\n`);

    const result = linkSkills({ dist, home, state, shared });
    const codexLink = path.join(home, ".codex", "skills", "terminal-browser");
    const sharedLink = path.join(shared, "terminal-browser");
    assert.deepEqual(result.linkedAgents, ["codex"]);
    assert.deepEqual(result.left, [userSkill]);
    assert.equal(fs.realpathSync(codexLink), fs.realpathSync(codexSkill));
    assert.equal(fs.realpathSync(sharedLink), fs.realpathSync(defaultSkill));
    assert.equal(fs.readFileSync(path.join(userSkill, "SKILL.md"), "utf8"), "user\n");
    assert.deepEqual(
      fs.readFileSync(path.join(state, "skills.links"), "utf8").trim().split("\n").sort(),
      [codexLink, sharedLink].sort(),
    );
    assert.equal(fs.existsSync(staleLink), false);
    assert.doesNotThrow(() => linkSkills({ dist, home, state, shared }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("setup command installs Windows skills and editor settings", { skip: process.platform !== "win32" }, () => {
  const root = temporaryDirectory();
  try {
    const dist = path.join(root, "dist");
    const home = path.join(root, "home");
    const appData = path.join(root, "app-data");
    const localAppData = path.join(root, "local-app-data");
    const shared = path.join(root, "shared");
    const skill = path.join(dist, "skills", "codex", "terminal-browser");
    const defaultSkill = path.join(dist, "skills", "default", "terminal-browser");
    const editor = path.join(appData, "Code", "User");
    fs.mkdirSync(skill, { recursive: true });
    fs.mkdirSync(defaultSkill, { recursive: true });
    fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(editor, "globalStorage"), { recursive: true });
    fs.writeFileSync(path.join(editor, "globalStorage", "state.vscdb"), "");
    fs.writeFileSync(path.join(dist, "VERSION"), "test-version\n");
    fs.writeFileSync(
      path.join(dist, "skills", "manifest"),
      "agent codex .codex/skills codex\nskill terminal-browser\n",
    );

    const child = spawnSync(process.execPath, [path.join(__dirname, "..", "dist", "main.js"), "setup"], {
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_SKILLS_HOME: shared,
        APPDATA: appData,
        HOME: home,
        LOCALAPPDATA: localAppData,
        NODE_NO_WARNINGS: "1",
        TERMINAL_BROWSER_DIST_ROOT: dist,
        USERPROFILE: home,
      },
    });

    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /installed agent skills \(2\)/);
    assert.match(child.stdout, /enabled terminal images in Code/);
    assert.equal(
      fs.realpathSync(path.join(home, ".codex", "skills", "terminal-browser")),
      fs.realpathSync(skill),
    );
    assert.equal(fs.realpathSync(path.join(shared, "terminal-browser")), fs.realpathSync(defaultSkill));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(editor, "settings.json"), "utf8"))["terminal.integrated.enableImages"],
      true,
    );
    assert.equal(
      fs.readFileSync(path.join(localAppData, "terminal-browser", "setup-version"), "utf8").trim(),
      `test-version ${dist}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
