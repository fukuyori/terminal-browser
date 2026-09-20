const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

function loadPlugin(module = "register.tsx") {
  const cache = new Map();
  const h = (element, props, ...children) => ({ element, props, children });
  const load = file => {
    if (cache.has(file)) return cache.get(file);
    const api = {};
    cache.set(file, api);
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: "h" },
      fileName: file,
    });
    new Function("exports", "require", "h", compiled.outputText)(api, name => {
      const target = path.resolve(path.dirname(file), name);
      return load(path.extname(target) ? target : target + ".ts");
    }, h);
    return api;
  };
  return load(path.resolve(__dirname, "../../claude-code-plugin/hooks", module));
}

test("a pointer tick cannot overwrite the Client's resize notification", () => {
  const render = loadPlugin("surface.tsx").default;
  let state, tick, pointer, posted;
  const surface = {
    elements: { Box: "Box" }, columns: 49, rows: 35,
    get state() { return state; },
    setState(next) { state = next; },
    onPointer(callback) { pointer = callback; },
    onKey() {},
    every(_ms, callback) { tick = callback; },
    post(value) { posted = value; },
  };
  render({}, surface);
  tick();
  assert.equal(posted.cols, 49);
  assert.equal(posted.rows, 35);
  posted = undefined;
  surface.columns = 89;
  surface.rows = 53;
  render({}, surface);
  pointer({ type: "move", x: 2, y: 3 });
  tick();
  assert.equal(posted.cols, 89);
  assert.equal(posted.rows, 53);
  assert.equal(posted.events.length, 1);
  posted = undefined;
  surface.columns = 49;
  surface.rows = 35;
  render({}, surface);
  tick();
  assert.equal(posted.cols, 49);
  assert.equal(posted.rows, 35);
  assert.equal(posted.events.length, 0);
});

for (const alive of [false, true]) {
  test(`the production plugin drops a lost frame when alive=${alive}`, async () => {
    const handlers = new Map();
    loadPlugin().register((name, ...args) => handlers.set(name, args.at(-1)), {});
    let frame = { sequence: 1, cols: 48, rows: 24, source: { png: "test" } };
    let cols = 48, rows = 24;
    const requests = [];
    let fresh = { alive: true, frame, title: "test", error: null, inbox: 0 };
    let tick;
    const $ = {
      plugin: { root: "/checkout/claude-code-plugin" },
      fs: { exists: async () => true },
      process: { run: async args => ({ exitCode: 0, stdout: JSON.stringify(args.includes("capabilities")
        ? { capabilities: ["image-embedding"] } : { port: 1234, token: "test" }) }) },
      clock: { every: (_ms, callback) => { tick = callback; return { cancel() {} }; } },
      http: { fetch: async (url, options) => {
        requests.push({ route: new URL(url).pathname, body: options.body && JSON.parse(options.body) });
        return { ok: true, text: JSON.stringify(url.endsWith("/state") ? fresh
          : url.includes("/frame?") ? { frame: fresh.frame } : {}) };
      } },
      ui: { open: async () => {}, invalidate() {}, log() {},
        resolve: async () => ({ Box: "Box", Client: "Client", Image: "Image", Text: "Text" }) },
    };
    const render = () => handlers.get("ui.render")($, {
      surface: "terminal", props: { scroll: { bodyRows: rows }, bodyColumns: cols },
    });
    const poll = async () => { tick(); await new Promise(resolve => setImmediate(resolve)); };
    await handlers.get("command.run")($, { args: "https://example.com" });
    await handlers.get("ui.message")($, {
      requestId: "browser", element: "view1", data: { type: "surface", cols: 48, rows: 24, events: [] },
    }, () => {});
    await poll();
    assert.match(JSON.stringify(await render()), /"element":"Image"/);
    if (alive) {
      cols = 89; rows = 53;
      requests.length = 0;
      await handlers.get("ui.message")($, {
        requestId: "browser", element: "view1",
        data: { type: "surface", cols, rows, events: [{ type: "mouse", kind: "move", x: 2, y: 3 }] },
      }, () => {});
      assert.deepEqual(requests.map(request => request.route), ["/size", "/input"]);
      assert.deepEqual(requests[0].body, { cols, rows });
      await poll();
      assert.doesNotMatch(JSON.stringify(await render()), /"element":"Image"/);
      frame = { ...frame, cols, rows, sequence: 2 };
      fresh = { ...fresh, frame };
      await poll();
      assert.match(JSON.stringify(await render()), /"element":"Image"/);
    }
    fresh = { ...fresh, alive, frame: null };
    await poll();
    const tree = JSON.stringify(await render());
    assert.doesNotMatch(tree, /"element":"Image"/);
    assert.match(tree, alive ? /Loading browser/ : /Browser stopped/);
    if (alive) {
      fresh = { ...fresh, frame: { ...frame, sequence: 2 } };
      await poll();
      assert.match(JSON.stringify(await render()), /"element":"Image"/);
    }
  });
}
