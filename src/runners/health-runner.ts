import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fg from "fast-glob";
import type { RepnixConfig } from "../config/repo-health-config.js";
import { createFinding } from "../core/finding.js";
import { HEALTH_CATEGORIES, type HealthCategory } from "../core/health-category.js";
import type {
  FindingSeverity,
  HealthFinding,
  HealthResult,
  HealthRun,
  ProviderDetection,
  RepositoryContext,
} from "../core/types.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import { runCommand, type CommandResult } from "./command-runner.js";

export interface RunHealthOptions {
  category?: HealthCategory;
  verbose?: boolean;
}

interface RunnableCommand {
  provider: string;
  name: string;
  category: HealthCategory;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

const HEALTH_OFFLINE_ENV: NodeJS.ProcessEnv = {
  COREPACK_ENABLE_NETWORK: "0",
  COREPACK_DEFAULT_TO_LATEST: "0",
  npm_config_offline: "true",
  PNPM_CONFIG_OFFLINE: "true",
  YARN_ENABLE_NETWORK: "0",
};

async function localBinary(root: string, binary: string): Promise<string | null> {
  const file = path.join(root, "node_modules", ".bin", `${binary}${process.platform === "win32" ? ".cmd" : ""}`);
  try {
    await access(file);
    return file;
  } catch {
    return null;
  }
}

async function expectedLocalBinary(root: string, binary: string): Promise<string> {
  return (
    (await localBinary(root, binary)) ??
    path.join(root, "node_modules", ".bin", `${binary}${process.platform === "win32" ? ".cmd" : ""}`)
  );
}

function safeScript(context: RepositoryContext, names: string[], kind: "general" | "format" | "test"): string | null {
  for (const name of names) {
    const command = context.scripts[name];
    if (!command) continue;
    if (/--fix(?:\s|$)|--write(?:\s|$)|\bwatch\b|--watch/.test(command)) continue;
    if (kind === "test" && /no test specified/i.test(command)) continue;
    if (kind === "format" && name === "format") continue;
    return name;
  }
  return null;
}

function scriptCommand(context: RepositoryContext, script: string): Pick<RunnableCommand, "command" | "args" | "env"> {
  const command = context.scripts[script]!;
  const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
  return {
    command: executable,
    args,
    env: {
      CI: "1",
      INIT_CWD: context.root,
      npm_lifecycle_event: script,
      npm_package_json: path.join(context.root, "package.json"),
      PATH: `${path.join(context.root, "node_modules", ".bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  };
}

function outputExcerpt(result: CommandResult): string {
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  return combined.length > 4000 ? combined.slice(-4000) : combined;
}

function commandResult(
  runnable: RunnableCommand,
  result: CommandResult,
): HealthResult {
  if (result.spawnError) {
    return {
      provider: runnable.provider,
      name: runnable.name,
      category: runnable.category,
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: result.spawnError,
    };
  }
  if (result.exitCode === 0) {
    return {
      provider: runnable.provider,
      name: runnable.name,
      category: runnable.category,
      status: "pass",
      findings: [],
      durationMs: result.durationMs,
    };
  }
  const excerpt = outputExcerpt(result);
  if (
    result.exitCode === 126 ||
    result.exitCode === 127 ||
    /(?:command not found|not recognized as an internal|could not determine executable|network access disabled|cannot find matching keyid)/i.test(excerpt)
  ) {
    return {
      provider: runnable.provider,
      name: runnable.name,
      category: runnable.category,
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: `${runnable.name} is configured but its executable is unavailable. Install repository dependencies first.`,
    };
  }
  return {
    provider: runnable.provider,
    name: runnable.name,
    category: runnable.category,
    status: "fail",
    findings: [
      createFinding({
        provider: runnable.name,
        category: runnable.category,
        type: "command-failure",
        severity: "error",
        message: `${runnable.name} exited with code ${result.exitCode ?? "unknown"}.`,
        metadata: {
          command: [runnable.command, ...runnable.args].join(" "),
          output: excerpt,
        },
      }),
    ],
    durationMs: result.durationMs,
  };
}

async function basicCommands(
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
): Promise<RunnableCommand[]> {
  if (!context.packageManager) return [];
  const commands: RunnableCommand[] = [];
  const addScript = (category: HealthCategory, names: string[], kind: "general" | "format" | "test") => {
    const script = safeScript(context, names, kind);
    if (!script) return false;
    commands.push({
      provider: `script:${script}`,
      name: `script:${script}`,
      category,
      ...scriptCommand(context, script),
    });
    return true;
  };

  if (!addScript("types", ["typecheck", "type-check", "check:types", "types"], "general")) {
    const tsc = detections.get("typescript");
    if (tsc?.activeCapabilities.typeChecking && [...context.files].some((file) => /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(file))) {
      const binary = await expectedLocalBinary(context.root, "tsc");
      commands.push({ provider: "typescript", name: "TypeScript", category: "types", command: binary, args: ["--noEmit", "--pretty", "false"] });
    }
  }

  if (!addScript("lint", ["lint", "check:lint", "lint:check"], "general")) {
    const lintFallbacks: Array<[string, string, string[]]> = [
      ["eslint", "ESLint", ["."]],
      ["oxlint", "Oxlint", ["."]],
      ["biome", "Biome", ["lint", "."]],
    ];
    for (const [id, name, args] of lintFallbacks) {
      if (!detections.get(id)?.activeCapabilities.linting) continue;
      const binary = await expectedLocalBinary(context.root, id === "biome" ? "biome" : id);
      commands.push({ provider: id, name, category: "lint", command: binary, args });
    }
  }

  if (!addScript("format", ["format:check", "check:format", "format-check"], "format")) {
    if (detections.get("prettier")?.activeCapabilities.formatting) {
      const binary = await expectedLocalBinary(context.root, "prettier");
      commands.push({ provider: "prettier", name: "Prettier", category: "format", command: binary, args: ["--check", "."] });
    } else if (detections.get("biome")?.activeCapabilities.formatting) {
      const binary = await expectedLocalBinary(context.root, "biome");
      commands.push({ provider: "biome-format", name: "Biome format", category: "format", command: binary, args: ["format", "."] });
    }
  }

  if (!addScript("tests", ["test", "test:run", "check:test"], "test")) {
    const tests: Array<[string, string, string[]]> = [
      ["vitest", "Vitest", ["run"]],
      ["jest", "Jest", ["--runInBand"]],
    ];
    for (const [id, name, args] of tests) {
      if (!detections.get(id)?.activeCapabilities.testing) continue;
      const binary = await expectedLocalBinary(context.root, id);
      commands.push({ provider: id, name, category: "tests", command: binary, args, env: { CI: "1" } });
    }
  }
  return commands;
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const lines = trimmed.split("\n").reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        // Keep looking for a machine-readable line.
      }
    }
    throw new Error("Provider did not emit valid JSON.");
  }
}

const KNIP_TYPES: Record<string, { type: string; severity: FindingSeverity; label: string }> = {
  files: { type: "unused-file", severity: "warning", label: "Unused file" },
  exports: { type: "unused-export", severity: "warning", label: "Unused export" },
  nsExports: { type: "unused-export", severity: "warning", label: "Unused namespace export" },
  types: { type: "unused-export", severity: "warning", label: "Unused exported type" },
  nsTypes: { type: "unused-export", severity: "warning", label: "Unused namespace type" },
  enumMembers: { type: "unused-export", severity: "warning", label: "Unused enum member" },
  namespaceMembers: { type: "unused-export", severity: "warning", label: "Unused namespace member" },
  dependencies: { type: "unused-dependency", severity: "warning", label: "Unused dependency" },
  devDependencies: { type: "unused-dependency", severity: "warning", label: "Unused dev dependency" },
  optionalPeerDependencies: { type: "unused-dependency", severity: "warning", label: "Unused optional peer dependency" },
  unlisted: { type: "missing-dependency", severity: "error", label: "Unlisted dependency" },
  unresolved: { type: "unresolved-import", severity: "error", label: "Unresolved import" },
};

export function normalizeKnip(report: unknown): HealthFinding[] {
  if (!report || typeof report !== "object" || !("issues" in report) || !Array.isArray((report as { issues: unknown }).issues)) {
    throw new Error("Knip JSON report has an unsupported shape.");
  }
  const findings: HealthFinding[] = [];
  for (const issue of (report as { issues: unknown[] }).issues) {
    if (!issue || typeof issue !== "object") continue;
    const record = issue as Record<string, unknown>;
    const file = typeof record.file === "string" ? record.file : undefined;
    for (const [key, mapping] of Object.entries(KNIP_TYPES)) {
      const entries = record[key];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const value = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        const name = typeof value.name === "string" ? value.name : file ?? "unknown";
        findings.push(createFinding({
          provider: "Knip",
          category: "dead-code",
          type: mapping.type,
          severity: mapping.severity,
          message: `${mapping.label}: ${name}`,
          ...(file ? { file } : {}),
          ...(typeof value.line === "number" ? { line: value.line } : {}),
          metadata: { issueType: key, name },
        }));
      }
    }
  }
  return findings;
}

export async function runKnip(context: RepositoryContext, verbose: boolean): Promise<HealthResult> {
  const binary = await localBinary(context.root, "knip");
  if (!binary) return { provider: "knip", name: "Knip", category: "dead-code", status: "error", findings: [], durationMs: 0, message: "Knip is declared but its local binary is unavailable. Install dependencies first." };
  const result = await runCommand(binary, ["--reporter", "json"], { cwd: context.root, verbose, env: HEALTH_OFFLINE_ENV });
  if (result.spawnError) return { provider: "knip", name: "Knip", category: "dead-code", status: "error", findings: [], durationMs: result.durationMs, message: result.spawnError };
  try {
    const findings = normalizeKnip(parseJsonOutput(result.stdout));
    return { provider: "knip", name: "Knip", category: "dead-code", status: findings.length ? (findings.some((item) => item.severity === "error") ? "fail" : "warn") : "pass", findings, durationMs: result.durationMs };
  } catch (error) {
    return { provider: "knip", name: "Knip", category: "dead-code", status: "error", findings: [], durationMs: result.durationMs, message: `${error instanceof Error ? error.message : String(error)} ${outputExcerpt(result)}`.trim() };
  }
}

export function normalizeJscpd(report: unknown): HealthFinding[] {
  if (!report || typeof report !== "object" || !("duplicates" in report) || !Array.isArray((report as { duplicates: unknown }).duplicates)) {
    throw new Error("jscpd JSON report has an unsupported shape.");
  }
  return (report as { duplicates: unknown[] }).duplicates.map((duplicate) => {
    const item = duplicate as Record<string, unknown>;
    const first = (item.firstFile ?? {}) as Record<string, unknown>;
    const second = (item.secondFile ?? {}) as Record<string, unknown>;
    const firstName = typeof first.name === "string" ? first.name : "unknown";
    const secondName = typeof second.name === "string" ? second.name : "unknown";
    const lines = typeof item.lines === "number" ? item.lines : 0;
    return createFinding({
      provider: "jscpd",
      category: "duplication",
      type: "duplication",
      severity: "warning",
      message: `Duplicated block: ${lines} lines between ${firstName} and ${secondName}`,
      file: firstName,
      ...(typeof first.start === "number" ? { line: first.start } : {}),
      metadata: { files: [firstName, secondName], lines, firstFile: first, secondFile: second },
    });
  });
}

export async function runJscpd(context: RepositoryContext, verbose: boolean): Promise<HealthResult> {
  const binary = await localBinary(context.root, "jscpd");
  if (!binary) return { provider: "jscpd", name: "jscpd", category: "duplication", status: "error", findings: [], durationMs: 0, message: "jscpd is declared but its local binary is unavailable. Install dependencies first." };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "repnix-jscpd-"));
  try {
    const result = await runCommand(binary, [...context.sourceRoots, "--reporters", "json", "--output", temporary], { cwd: context.root, verbose, env: HEALTH_OFFLINE_ENV });
    if (result.spawnError) return { provider: "jscpd", name: "jscpd", category: "duplication", status: "error", findings: [], durationMs: result.durationMs, message: result.spawnError };
    const reports = await fg("**/jscpd-report.json", { cwd: temporary, absolute: true, onlyFiles: true });
    if (!reports.length) return { provider: "jscpd", name: "jscpd", category: "duplication", status: "error", findings: [], durationMs: result.durationMs, message: `jscpd did not create a JSON report. ${outputExcerpt(result)}`.trim() };
    const findings = normalizeJscpd(JSON.parse(await readFile(reports[0]!, "utf8")) as unknown);
    return { provider: "jscpd", name: "jscpd", category: "duplication", status: findings.length ? "warn" : "pass", findings, durationMs: result.durationMs };
  } catch (error) {
    return { provider: "jscpd", name: "jscpd", category: "duplication", status: "error", findings: [], durationMs: 0, message: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function severityAtLeast(severity: FindingSeverity, threshold: FindingSeverity): boolean {
  const rank: Record<FindingSeverity, number> = { info: 0, warning: 1, error: 2 };
  return rank[severity] >= rank[threshold];
}

function categoryOrder(category: HealthCategory): number {
  return HEALTH_CATEGORIES.indexOf(category);
}

export async function runHealth(
  audit: AuditModel,
  config: RepnixConfig,
  options: RunHealthOptions = {},
): Promise<HealthRun> {
  const { context, detections } = audit;
  const results: HealthResult[] = [];
  if (!context.packageManager || context.diagnostics.some((item) => item.severity === "error")) {
    results.push({ provider: "repnix", name: "RepNix configuration", category: options.category ?? "types", status: "error", findings: [], durationMs: 0, message: context.diagnostics.find((item) => item.severity === "error")?.message ?? "Package manager unresolved" });
  } else {
    const requiredMissing = audit.coverage.filter((entry) =>
      (!options.category || entry.category === options.category) &&
      config.categories?.[entry.category] === "required" &&
      entry.status !== "covered",
    );
    for (const entry of requiredMissing) {
      results.push({ provider: "repnix", name: "Required coverage", category: entry.category, status: "error", findings: [], durationMs: 0, message: `Required category '${entry.category}' has no active provider.` });
    }

    const commands = await basicCommands(context, detections);
    for (const runnable of commands) {
      if (options.category && runnable.category !== options.category) continue;
      if (config.categories?.[runnable.category] === "off") continue;
      const result = await runCommand(runnable.command, runnable.args, {
        cwd: context.root,
        ...(options.verbose !== undefined ? { verbose: options.verbose } : {}),
        env: { ...HEALTH_OFFLINE_ENV, ...runnable.env },
      });
      results.push(commandResult(runnable, result));
    }
    if ((!options.category || options.category === "dead-code") && config.categories?.["dead-code"] !== "off" && detections.get("knip")?.installed && config.providers?.knip?.enabled !== false) {
      results.push(await runKnip(context, options.verbose ?? false));
    }
    if ((!options.category || options.category === "duplication") && config.categories?.duplication !== "off" && detections.get("jscpd")?.installed && config.providers?.jscpd?.enabled !== false) {
      results.push(await runJscpd(context, options.verbose ?? false));
    }
  }

  results.sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.name.localeCompare(b.name));
  const findings = results.flatMap((result) => result.findings);
  const errors = results.filter((result) => result.status === "error").length;
  const thresholdMatches = findings.filter((finding) => severityAtLeast(finding.severity, config.severityThreshold)).length;
  const exitCode: 0 | 1 | 2 = errors > 0 ? 2 : thresholdMatches > 0 ? 1 : 0;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: {
      root: context.root,
      packageManager: context.packageManager,
      kinds: context.kinds,
      frameworks: context.frameworks,
      languages: context.languages,
    },
    summary: {
      status: exitCode === 2 ? "error" : exitCode === 1 ? "findings" : "healthy",
      findings: findings.length,
      errors,
      exitCode,
    },
    results,
  };
}
