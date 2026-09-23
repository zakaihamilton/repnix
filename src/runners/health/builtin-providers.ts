import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fg from "fast-glob";
import type { RepnixConfig } from "../../config/repo-health-config.js";
import { createFinding } from "../../core/finding.js";
import type { HealthFinding, HealthResult, RepositoryContext } from "../../core/types.js";
import { normalizeDependencyCruiser } from "../../providers/dependency-cruiser/normalizer.js";
import { normalizeOsv } from "../../providers/osv/normalizer.js";
import { normalizePublint } from "../../providers/publint/normalizer.js";
import { normalizeAttw } from "../../providers/attw/normalizer.js";
import { scopePublishesTypes } from "../../providers/recommend.js";
import { safeTestScript } from "../../repository/script-detection.js";
import type { DiagnosticLogger } from "../../cli/options.js";
import { runCommand, type CommandResult } from "../command-runner.js";
import { safeScript, scriptCommand } from "./basic-commands.js";
import { normalizeJscpd, normalizeKnip } from "./normalizers.js";
import { packLocalPackage, parseJsonOutput } from "./package-tools.js";
import {
  commandResult,
  executableBinary,
  expectedLocalBinary,
  HEALTH_OFFLINE_ENV,
  localBinary,
  outputExcerpt,
  resolveLogger,
  statusForFindings,
  type RunnableCommand,
} from "./task-executor.js";

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

