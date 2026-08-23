import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { createFinding } from "../../core/finding.js";
import { redactSensitiveText } from "../../core/redaction.js";
import type { HealthCategory } from "../../core/health-category.js";
import type { HealthFinding, HealthResult, RepositoryContext } from "../../core/types.js";
import { resolveDiagnosticLogger, type DiagnosticLogger } from "../../cli/options.js";
import { runCommand, type CommandResult } from "../command-runner.js";
import type { ProviderModule } from "../../providers/sdk.js";
import type { ProviderDescriptor } from "../../providers/catalog.js";

export interface RunnableCommand {
  provider: string;
  name: string;
  category: HealthCategory;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  scope?: string;
}

export const HEALTH_OFFLINE_ENV: NodeJS.ProcessEnv = {
  COREPACK_ENABLE_NETWORK: "0",
  COREPACK_DEFAULT_TO_LATEST: "0",
  npm_config_offline: "true",
  PNPM_CONFIG_OFFLINE: "true",
  YARN_ENABLE_NETWORK: "0",
};

export async function localBinary(root: string, binary: string): Promise<string | null> {
  const file = path.join(root, "node_modules", ".bin", `${binary}${process.platform === "win32" ? ".cmd" : ""}`);
  try {
    await access(file);
    return file;
  } catch {
    return null;
  }
}

export async function expectedLocalBinary(root: string, binary: string): Promise<string> {
  return (await localBinary(root, binary)) ?? path.join(root, "node_modules", ".bin", `${binary}${process.platform === "win32" ? ".cmd" : ""}`);
}

export async function executableOnPath(binary: string): Promise<string | null> {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, `${binary}${process.platform === "win32" ? ".exe" : ""}`);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return null;
}

export async function executableBinary(root: string, binary: string, searchPath = false): Promise<string | null> {
  const local = await localBinary(root, binary);
  if (local || !searchPath) return local;
  return executableOnPath(binary);
}

export function outputExcerpt(result: CommandResult): string {
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const excerpt = combined.length > 4000 ? combined.slice(-4000) : combined;
  return redactSensitiveText(excerpt);
}

export function commandLine(runnable: RunnableCommand): string {
  return redactSensitiveText([runnable.command, ...runnable.args].map((part) => JSON.stringify(part)).join(" "));
}

export function statusForFindings(findings: HealthFinding[]): "pass" | "warn" | "fail" {
  if (!findings.length) return "pass";
  return findings.some((finding) => finding.severity === "error") ? "fail" : "warn";
}

function normalizeCommandOutput(runnable: RunnableCommand, output: string, root = process.cwd()): HealthFinding[] {
  const findings: HealthFinding[] = [];
  if (runnable.category === "types") {
    const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;
    for (const match of output.matchAll(pattern)) {
      const file = path.isAbsolute(match[1]!) ? path.relative(root, match[1]!) : match[1]!;
      findings.push(createFinding({ provider: runnable.name, category: "types", type: "type-error", ruleId: match[5]!, title: `TypeScript ${match[5]!}`, severity: match[4] === "warning" ? "warning" : "error", message: match[6]!, remediation: `Correct the value or type reported by ${match[5]!}, then rerun the type check.`, documentationUrl: "https://www.typescriptlang.org/docs/", file, line: Number(match[2]), column: Number(match[3]), metadata: { command: commandLine(runnable) } }));
    }
  }
  if (runnable.category === "lint") {
    let currentFile: string | undefined;
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !/^\d+:\d+\s/.test(trimmed) && /\.[cm]?[jt]sx?$/.test(trimmed)) {
        currentFile = path.isAbsolute(trimmed) ? path.relative(root, trimmed) : trimmed;
        continue;
      }
      const match = /^(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}|\s)([@\w/-]+)$/.exec(trimmed);
      if (!match || !currentFile) continue;
      findings.push(createFinding({ provider: runnable.name, category: "lint", type: "lint-error", ruleId: match[5]!, title: match[5]!, severity: match[3] === "warning" ? "warning" : "error", message: match[4]!, remediation: `Correct the ${match[5]!} lint violation or configure the rule intentionally.`, documentationUrl: "https://eslint.org/docs/latest/", file: currentFile, line: Number(match[1]), column: Number(match[2]), metadata: { command: commandLine(runnable) } }));
    }
  }
  return findings;
}

export function commandResult(runnable: RunnableCommand, result: CommandResult, context?: RepositoryContext, normalize?: ProviderModule["normalize"]): HealthResult {
  if (result.timedOut) return { provider: runnable.provider, name: runnable.name, category: runnable.category, status: "error", findings: [], durationMs: result.durationMs, message: `${runnable.name} exceeded its ${runnable.timeoutMs ?? 300_000}ms command timeout.` };
  if (result.spawnError) {
    const missingLocalBinary = /node_modules[\\/]+\.bin[\\/].+\bENOENT\b/i.test(result.spawnError);
    return { provider: runnable.provider, name: runnable.name, category: runnable.category, status: "error", findings: [], durationMs: result.durationMs, message: missingLocalBinary ? `${runnable.name} is configured, but its local executable is unavailable. Install this project's dependencies, then try again.` : `${runnable.name} could not start. ${result.spawnError}` };
  }
  if (result.exitCode === 0) return { provider: runnable.provider, name: runnable.name, category: runnable.category, status: "pass", findings: [], durationMs: result.durationMs };
  const excerpt = outputExcerpt(result);
  if (result.exitCode === 126 || result.exitCode === 127 || /(?:command not found|not recognized as an internal|could not determine executable|network access disabled|cannot find matching keyid)/i.test(excerpt)) {
    return { provider: runnable.provider, name: runnable.name, category: runnable.category, status: "error", findings: [], durationMs: result.durationMs, message: `${runnable.name} is configured but its executable is unavailable: ${runnable.command}. Install repository dependencies first.` };
  }
  const findings = normalize && context ? normalize({ output: excerpt, result, context }) : normalizeCommandOutput(runnable, excerpt, context?.root);
  if (findings.length) return { provider: runnable.provider, name: runnable.name, category: runnable.category, status: statusForFindings(findings), findings, durationMs: result.durationMs };
  return { provider: runnable.provider, name: runnable.name, category: runnable.category, status: "fail", findings: [createFinding({ provider: runnable.name, category: runnable.category, type: "command-failure", severity: "error", message: `${runnable.name} exited with code ${result.exitCode ?? "unknown"} while running ${commandLine(runnable)}.`, metadata: { command: commandLine(runnable), durationMs: result.durationMs, ...(result.signal ? { signal: result.signal } : {}), output: excerpt } })], durationMs: result.durationMs };
}

