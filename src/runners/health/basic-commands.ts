import path from "node:path";
import type { HealthCategory } from "../../core/health-category.js";
import type { ProviderDetection, RepositoryContext } from "../../core/types.js";
import { isNonMutatingQualityCommand, isNonMutatingTestCommand } from "../../repository/script-detection.js";
import { PROVIDERS } from "../../providers/catalog.js";
import { expectedLocalBinary, type RunnableCommand } from "./task-executor.js";

type ScriptKind = "general" | "format" | "test";

export function safeScriptFrom(scripts: Record<string, string>, names: string[], kind: ScriptKind): string | null {
  for (const name of names) {
    const command = scripts[name];
    if (!command || /--fix(?:\s|$)|--write(?:\s|$)|\bwatch\b|--watch/.test(command)) continue;
    if (kind === "test" && !isNonMutatingTestCommand(command)) continue;
    if (kind !== "test" && !isNonMutatingQualityCommand(command)) continue;
    if (kind === "format" && name === "format") continue;
    return name;
  }
  return null;
}

export function safeScript(context: RepositoryContext, names: string[], kind: ScriptKind): string | null {
  return safeScriptFrom(context.scripts, names, kind);
}

export function scriptCommand(context: RepositoryContext, script: string): Pick<RunnableCommand, "command" | "args" | "env"> {
  const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
  return {
    command: executable,
    args: process.platform === "win32" ? ["/d", "/s", "/c", context.scripts[script]!] : ["-c", context.scripts[script]!],
    env: { CI: "1", INIT_CWD: context.root, npm_lifecycle_event: script, npm_package_json: path.join(context.root, "package.json"), PATH: `${path.join(context.root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}` },
  };
}

function workspaceScriptCommand(context: RepositoryContext, workspace: string, script: string): Pick<RunnableCommand, "command" | "args" | "env"> {
  const packageManager = context.packageManager!;
  const args = packageManager === "npm" ? ["run", "--prefix", workspace, script]
    : packageManager === "pnpm" ? ["--dir", workspace, "run", script]
      : packageManager === "yarn" ? ["--cwd", workspace, script] : ["--cwd", workspace, "run", script];
  return { command: packageManager, args, env: { CI: "1", INIT_CWD: context.root, npm_lifecycle_event: script, npm_package_json: path.join(context.root, workspace, "package.json"), PATH: `${path.join(context.root, workspace, "node_modules", ".bin")}${path.delimiter}${path.join(context.root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}` } };
}

export async function basicCommands(context: RepositoryContext, detections: Map<string, ProviderDetection>, timeoutMs?: number): Promise<RunnableCommand[]> {
  if (!context.packageManager) return [];
  const commands: RunnableCommand[] = [];
  const withTimeout = timeoutMs === undefined ? {} : { timeoutMs };
  const addScript = (category: HealthCategory, names: string[], kind: ScriptKind) => {
    const script = safeScript(context, names, kind);
    if (!script) return false;
    commands.push({ provider: `script:${script}`, name: `script:${script}`, category, ...scriptCommand(context, script), ...withTimeout });
    return true;
  };
  if (!addScript("types", ["typecheck", "type-check", "check:types", "types"], "general") && detections.get("typescript")?.activeCapabilities.typeChecking && [...context.files].some((file) => /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(file))) {
    commands.push({ provider: "typescript", name: "TypeScript", category: "types", command: await expectedLocalBinary(context.root, "tsc"), args: ["--noEmit", "--pretty", "false"], ...withTimeout });
  }
  if (!addScript("lint", ["lint", "check:lint", "lint:check"], "general")) {
    for (const [id, name, args] of [["eslint", "ESLint", ["."]], ["oxlint", "Oxlint", ["."]], ["biome", "Biome", ["lint", "."]]] as Array<[string, string, string[]]>) {
      if (detections.get(id)?.activeCapabilities.linting) commands.push({ provider: id, name, category: "lint", command: await expectedLocalBinary(context.root, id), args, ...withTimeout });
    }
  }
  if (!addScript("format", ["format:check", "check:format", "format-check"], "format")) {
    if (detections.get("prettier")?.activeCapabilities.formatting) commands.push({ provider: "prettier", name: "Prettier", category: "format", command: await expectedLocalBinary(context.root, "prettier"), args: ["--check", "."], ...withTimeout });
    else if (detections.get("oxfmt")?.activeCapabilities.formatting) commands.push({ provider: "oxfmt", name: "Oxfmt", category: "format", command: await expectedLocalBinary(context.root, "oxfmt"), args: ["--check", "."], ...withTimeout });
    else if (detections.get("biome")?.activeCapabilities.formatting) commands.push({ provider: "biome-format", name: "Biome format", category: "format", command: await expectedLocalBinary(context.root, "biome"), args: ["format", "."], ...withTimeout });
  }
  if (!addScript("tests", ["test", "test:run", "check:test"], "test")) {
    for (const [id, name, args] of [["vitest", "Vitest", ["run"]], ["jest", "Jest", ["--runInBand"]]] as Array<[string, string, string[]]>) {
      if (detections.get(id)?.activeCapabilities.testing) commands.push({ provider: id, name, category: "tests", command: await expectedLocalBinary(context.root, id), args, env: { CI: "1" }, ...withTimeout });
    }
  }
  for (const provider of PROVIDERS) {
    if (provider.id === "c8" || provider.id === "markdownlint" || !provider.scriptNames?.length || !Object.keys(detections.get(provider.id)?.activeCapabilities ?? {}).length) continue;
    const script = safeScript(context, provider.scriptNames, provider.scriptKind === "test" ? "test" : "general");
    if (script && !commands.some((command) => command.provider === `script:${script}`)) commands.push({ provider: provider.id, name: provider.name, category: provider.category, ...scriptCommand(context, script), ...withTimeout });
  }
  for (const manifest of context.manifests) {
    const workspace = path.posix.dirname(manifest.path.replaceAll(path.sep, "/"));
    if (workspace === ".") continue;
    for (const check of [{ category: "types", names: ["typecheck", "type-check", "check:types"], kind: "general" }, { category: "lint", names: ["lint", "check:lint", "lint:check"], kind: "general" }, { category: "format", names: ["format:check", "check:format", "format-check"], kind: "general" }, { category: "tests", names: ["test", "test:run", "check:test"], kind: "test" }] as Array<{ category: HealthCategory; names: string[]; kind: "general" | "test" }>) {
      const script = safeScriptFrom(manifest.packageJson.scripts ?? {}, check.names, check.kind);
      if (script) commands.push({ provider: `workspace:${workspace}:${script}`, name: `${workspace} ${script}`, category: check.category, scope: workspace, ...workspaceScriptCommand(context, workspace, script), ...withTimeout });
    }
  }
  return commands;
}
