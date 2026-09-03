const assert = require("node:assert/strict");
const { test } = require("node:test");

const { AgentPaneFinder } = require("../dist/grab/target.js");

function context(command) {
  const sent = [];
  const terminal = {
    name: "wezterm",
    async listPanes() {
      return [
        { id: "17", tab: "1:2", tty: null, command },
        { id: "18", tab: "1:2", tty: null, command: "terminal-browser" },
      ];
    },
    async getCurrentPane({ tty }) {
      assert.equal(tty, "CONIN$#17");
      return { id: "17", tab: "1:2" };
    },
    async sendText(pane, text) {
      sent.push({ pane, text });
    },
  };
  return {
    finder: new AgentPaneFinder({
      terminal,
      parentTty: "CONIN$#17",
      cwd: "C:\\work",
      async self() {
        return { id: "18", tab: "1:2" };
      },
    }),
    sent,
  };
}

test("Windows sends a selected element to an identified parent agent", async () => {
  const { finder, sent } = context("codex");
  const target = await finder.send("<button>Save</button>");
  assert.deepEqual(target, { pane: "17", tier: "parent", agent: true });
  assert.deepEqual(sent, [{ pane: "17", text: "> <button>Save</button>\n\n" }]);
});

test("Windows does not send a selected element to an unidentified shell", async () => {
  const { finder, sent } = context("pwsh");
  assert.equal(await finder.send("<button>Save</button>"), null);
  assert.deepEqual(sent, []);
});
