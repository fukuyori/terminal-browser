import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// .claude/types holds the plugin API declarations the plugin's tsconfig includes.
// They are gitignored and tied to the installed Claude Code, so we regenerate
// them here rather than checking them in. Claude Code writes them via /plugin-types.
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "claude-code-plugin", ".claude", "types");

if (process.argv.includes("--if-missing") && fs.existsSync(path.join(dir, "claude-code.d.ts"))) {
  process.exit(0);
}

// node cannot start a .cmd or .ps1 without a shell, and npm installs claude as
// both, so take whichever entry on PATH node can run itself.
function claudeOnPath() {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""];
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    for (const ext of exts) {
      const candidate = path.join(entry, `claude${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const claude = claudeOnPath();
if (!claude) {
  process.stderr.write(
    "plugin-types: claude is not on PATH, skipping (run 'pnpm types' once it is installed)\n",
  );
  process.exit(0);
}

fs.mkdirSync(dir, { recursive: true });
const result = spawnSync(claude, ["-p", `/plugin-types ${dir}`], {
  stdio: "inherit",
  env: { ...process.env, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1" },
  shell: path.extname(claude).toLowerCase() === ".cmd",
});
if (result.error || result.status !== 0) {
  process.stderr.write("plugin-types: claude could not generate the types, skipping\n");
}
