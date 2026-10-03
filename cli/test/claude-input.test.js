const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const file = path.resolve(__dirname, "../../claude-code-plugin/hooks/input.ts");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const api = {};
new Function("exports", compiled.outputText)(api);

test("IME chunks and special keys use the production Client mapper", () => {
  assert.equal(api.keyEvent({ key: "日" }).text, "日");
  assert.deepEqual(api.keyEvent({ key: "本語テスト" }), {
    type: "key", key: "unknown", text: "本語テスト", mods: { shift: false, alt: false, ctrl: false, super: false },
  });
  assert.equal(api.keyEvent({ key: "return" }).key, "enter");
  assert.equal(api.keyEvent({ key: "a", ctrl: true }).text, undefined);
  assert.equal(api.keyEvent({ key: "本語", meta: true }), null);
  assert.equal(api.keyEvent({ key: "" }), null);
});

test("successive multi-character commits use text insertion without clipboard pastes", () => {
  const chunks = ["日本", "語入力", "テスト"];
  const events = chunks.map(key => api.keyEvent({ key }));
  assert.deepEqual(events.map(event => event.text), chunks);
  assert.ok(events.every(event => event.type === "key" && event.key === "unknown"));
});

test("pointer coordinates retain fractions and centre a cell only once", () => {
  assert.equal(api.pointerEvent({ type: "down", x: 3, y: 5, fine: { x: 3.2, y: 5.7 } }).x, 3.2);
  assert.equal(api.pointerEvent({ type: "down", x: 3, y: 5 }).x, 3.5);
  assert.equal(api.pointerEvent({ type: "leave", x: 3, y: 5 }).kind, "move");
});
