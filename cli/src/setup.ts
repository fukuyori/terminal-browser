import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { enableTerminalImages } from "./editors";
import { installedVersion } from "./upgrade";

interface AgentEntry {
  name: string;
  location: string;
  variant: string;
}

interface Manifest {
  agents: AgentEntry[];
  skills: string[];
}

export interface SetupLocations {
  home?: string;
  state?: string;
  dist?: string | null;
  shared?: string;
}

function homeDir(locations: SetupLocations): string {
  return locations.home ?? os.homedir();
}

function stateDir(locations: SetupLocations): string {
  if (locations.state) return locations.state;
  const home = homeDir(locations);
  if (process.platform === "win32") {
    const configured = process.env.LOCALAPPDATA;
    const base = configured && path.isAbsolute(configured) ? configured : path.join(home, "AppData", "Local");
    return path.join(base, "terminal-browser");
  }
  const configured = process.env.XDG_STATE_HOME;
  const base = configured && path.isAbsolute(configured) ? configured : path.join(home, ".local", "state");
  return path.join(base, "terminal-browser");
}

function distRoot(locations: SetupLocations): string | null {
  const configured =
    "dist" in locations ? locations.dist ?? null : process.env.TERMINAL_BROWSER_DIST_ROOT ?? null;
  return configured ? path.resolve(configured) : null;
}

function readManifest(root: string): Manifest | null {
  let lines: string[];
  try {
    lines = fs.readFileSync(path.join(root, "skills", "manifest"), "utf8").split("\n");
  } catch {
    return null;
  }
  const manifest: Manifest = { agents: [], skills: [] };
  for (const line of lines) {
    const [kind, ...rest] = line.split(" ").filter(Boolean);
    if (kind === "agent" && rest.length >= 2) {
      manifest.agents.push({ name: rest[0], location: rest[1], variant: rest[2] ?? "default" });
    }
    if (kind === "skill" && rest[0]) manifest.skills.push(rest[0]);
  }
  return manifest;
}

function isLink(file: string): boolean {
  return fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;
}

function exists(file: string): boolean {
  return fs.lstatSync(file, { throwIfNoEntry: false }) !== undefined;
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export interface SkillLinks {
  linkedAgents: string[];
  linkedPaths: string[];
  left: string[];
}

export function linkSkills(locations: SetupLocations = {}): SkillLinks {
  const result: SkillLinks = { linkedAgents: [], linkedPaths: [], left: [] };
  const root = distRoot(locations);
  if (!root) return result;
  const manifest = readManifest(root);
  if (!manifest) return result;

  const wrote = new Set<string>();
  const place = (target: string, link: string): boolean => {
    if (exists(link) && !isLink(link)) {
      result.left.push(link);
      return false;
    }
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.rmSync(link, { force: true });
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    wrote.add(link);
    result.linkedPaths.push(link);
    return true;
  };

  const home = homeDir(locations);
  for (const agent of manifest.agents) {
    const directory = path.join(home, agent.location);
    if (!exists(path.dirname(directory))) continue;
    let made = false;
    for (const skill of manifest.skills) {
      const target = path.join(root, "skills", agent.variant, skill);
      const link = path.join(directory, skill);
      if (!fs.existsSync(target)) continue;
      if (place(target, link)) made = true;
    }
    if (made) result.linkedAgents.push(agent.name);
  }

  const shared =
    locations.shared ?? process.env.AGENT_SKILLS_HOME ?? path.join(home, ".agents", "skills");
  for (const skill of manifest.skills) {
    const target = path.join(root, "skills", "default", skill);
    const link = path.join(shared, skill);
    if (!fs.existsSync(target)) continue;
    place(target, link);
  }

  const receiptFile = path.join(stateDir(locations), "skills.links");
  let recorded: string[] = [];
  try {
    recorded = fs.readFileSync(receiptFile, "utf8").split("\n").filter(Boolean);
  } catch {}
  for (const link of recorded) {
    if (wrote.has(link) || !isLink(link)) continue;
    let target: string | null = null;
    try {
      target = fs.realpathSync(link);
    } catch {}
    if (target === null || inside(root, target)) fs.rmSync(link, { force: true });
  }
  fs.mkdirSync(stateDir(locations), { recursive: true });
  fs.writeFileSync(receiptFile, `${[...wrote].sort().join("\n")}${wrote.size > 0 ? "\n" : ""}`);
  return result;
}

function marker(): { file: string; want: string } | null {
  const root = distRoot({});
  const version = installedVersion();
  if (!root || !version) return null;
  return { file: path.join(stateDir({}), "setup-version"), want: `${version} ${root}` };
}

export function markSetupDone(): void {
  const state = marker();
  if (!state) return;
  fs.mkdirSync(path.dirname(state.file), { recursive: true });
  fs.writeFileSync(state.file, `${state.want}\n`);
}

export function ensureSetup(): void {
  const state = marker();
  if (!state) return;
  try {
    if (fs.readFileSync(state.file, "utf8").trim() === state.want) return;
  } catch {}
  try {
    linkSkills();
    enableTerminalImages();
    markSetupDone();
  } catch {}
}