export async function runLicensePolicy(
  context: RepositoryContext,
  config: RepnixConfig,
  logger: DiagnosticLogger,
  timeoutMs?: number,
): Promise<HealthResult> {
  const binary = await localBinary(context.root, "license-checker");
  if (!binary)
    return {
      provider: "license-checker",
      name: "license-checker",
      category: "licenses",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "license-checker is declared but its local binary is unavailable. Install dependencies first.",
    };
  const result = await runCommand(binary, ["--json"], {
    cwd: context.root,
    logger,
    env: HEALTH_OFFLINE_ENV,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  if (result.spawnError)
    return {
      provider: "license-checker",
      name: "license-checker",
      category: "licenses",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: result.spawnError,
    };
  try {
    const report = parseJsonOutput(result.stdout);
    const allow = new Set(config.policies?.licenses?.allow ?? []);
    const deny = new Set(config.policies?.licenses?.deny ?? []);
    const findings: HealthFinding[] = [];
    if (report && typeof report === "object")
      for (const [dependency, value] of Object.entries(report as Record<string, unknown>)) {
        const license =
          value && typeof value === "object" && typeof (value as Record<string, unknown>).licenses === "string"
            ? ((value as Record<string, unknown>).licenses as string)
            : "UNKNOWN";
        if (deny.has(license) || (allow.size > 0 && !allow.has(license)))
          findings.push(
            createFinding({
              provider: "license-checker",
              category: "licenses",
              type: "license-policy",
              severity: "error",
              message: `${dependency} uses license ${license}, which is outside the configured license policy.`,
              metadata: { dependency, license },
            }),
          );
      }
    return {
      provider: "license-checker",
      name: "license-checker",
      category: "licenses",
      status: statusForFindings(findings),
      findings,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      provider: "license-checker",
      name: "license-checker",
      category: "licenses",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: `${error instanceof Error ? error.message : String(error)} ${outputExcerpt(result)}`.trim(),
    };
  }
}

export async function runKnip(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const binary = await localBinary(context.root, "knip");
  if (!binary)
    return {
      provider: "knip",
      name: "Knip",
      category: "dead-code",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "Knip is declared but its local binary is unavailable. Install dependencies first.",
    };
  const result = await runCommand(binary, ["--reporter", "json"], {
    cwd: context.root,
    logger,
    env: HEALTH_OFFLINE_ENV,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  if (result.spawnError)
    return {
      provider: "knip",
      name: "Knip",
      category: "dead-code",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: result.spawnError,
    };
  try {
    const findings = normalizeKnip(parseJsonOutput(result.stdout));
    return {
      provider: "knip",
      name: "Knip",
      category: "dead-code",
      status: statusForFindings(findings),
      findings,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      provider: "knip",
      name: "Knip",
      category: "dead-code",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: `${error instanceof Error ? error.message : String(error)} ${outputExcerpt(result)}`.trim(),
    };
  }
}

export async function runJscpd(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const binary = await localBinary(context.root, "jscpd");
  if (!binary)
    return {
      provider: "jscpd",
      name: "jscpd",
      category: "duplication",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "jscpd is declared but its local binary is unavailable. Install dependencies first.",
    };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "repnix-jscpd-"));
  try {
    const result = await runCommand(binary, [...context.sourceRoots, "--reporters", "json", "--output", temporary], {
      cwd: context.root,
      logger,
      env: HEALTH_OFFLINE_ENV,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    if (result.spawnError)
      return {
        provider: "jscpd",
        name: "jscpd",
        category: "duplication",
        status: "error",
        findings: [],
        durationMs: result.durationMs,
        message: result.spawnError,
      };
    const reports = await fg("**/jscpd-report.json", { cwd: temporary, absolute: true, onlyFiles: true });
    if (!reports.length)
      return {
        provider: "jscpd",
        name: "jscpd",
        category: "duplication",
        status: "error",
        findings: [],
        durationMs: result.durationMs,
        message: `jscpd did not create a JSON report. ${outputExcerpt(result)}`.trim(),
      };
    const findings = normalizeJscpd(JSON.parse(await readFile(reports[0]!, "utf8")) as unknown);
    return {
      provider: "jscpd",
      name: "jscpd",
      category: "duplication",
      status: findings.length ? "warn" : "pass",
      findings,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      provider: "jscpd",
      name: "jscpd",
      category: "duplication",
      status: "error",
      findings: [],
      durationMs: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function runOsvScanner(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const binary = await executableBinary(context.root, "osv-scanner", true);
  if (!binary)
    return {
      provider: "osv-scanner",
      name: "OSV-Scanner",
      category: "security",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "OSV-Scanner is configured but its executable is unavailable.",
    };
  const result = await runCommand(
    binary,
    ["scan", "source", "--offline-vulnerabilities", "--format=json", "--recursive", "."],
    { cwd: context.root, logger, env: HEALTH_OFFLINE_ENV, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
  );
  if (result.spawnError)
    return {
      provider: "osv-scanner",
      name: "OSV-Scanner",
      category: "security",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: result.spawnError,
    };
  try {
    const findings = normalizeOsv(parseJsonOutput(result.stdout));
    if (result.exitCode !== 0 && !findings.length)
      return {
        provider: "osv-scanner",
        name: "OSV-Scanner",
        category: "security",
        status: "error",
        findings: [],
        durationMs: result.durationMs,
        message: `OSV-Scanner could not complete its offline scan. ${outputExcerpt(result)}`.trim(),
      };
    return {
      provider: "osv-scanner",
      name: "OSV-Scanner",
      category: "security",
      status: statusForFindings(findings),
      findings,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      provider: "osv-scanner",
      name: "OSV-Scanner",
      category: "security",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: `${error instanceof Error ? error.message : String(error)} ${outputExcerpt(result)}`.trim(),
    };
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
  if (!binary)
    return {
      provider: "dependency-cruiser",
      name: "dependency-cruiser",
      category: "architecture",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "dependency-cruiser is declared but its local binary is unavailable. Install dependencies first.",
    };
  if (!configFile)
    return {
      provider: "dependency-cruiser",
      name: "dependency-cruiser",
      category: "architecture",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "dependency-cruiser has no supported rules configuration.",
    };
  const result = await runCommand(binary, ["--config", configFile, "--output-type", "json", ...context.sourceRoots], {
    cwd: context.root,
    logger,
    env: HEALTH_OFFLINE_ENV,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  if (result.spawnError)
    return {
      provider: "dependency-cruiser",
      name: "dependency-cruiser",
      category: "architecture",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: result.spawnError,
    };
  try {
    const findings = normalizeDependencyCruiser(parseJsonOutput(result.stdout));
    if (result.exitCode !== 0 && !findings.length)
      return {
        provider: "dependency-cruiser",
        name: "dependency-cruiser",
        category: "architecture",
        status: "error",
        findings: [],
        durationMs: result.durationMs,
        message: `dependency-cruiser could not complete its analysis. ${outputExcerpt(result)}`.trim(),
      };
    return {
      provider: "dependency-cruiser",
      name: "dependency-cruiser",
      category: "architecture",
      status: statusForFindings(findings),
      findings,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      provider: "dependency-cruiser",
      name: "dependency-cruiser",
      category: "architecture",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: `${error instanceof Error ? error.message : String(error)} ${outputExcerpt(result)}`.trim(),
    };
  }
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

export async function runSizeLimit(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const sizeScript = safeScript(context, ["health:bundle", "size", "size-limit", "check:size"], "general");
  const binary = sizeScript ? null : await localBinary(context.root, "size-limit");
  if (!sizeScript && !binary)
    return {
      provider: "size-limit",
      name: "Size Limit",
      category: "bundle",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "Size Limit is declared but its local binary is unavailable. Install dependencies first.",
    };
  const command = sizeScript ? scriptCommand(context, sizeScript) : { command: binary!, args: [] };
  const result = await runCommand(command.command, command.args, {
    cwd: context.root,
    logger,
    env: { ...HEALTH_OFFLINE_ENV, ...command.env },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  if (result.spawnError)
    return {
      provider: "size-limit",
      name: "Size Limit",
      category: "bundle",
      status: "error",
      findings: [],
      durationMs: result.durationMs,
      message: result.spawnError,
    };
  if (result.exitCode === 0)
    return {
      provider: "size-limit",
      name: "Size Limit",
      category: "bundle",
      status: "pass",
      findings: [],
      durationMs: result.durationMs,
    };
  const output = outputExcerpt(result);
  if (/size limit|limit.{0,30}(?:exceed|over)|(?:exceed|over).{0,30}limit/i.test(output))
    return {
      provider: "size-limit",
      name: "Size Limit",
      category: "bundle",
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
  return {
    provider: "size-limit",
    name: "Size Limit",
    category: "bundle",
    status: "error",
    findings: [],
    durationMs: result.durationMs,
    message: `Size Limit could not complete its check. ${output}`.trim(),
  };
}

const PUBLINT_EVAL = `import { readFile } from "node:fs/promises";
const { publint } = await import("publint");
const { formatMessage } = await import("publint/utils");
const result = await publint({ pack: { tarball: await readFile(process.argv[1]) } });
process.stdout.write(JSON.stringify({ messages: result.messages.map((message) => ({ ...message, formatted: formatMessage(message, result.pkg) })) }));`;

function packageHealthErrorResult(
  provider: string,
  name: string,
  error: unknown,
  result: CommandResult,
  durationMs: number,
  scope?: string,
): HealthResult {
  return {
    provider,
    name,
    category: "package-health",
    status: "error",
    findings: [],
    durationMs,
    message: `${error instanceof Error ? error.message : String(error)} ${outputExcerpt(result)}`.trim(),
    ...(scope === undefined ? {} : { scope }),
  };
}

function packageHealthScopes(context: RepositoryContext, withTypes = false): RepositoryContext["scopes"] {
  return context.scopes.filter(
    (scope) => scope.roles.includes("library") && (!withTypes || scopePublishesTypes(scope)),
  );
}

function scopePackageFinding(finding: HealthFinding, scope: string): HealthFinding {
  const file = scope === "." ? finding.file : path.posix.join(scope, finding.file ?? "package.json");
  return createFinding({
    provider: finding.provider,
    category: finding.category,
    type: finding.type,
    severity: finding.severity,
    message: finding.message,
    ...(finding.ruleId === undefined ? {} : { ruleId: finding.ruleId }),
    ...(finding.title === undefined ? {} : { title: finding.title }),
    ...(file === undefined ? {} : { file }),
    ...(finding.line === undefined ? {} : { line: finding.line }),
    ...(finding.column === undefined ? {} : { column: finding.column }),
    ...(finding.remediation === undefined ? {} : { remediation: finding.remediation }),
    ...(finding.documentationUrl === undefined ? {} : { documentationUrl: finding.documentationUrl }),
    ...(finding.metadata === undefined ? {} : { metadata: finding.metadata }),
    scope,
  });
}

function combinePackageHealthResults(provider: string, name: string, results: HealthResult[]): HealthResult {
  const findings = results.flatMap((result) => result.findings);
  const errors = results.filter((result) => result.status === "error");
  return {
    provider,
    name,
    category: "package-health",
    status: errors.length ? "error" : statusForFindings(findings),
    findings,
    durationMs: results.reduce((duration, result) => duration + result.durationMs, 0),
    ...(errors.length
      ? { message: errors.map((result) => `${result.scope ?? "."}: ${result.message ?? "check failed"}`).join(" ") }
      : {}),
  };
}

function packageScopeRoot(context: RepositoryContext, scope: string): string {
  return path.resolve(context.root, scope);
}

async function packageHealthTool(
  context: RepositoryContext,
  scopes: RepositoryContext["scopes"],
  binary: string,
): Promise<{ binary: string; root: string } | null> {
  for (const scope of scopes) {
    const root = packageScopeRoot(context, scope.path);
    const local = await localBinary(root, binary);
    if (local) return { binary: local, root };
  }
  const local = await localBinary(context.root, binary);
  return local ? { binary: local, root: context.root } : null;
}

type AttwOptions = { ignoreRules?: string[]; profile?: "strict" | "node16" | "esm-only" };

async function readAttwOptions(scopeRoot: string, repositoryRoot: string): Promise<AttwOptions> {
  const options: AttwOptions = {};
  const configPaths = [...new Set([path.join(scopeRoot, ".attw.json"), path.join(repositoryRoot, ".attw.json")])];
  for (const configPath of configPaths) {
    try {
      const raw = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
      if (Array.isArray(raw.ignoreRules) && raw.ignoreRules.every((rule) => typeof rule === "string"))
        options.ignoreRules = raw.ignoreRules as string[];
      if (raw.profile === "strict" || raw.profile === "node16" || raw.profile === "esm-only")
        options.profile = raw.profile;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        /* Malformed optional ATTW config is ignored, matching the existing provider behavior. */
        break;
      }
    }
  }
  return options;
}

export async function runPublint(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const scopes = packageHealthScopes(context);
  if (!scopes.length)
    return {
      provider: "publint",
      name: "Publint",
      category: "package-health",
      status: "skipped",
      findings: [],
      durationMs: 0,
      message: "No published library package scopes were detected.",
    };
  const tool = await packageHealthTool(context, packageHealthScopes(context), "publint");
  if (!tool)
    return {
      provider: "publint",
      name: "Publint",
      category: "package-health",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "Publint is declared but its local binary is unavailable. Install dependencies first.",
    };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "repnix-publint-"));
  try {
    const results: HealthResult[] = [];
    for (const scope of scopes) {
      const scopeRoot = packageScopeRoot(context, scope.path);
      const scopeTemporary = await mkdtemp(path.join(temporary, "scope-"));
      try {
        const packed = await packLocalPackage(context, scopeTemporary, logger, timeoutMs, scopeRoot);
        if (!packed.tarball) {
          results.push({
            provider: "publint",
            name: "Publint",
            category: "package-health",
            status: "error",
            findings: [],
            durationMs: packed.durationMs,
            message: packed.error ?? "The package could not be packed locally.",
            scope: scope.path,
          });
          continue;
        }
        const result = await runCommand(
          process.execPath,
          ["--input-type=module", "--eval", PUBLINT_EVAL, packed.tarball],
          {
            cwd: tool.root,
            logger,
            env: HEALTH_OFFLINE_ENV,
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          },
        );
        const durationMs = packed.durationMs + result.durationMs;
        if (result.spawnError) {
          results.push({
            provider: "publint",
            name: "Publint",
            category: "package-health",
            status: "error",
            findings: [],
            durationMs,
            message: result.spawnError,
            scope: scope.path,
          });
          continue;
        }
        try {
          const findings = normalizePublint(parseJsonOutput(result.stdout)).map((finding) =>
            scopePackageFinding(finding, scope.path),
          );
          if (result.exitCode !== 0 && !findings.length) {
            results.push({
              provider: "publint",
              name: "Publint",
              category: "package-health",
              status: "error",
              findings: [],
              durationMs,
              message: `Publint could not complete its analysis. ${outputExcerpt(result)}`.trim(),
              scope: scope.path,
            });
          } else {
            results.push({
              provider: "publint",
              name: "Publint",
              category: "package-health",
              status: statusForFindings(findings),
              findings,
              durationMs,
              scope: scope.path,
            });
          }
        } catch (error) {
          results.push(packageHealthErrorResult("publint", "Publint", error, result, durationMs, scope.path));
        }
      } finally {
        await rm(scopeTemporary, { recursive: true, force: true });
      }
    }
    return combinePackageHealthResults("publint", "Publint", results);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function runAttw(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const scopes = packageHealthScopes(context, true);
  if (!scopes.length)
    return {
      provider: "attw",
      name: "Are The Types Wrong?",
      category: "package-health",
      status: "skipped",
      findings: [],
      durationMs: 0,
      message: "No published library package scopes with TypeScript declarations were detected.",
    };
  const tool = await packageHealthTool(context, packageHealthScopes(context), "attw");
  if (!tool)
    return {
      provider: "attw",
      name: "Are The Types Wrong?",
      category: "package-health",
      status: "error",
      findings: [],
      durationMs: 0,
      message: "Are The Types Wrong? is declared but its local binary is unavailable. Install dependencies first.",
    };
  const temporary = await mkdtemp(path.join(os.tmpdir(), "repnix-attw-"));
  try {
    const results: HealthResult[] = [];
    for (const scope of scopes) {
      const scopeRoot = packageScopeRoot(context, scope.path);
      const scopeTemporary = await mkdtemp(path.join(temporary, "scope-"));
      try {
        const packed = await packLocalPackage(context, scopeTemporary, logger, timeoutMs, scopeRoot);
        if (!packed.tarball) {
          results.push({
            provider: "attw",
            name: "Are The Types Wrong?",
            category: "package-health",
            status: "error",
            findings: [],
            durationMs: packed.durationMs,
            message: packed.error ?? "The package could not be packed locally.",
            scope: scope.path,
          });
          continue;
        }
        const result = await runCommand(tool.binary, [packed.tarball, "--format", "json", "--no-definitely-typed"], {
          cwd: scopeRoot,
          logger,
          env: HEALTH_OFFLINE_ENV,
          maxOutputBytes: 50 * 1024 * 1024,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        });
        const durationMs = packed.durationMs + result.durationMs;
        if (result.spawnError) {
          results.push({
            provider: "attw",
            name: "Are The Types Wrong?",
            category: "package-health",
            status: "error",
            findings: [],
            durationMs,
            message: result.spawnError,
            scope: scope.path,
          });
          continue;
        }
        try {
          const findings = normalizeAttw(
            parseJsonOutput(result.stdout),
            await readAttwOptions(scopeRoot, context.root),
          ).map((finding) => scopePackageFinding(finding, scope.path));
          if (result.exitCode !== 0 && !findings.length) {
            results.push({
              provider: "attw",
              name: "Are The Types Wrong?",
              category: "package-health",
              status: "error",
              findings: [],
              durationMs,
              message: `Are The Types Wrong? could not complete its analysis. ${outputExcerpt(result)}`.trim(),
              scope: scope.path,
            });
          } else {
            results.push({
              provider: "attw",
              name: "Are The Types Wrong?",
              category: "package-health",
              status: statusForFindings(findings),
              findings,
              durationMs,
              scope: scope.path,
            });
          }
        } catch (error) {
          results.push(packageHealthErrorResult("attw", "Are The Types Wrong?", error, result, durationMs, scope.path));
        }
      } finally {
        await rm(scopeTemporary, { recursive: true, force: true });
      }
    }
    return combinePackageHealthResults("attw", "Are The Types Wrong?", results);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
