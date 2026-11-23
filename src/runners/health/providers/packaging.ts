import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosticLogger } from "../../../cli/options.js";
import { createFinding } from "../../../core/finding.js";
import type { HealthResult, RepositoryContext } from "../../../core/types.js";
import { normalizeAttw } from "../../../providers/attw/normalizer.js";
import { normalizePublint } from "../../../providers/publint/normalizer.js";
import { runCommand } from "../../command-runner.js";
import { safeScript, scriptCommand } from "../basic-commands.js";
import {
  missingLocalBinaryResult,
  type ProviderMeta,
  providerErrorResult,
  runPackedPackageCommand,
} from "../runner-helpers.js";
import { HEALTH_OFFLINE_ENV, localBinary, outputExcerpt, resolveLogger } from "../task-executor.js";

const SIZE_LIMIT_META: ProviderMeta = {
  provider: "size-limit",
  name: "Size Limit",
  category: "bundle",
};
const PUBLINT_META: ProviderMeta = {
  provider: "publint",
  name: "Publint",
  category: "package-health",
};
const ATTW_META: ProviderMeta = {
  provider: "attw",
  name: "Are The Types Wrong?",
  category: "package-health",
};

const PUBLINT_EVAL = `import { readFile } from "node:fs/promises";
const { publint } = await import("publint");
const { formatMessage } = await import("publint/utils");
const result = await publint({ pack: { tarball: await readFile(process.argv[1]) } });
process.stdout.write(JSON.stringify({ messages: result.messages.map((message) => ({ ...message, formatted: formatMessage(message, result.pkg) })) }));`;

export async function runSizeLimit(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const sizeScript = safeScript(context, ["health:bundle", "size", "size-limit", "check:size"], "general");
  const binary = sizeScript ? null : await localBinary(context.root, "size-limit");
  if (!sizeScript && !binary) return missingLocalBinaryResult(SIZE_LIMIT_META);
  const command = sizeScript ? scriptCommand(context, sizeScript) : { command: binary!, args: [] };
  const result = await runCommand(command.command, command.args, {
    cwd: context.root,
    logger,
    env: { ...HEALTH_OFFLINE_ENV, ...command.env },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  if (result.spawnError) return providerErrorResult(SIZE_LIMIT_META, result.spawnError, result.durationMs);
  if (result.exitCode === 0)
    return {
      ...SIZE_LIMIT_META,
      status: "pass",
      findings: [],
      durationMs: result.durationMs,
    };
  const output = outputExcerpt(result);
  if (/size limit|limit.{0,30}(?:exceed|over)|(?:exceed|over).{0,30}limit/i.test(output))
    return {
      ...SIZE_LIMIT_META,
      status: "fail",
      findings: [
        createFinding({
          provider: "Size Limit",
          category: "bundle",
          type: "bundle-budget",
          severity: "error",
          message: "The configured bundle-size budget was exceeded.",
          metadata: { output },
        }),
      ],
      durationMs: result.durationMs,
    };
  return providerErrorResult(
    SIZE_LIMIT_META,
    `Size Limit could not complete its check. ${output}`.trim(),
    result.durationMs,
  );
}

export async function runPublint(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  if (!(await localBinary(context.root, "publint"))) return missingLocalBinaryResult(PUBLINT_META);
  return runPackedPackageCommand({
    meta: PUBLINT_META,
    tempPrefix: "repnix-publint-",
    context,
    logger,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    buildInvocation: (tarball) => ({
      command: process.execPath,
      args: ["--input-type=module", "--eval", PUBLINT_EVAL, tarball],
    }),
    nonZeroMessage: "Publint could not complete its analysis.",
    parseFindings: normalizePublint,
  });
}

export async function runAttw(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const binary = await localBinary(context.root, "attw");
  if (!binary) return missingLocalBinaryResult(ATTW_META);
  return runPackedPackageCommand({
    meta: ATTW_META,
    tempPrefix: "repnix-attw-",
    context,
    logger,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    buildInvocation: (tarball) => ({
      command: binary,
      args: [tarball, "--format", "json", "--no-definitely-typed"],
      maxOutputBytes: 50 * 1024 * 1024,
    }),
    nonZeroMessage: "Are The Types Wrong? could not complete its analysis.",
    parseFindings: async (parsed) => {
      const options: { ignoreRules?: string[]; profile?: "strict" | "node16" | "esm-only" } = {};
      try {
        const raw = JSON.parse(await readFile(path.join(context.root, ".attw.json"), "utf8")) as Record<
          string,
          unknown
        >;
        if (Array.isArray(raw.ignoreRules) && raw.ignoreRules.every((rule) => typeof rule === "string"))
          options.ignoreRules = raw.ignoreRules as string[];
        if (raw.profile === "strict" || raw.profile === "node16" || raw.profile === "esm-only")
          options.profile = raw.profile;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          /* ATTW reports malformed config. */
        }
      }
      return normalizeAttw(parsed, options);
    },
  });
}