export async function runRunnableCommand(runnable: RunnableCommand, context: RepositoryContext, logger: DiagnosticLogger, normalize?: ProviderModule["normalize"]): Promise<HealthResult> {
  const result = await runCommand(runnable.command, runnable.args, { cwd: context.root, logger, env: { ...HEALTH_OFFLINE_ENV, ...runnable.env }, ...(runnable.timeoutMs === undefined ? {} : { timeoutMs: runnable.timeoutMs }) });
  return commandResult(runnable, result, context, normalize);
}


export interface DependentTask<T> {
  id: string;
  dependsOn?: string;
  run(completed: ReadonlyMap<string, T>): Promise<T>;
}

function validateTaskPlan<T>(tasks: readonly DependentTask<T>[]): void {
  const byId = new Map<string, DependentTask<T>>();
  for (const task of tasks) {
    if (byId.has(task.id)) throw new Error(`Health task plan has duplicate task id '${task.id}'.`);
    byId.set(task.id, task);
  }
  for (const task of tasks) {
    if (task.dependsOn && !byId.has(task.dependsOn)) {
      throw new Error(`Health task '${task.id}' depends on missing task '${task.dependsOn}'.`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (task: DependentTask<T>) => {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) throw new Error(`Health task plan has a dependency cycle involving '${task.id}'.`);
    visiting.add(task.id);
    if (task.dependsOn) visit(byId.get(task.dependsOn)!);
    visiting.delete(task.id);
    visited.add(task.id);
  };
  for (const task of tasks) visit(task);
}

/** Runs one dependency-aware task plan while never exceeding the configured worker count. */
export async function executeTaskPlan<T>(tasks: readonly DependentTask<T>[], jobs: number): Promise<T[]> {
  validateTaskPlan(tasks);
  const started = new Set<string>();
  const completed = new Map<string, T>();
  const ordered = new Map(tasks.map((task, index) => [task.id, index]));
  const results = new Array<T>(tasks.length);
  const waiters: Array<() => void> = [];
  const signal = () => { while (waiters.length) waiters.shift()!(); };
  const worker = async () => {
    while (completed.size < tasks.length) {
      const task = tasks.find((candidate) => !started.has(candidate.id) && (!candidate.dependsOn || completed.has(candidate.dependsOn)));
      if (!task) {
        await new Promise<void>((resolve) => waiters.push(resolve));
        continue;
      }
      started.add(task.id);
      const result = await task.run(completed);
      completed.set(task.id, result);
      results[ordered.get(task.id)!] = result;
      signal();
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(jobs, 1), Math.max(tasks.length, 1)) }, worker));
  return results;
}

export async function runProviderModule(context: RepositoryContext, descriptor: ProviderModule, logger: DiagnosticLogger, timeoutMs?: number): Promise<HealthResult> {
  if (!descriptor.run) throw new Error(`Provider '${descriptor.id}' does not implement a runner.`);
  return descriptor.run({ context, runtime: { logger, ...(timeoutMs === undefined ? {} : { timeoutMs }), runCommand: (command, args, options = {}) => runCommand(command, args, { cwd: options.cwd ?? context.root, logger, ...(options.env ? { env: options.env } : {}), ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }), ...(timeoutMs === undefined ? {} : { timeoutMs }) }) } });
}

export async function runGenericProvider(context: RepositoryContext, descriptor: ProviderDescriptor, logger: DiagnosticLogger, timeoutMs?: number): Promise<HealthResult> {
  if (!descriptor.command) return { provider: descriptor.id, name: descriptor.name, category: descriptor.category, status: "skipped", findings: [], durationMs: 0, message: "This provider is detection-only until a repository command is configured." };
  const binary = await executableBinary(context.root, descriptor.command.binary, descriptor.command.searchPath === true);
  const args = descriptor.id === "actionlint" ? [...context.files].filter((file) => /^\.github\/workflows\/.*\.ya?ml$/.test(file)) : descriptor.command.args;
  const runnable: RunnableCommand = { provider: descriptor.id, name: descriptor.name, category: descriptor.category, command: binary ?? path.join(context.root, "node_modules", ".bin", descriptor.command.binary), args, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
  return runRunnableCommand(runnable, context, logger, descriptor.normalize);
}

export function resolveLogger(diagnostics: DiagnosticLogger | boolean): DiagnosticLogger {
  return resolveDiagnosticLogger(diagnostics);
}
