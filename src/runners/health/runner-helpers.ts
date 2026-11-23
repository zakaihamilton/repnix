import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DiagnosticLogger } from "../../cli/options.js";
import type { HealthFinding, HealthResult, RepositoryContext } from "../../core/types.js";
import { type CommandResult, runCommand } from "../command-runner.js";
import { packLocalPackage, parseJsonOutput } from "./package-tools.js";
import { HEALTH_OFFLINE_ENV, outputExcerpt, statusForFindings } from "./task-executor.js";

export interface ProviderMeta {
  provider: string;
  name: string;
  category: HealthResult["category"];
}

export function providerErrorResult(meta: ProviderMeta, message: string, durationMs = 0): HealthResult {
  return {
    ...meta,
    status: "error",
    findings: [],
    durationMs,
    message,
  };
}

export function missingLocalBinaryResult(meta: ProviderMeta): HealthResult {
  return providerErrorResult(
    meta,
    `${meta.name} is declared but its local binary is unavailable. Install dependencies first.`,
  );
}

export function formatCommandError(error: unknown, result: CommandResult): string {
  return `${error instanceof Error ? error.message : String(error)} ${outputExcerpt(result)}`.trim();
}

/** Run a command that emits JSON on stdout and normalize its findings uniformly. */
export async function runJsonProviderCommand(options: {
  meta: ProviderMeta;
  binary: string;
  args: string[];
  context: RepositoryContext;
  logger: DiagnosticLogger;
  timeoutMs?: number;
  maxOutputBytes?: number;
  durationOffsetMs?: number;
  nonZeroMessage?: string;
  parseFindings: (parsed: unknown) => HealthFinding[] | Promise<HealthFinding[]>;
}): Promise<HealthResult> {
  const {
    meta,
    binary,
    args,
    context,
    logger,
    timeoutMs,
    maxOutputBytes,
    durationOffsetMs = 0,
    nonZeroMessage,
    parseFindings,
  } = options;
  const result = await runCommand(binary, args, {
    cwd: context.root,
    logger,
    env: HEALTH_OFFLINE_ENV,
    ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const durationMs = durationOffsetMs + result.durationMs;
  if (result.spawnError) return providerErrorResult(meta, result.spawnError, durationMs);
  try {
    const findings = await parseFindings(parseJsonOutput(result.stdout));
    if (nonZeroMessage && result.exitCode !== 0 && !findings.length) {
      return providerErrorResult(meta, `${nonZeroMessage} ${outputExcerpt(result)}`.trim(), durationMs);
    }
    return {
      ...meta,
      status: statusForFindings(findings),
      findings,
      durationMs,
    };
  } catch (error) {
    return providerErrorResult(meta, formatCommandError(error, result), durationMs);
  }
}

/** Pack the local package into a temporary tarball and run a package-health analyzer against it. */
export async function runPackedPackageCommand(options: {
  meta: ProviderMeta;
  tempPrefix: string;
  context: RepositoryContext;
  logger: DiagnosticLogger;
  timeoutMs?: number;
  buildInvocation: (tarball: string) => {
    command: string;
    args: string[];
    maxOutputBytes?: number;
  };
  nonZeroMessage: string;
  parseFindings: (parsed: unknown) => HealthFinding[] | Promise<HealthFinding[]>;
}): Promise<HealthResult> {
  const { meta, tempPrefix, context, logger, timeoutMs, buildInvocation, nonZeroMessage, parseFindings } = options;
  const temporary = await mkdtemp(path.join(os.tmpdir(), tempPrefix));
  try {
    const packed = await packLocalPackage(context, temporary, logger, timeoutMs);
    if (!packed.tarball) {
      return providerErrorResult(meta, packed.error ?? "The package could not be packed locally.", packed.durationMs);
    }
    const invocation = buildInvocation(packed.tarball);
    return await runJsonProviderCommand({
      meta,
      binary: invocation.command,
      args: invocation.args,
      context,
      logger,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(invocation.maxOutputBytes === undefined ? {} : { maxOutputBytes: invocation.maxOutputBytes }),
      durationOffsetMs: packed.durationMs,
      nonZeroMessage,
      parseFindings,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
