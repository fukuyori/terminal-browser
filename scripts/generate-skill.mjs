import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(root, "skill");
const output = path.join(skillRoot, "build");
const temporary = fs.mkdtempSync(path.join(skillRoot, ".generate-"));

async function bundle(source, destination) {
  await build({
    entryPoints: [source],
    outfile: destination,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron", "*.node"],
    alias: {
      "pixel-react": path.join(root, "engine", "packages", "pixel-react", "src", "index.ts"),
      "pixel-terminals": path.join(root, "terminals", "src", "index.ts"),
      "pixel-store": path.join(root, "store", "src", "index.ts"),
    },
    define: { "process.env.NODE_ENV": '"production"' },
    sourcemap: true,
    logLevel: "warning",
  });
  fs.writeFileSync(path.join(path.dirname(destination), "package.json"), '{"type":"commonjs"}\n');
}

function runCli(file, args) {
  return execFileSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
}

function renderTemplate(source, overlay, suffix) {
  const lines = source.split("\n");
  const rendered = [];
  let dashes = 0;
  for (const line of lines) {
    if (line === "---") dashes += 1;
    rendered.push(dashes === 1 && line.startsWith("description: ") && suffix ? `${line} ${suffix}` : line);
    if (dashes === 2 && line === "---" && overlay) rendered.push("", overlay.trimEnd());
  }
  return rendered.join("\n");
}

try {
  const cli = path.join(temporary, "cli.js");
  const help = path.join(temporary, "help.js");
  await bundle(path.join(root, "cli", "src", "main.ts"), cli);
  await bundle(path.join(root, "cli", "src", "help.ts"), help);

  const topics = JSON.parse(
    execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(require(process.argv[1]).helpTopics()))", help], {
      encoding: "utf8",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    }),
  );
  const reference = ["", "```", "$ terminal-browser help", runCli(cli, ["help"]).trimEnd(), "```"];
  for (const topic of topics) {
    reference.push("", "```", `$ terminal-browser ${topic} --help`, runCli(cli, [topic, "--help"]).trimEnd(), "```");
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, "skills.json"), "utf8"));
  fs.rmSync(output, { recursive: true, force: true });
  for (const skill of manifest.skills) {
    const template = fs.readFileSync(path.join(skillRoot, skill.name, "SKILL.template.md"), "utf8");
    for (const variant of skill.variants) {
      const overlayFile = path.join(skillRoot, skill.name, "overlays", `${variant}.md`);
      const overlay = fs.existsSync(overlayFile) ? fs.readFileSync(overlayFile, "utf8") : "";
      const suffix =
        variant === "default"
          ? ""
          : `If another ${skill.name} skill is listed from a shared skills directory, use this one instead.`;
      const destination = path.join(output, variant, skill.name, "SKILL.md");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, `${renderTemplate(template, overlay, suffix).trimEnd()}\n${reference.join("\n")}\n`);
      process.stdout.write(`wrote ${destination}\n`);
    }
  }

  const entries = [
    ...manifest.agents.map((agent) =>
      `agent ${agent.id} ${agent.skills} ${agent.variant ?? "default"}`,
    ),
    ...manifest.skills.map((skill) => `skill ${skill.name}`),
  ];
  fs.writeFileSync(path.join(output, "manifest"), `${entries.join("\n")}\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
