import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { glob as fg } from "tinyglobby";
import type { DiagnosticLogger } from "../../../cli/options.js";
import type { RepnixConfig } from "../../../config/repo-health-config.js";
import type { HealthResult, RepositoryContext } from "../../../core/types.js";
import { normalizeDependencyCruiser } from "../../../providers/dependency-cruiser/normalizer.js";
import { safeTestScript } from "../../../repository/script-detection.js";
import { runCommand } from "../../command-runner.js";
import { safeScript, scriptCommand } from "../basic-commands.js";
import { normalizeJscpd, normalizeKnip } from "../normalizers.js";
import {
  missingLocalBinaryResult,
  type ProviderMeta,
  providerErrorResult,
  runJsonProviderCommand,
} from "../runner-helpers.js";
import {
  commandResult,
  expectedLocalBinary,
  HEALTH_OFFLINE_ENV,
  localBinary,
  outputExcerpt,
  type RunnableCommand,
  resolveLogger,
} from "../task-executor.js";

const KNIP_META: ProviderMeta = { provider: "knip", name: "Knip", category: "dead-code" };
const JSCPD_META: ProviderMeta = { provider: "jscpd", name: "jscpd", category: "duplication" };
const DEPCRUISE_META: ProviderMeta = {
  provider: "dependency-cruiser",
  name: "dependency-cruiser",
  category: "architecture",
};

export async function runCoveragePolicy(
  context: RepositoryContext,
  config: RepnixConfig,
  logger: DiagnosticLogger,
  timeoutMs?: number,
): Promise<HealthResult> {
  const testScript = safeTestScript(context.scripts);
  if (!testScript)
    return {
      provider: "c8",
      name: "c8",
      category: "coverage",
      status: "skipped",
      findings: [],
      durationMs: 0,
      message: "Coverage is detected, but no safe test command is configured.",
    };
  const args = ["--all", "--reporter=text"];
  if (config.policies?.coverage && Object.keys(config.policies.coverage).length) {
    args.push("--check-coverage");
    for (const [key, value] of Object.entries(config.policies.coverage))
      if (typeof value === "number") args.push(`--${key}`, String(value));
  }
  const testArgs = context.packageManager === "yarn" ? [testScript] : ["run", testScript];
  const runnable: RunnableCommand = {
    provider: "c8",
    name: "c8",
    category: "coverage",
    command: await expectedLocalBinary(context.root, "c8"),
    args: [...args, context.packageManager!, ...testArgs],
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  const result = await runCommand(runnable.command, runnable.args, {
    cwd: context.root,
    logger,
    env: HEALTH_OFFLINE_ENV,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return commandResult(runnable, result, context);
}

export async function runKnip(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const binary = await localBinary(context.root, "knip");
  if (!binary) return missingLocalBinaryResult(KNIP_META);
  return runJsonProviderCommand({
    meta: KNIP_META,
    binary,
    args: ["--reporter", "json"],
    context,
    logger,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    parseFindings: normalizeKnip,
  });
}

export async function runJscpd(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const binary = await localBinary(context.root, "jscpd");
  if (!binary) return missingLocalBinaryResult(JSCPD_META);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "repnix-jscpd-"));
  try {
    const result = await runCommand(binary, [...context.sourceRoots, "--reporters", "json", "--output", temporary], {
      cwd: context.root,
      logger,
      env: HEALTH_OFFLINE_ENV,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    if (result.spawnError) return providerErrorResult(JSCPD_META, result.spawnError, result.durationMs);
    const reports = await fg("**/jscpd-report.json", {
      cwd: temporary,
      absolute: true,
      onlyFiles: true,
    });
    if (!reports.length)
      return providerErrorResult(
        JSCPD_META,
        `jscpd did not create a JSON report. ${outputExcerpt(result)}`.trim(),
        result.durationMs,
      );
    const findings = normalizeJscpd(JSON.parse(await readFile(reports[0]!, "utf8")) as unknown);
    return {
      ...JSCPD_META,
      status: findings.length ? "warn" : "pass",
      findings,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return providerErrorResult(JSCPD_META, error instanceof Error ? error.message : String(error));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function runDependencyCruiser(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const binary = await localBinary(context.root, "depcruise");
  const configFile = [
    ".dependency-cruiser.cjs",
    ".dependency-cruiser.mjs",
    ".dependency-cruiser.js",
    ".dependency-cruiser.json",
    ".dependency-cruiser.ts",
  ].find((file) => context.files.has(file));
  if (!binary) return missingLocalBinaryResult(DEPCRUISE_META);
  if (!configFile)
    return providerErrorResult(DEPCRUISE_META, "dependency-cruiser has no supported rules configuration.");
  return runJsonProviderCommand({
    meta: DEPCRUISE_META,
    binary,
    args: ["--config", configFile, "--output-type", "json", ...context.sourceRoots],
    context,
    logger,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    nonZeroMessage: "dependency-cruiser could not complete its analysis.",
    parseFindings: normalizeDependencyCruiser,
  });
}

export async function runEslintBoundaries(
  context: RepositoryContext,
  _config: RepnixConfig,
  logger: DiagnosticLogger,
  timeoutMs?: number,
): Promise<HealthResult> {
  const lintScript = safeScript(context, ["lint", "check:lint", "lint:check"], "general");
  const command = lintScript
    ? scriptCommand(context, lintScript)
    : { command: await expectedLocalBinary(context.root, "eslint"), args: ["."] };
  const runnable: RunnableCommand = {
    provider: "eslint-boundaries",
    name: "eslint-plugin-boundaries",
    category: "architecture",
    ...command,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  return commandResult(
    runnable,
    await runCommand(runnable.command, runnable.args, {
      cwd: context.root,
      logger,
      env: { ...HEALTH_OFFLINE_ENV, ...runnable.env },
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
    context,
  );
}
