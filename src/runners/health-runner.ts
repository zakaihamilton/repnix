import { categoryModeFor, type RepnixConfig } from "../config/repo-health-config.js";
import { HEALTH_CATEGORIES, type HealthCategory } from "../core/health-category.js";
import { redactDiagnosticValue, redactSensitiveText } from "../core/redaction.js";
import type { BaselineFile, FindingSeverity, HealthResult, HealthRun } from "../core/types.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import { resolveDiagnosticLogger, type DiagnosticLogger } from "../cli/options.js";
import { builtinProvider, builtinProviderByName } from "../providers/registry.js";
import { normalizeJscpd, normalizeKnip } from "./health/normalizers.js";
import { executeTaskPlan } from "./health/task-executor.js";
import { categorySelected, planHealthTasks } from "./health/task-planner.js";

export interface RunHealthOptions {
  category?: HealthCategory;
  categories?: readonly HealthCategory[];
  verbose?: boolean;
  quiet?: boolean;
  logLevel?: "silent" | "error" | "warn" | "info" | "debug";
  logFormat?: "text" | "json";
  timeout?: number;
  jobs?: number;
  baseline?: BaselineFile;
  baselineFailOn?: "new" | "all";
  logger?: DiagnosticLogger;
}

export { normalizeJscpd, normalizeKnip };

function severityAtLeast(severity: FindingSeverity, threshold: FindingSeverity): boolean {
  return (
    ({ info: 0, warning: 1, error: 2 } as Record<FindingSeverity, number>)[severity] >=
    ({ info: 0, warning: 1, error: 2 } as Record<FindingSeverity, number>)[threshold]
  );
}

function categoryOrder(category: HealthCategory, audit: AuditModel): number {
  const categories = audit.registry?.categories.map((entry) => entry.id) ?? HEALTH_CATEGORIES;
  const index = categories.indexOf(category);
  return index < 0 ? categories.length : index;
}

function finalizeResults(
  results: HealthResult[],
  audit: AuditModel,
  config: RepnixConfig,
  options: RunHealthOptions,
  logger: DiagnosticLogger,
): HealthRun {
  results.sort(
    (a, b) => categoryOrder(a.category, audit) - categoryOrder(b.category, audit) || a.name.localeCompare(b.name),
  );
  for (const result of results) {
    if (result.message) result.message = redactSensitiveText(result.message);
    if (!result.scope && result.provider.startsWith("workspace:"))
      result.scope = result.provider.split(":").slice(1, -1).join(":");
    const definition = builtinProvider(result.provider) ?? builtinProviderByName(result.name);
    for (const finding of result.findings) {
      finding.ruleId ??= `${result.provider}/${finding.type}`;
      finding.title ??= finding.type.replaceAll("-", " ");
      finding.scope ??= result.scope ?? ".";
      finding.remediation ??=
        definition?.nextStep ??
        `Review the ${result.name} output and correct the reported ${finding.type.replaceAll("-", " ")}.`;
      if (definition?.documentationUrl) finding.documentationUrl ??= definition.documentationUrl;
      finding.message = redactSensitiveText(finding.message);
      if (finding.title) finding.title = redactSensitiveText(finding.title);
      if (finding.remediation) finding.remediation = redactSensitiveText(finding.remediation);
      if (finding.metadata) finding.metadata = redactDiagnosticValue(finding.metadata) as Record<string, unknown>;
    }
  }
  const findings = results.flatMap((result) => result.findings);
  const baselineFingerprints = new Set(options.baseline?.entries.map((entry) => entry.fingerprint) ?? []);
  for (const finding of findings)
    finding.baselineState = baselineFingerprints.has(finding.fingerprint) ? "existing" : "new";
  const current = new Set(findings.map((finding) => finding.fingerprint));
  const resolvedFindings = options.baseline?.entries.filter((entry) => !current.has(entry.fingerprint)).length ?? 0;
  const newFindings = findings.filter((finding) => finding.baselineState === "new").length;
  const errors = results.filter((result) => result.status === "error").length;
  const thresholdMatches = findings.filter(
    (finding) =>
      severityAtLeast(finding.severity, config.severityThreshold) &&
      (options.baselineFailOn === "all" || finding.baselineState === "new"),
  ).length;
  const exitCode: 0 | 1 | 2 = errors > 0 ? 2 : thresholdMatches > 0 ? 1 : 0;
  for (const result of results) {
    if (result.status === "error")
      logger.error("health.provider.error", result.message ?? `${result.name} could not complete.`, {
        provider: result.provider,
        category: result.category,
      });
    else if (result.status === "fail")
      logger.warn("health.provider.findings", `${result.name} reported findings.`, {
        provider: result.provider,
        category: result.category,
        findings: result.findings.length,
      });
  }
  logger.info("health.run.finish", "Health checks complete", { exitCode, findings: findings.length, errors });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: {
      root: audit.context.root,
      packageManager: audit.context.packageManager,
      kinds: audit.context.kinds,
      frameworks: audit.context.frameworks,
      languages: audit.context.languages,
      ...(audit.context.workspaceRoots ? { workspaces: audit.context.workspaceRoots } : {}),
      scopes: audit.context.scopes.map((scope) => ({ path: scope.path, roles: scope.roles })),
      ...(audit.registry
        ? {
            categories: audit.registry.categories.map((category) => ({
              id: category.id,
              label: category.label,
              description: category.description,
            })),
          }
        : {}),
    },
    summary: {
      status: exitCode === 2 ? "error" : exitCode === 1 ? "findings" : "healthy",
      findings: findings.length,
      newFindings,
      existingFindings: findings.length - newFindings,
      resolvedFindings,
      errors,
      exitCode,
    },
    results,
  };
}

export async function runHealth(
  audit: AuditModel,
  config: RepnixConfig,
  options: RunHealthOptions = {},
): Promise<HealthRun> {
  const logger = resolveDiagnosticLogger(options.logger ?? options);
  const timeoutMs = (options.timeout ?? config.execution.timeoutSeconds) * 1000;
  const results: HealthResult[] = [];
  if (!audit.context.packageManager || audit.context.diagnostics.some((item) => item.severity === "error")) {
    results.push({
      provider: "repnix",
      name: "RepNix configuration",
      category: options.category ?? options.categories?.[0] ?? "types",
      status: "error",
      findings: [],
      durationMs: 0,
      message:
        audit.context.diagnostics.find((item) => item.severity === "error")?.message ?? "Package manager unresolved",
    });
    return finalizeResults(results, audit, config, options, logger);
  }
  for (const coverage of audit.coverage) {
    if (
      categorySelected(coverage.category, options) &&
      (categoryModeFor(config, coverage.category) === "required" ||
        coverage.scopes.some((scope) => categoryModeFor(config, coverage.category, scope) === "required")) &&
      coverage.status !== "covered"
    ) {
      results.push({
        provider: "repnix",
        name: "Required coverage",
        category: coverage.category,
        status: "error",
        findings: [],
        durationMs: 0,
        message: `Required category '${coverage.category}' has no active provider.`,
      });
    }
  }
  const tasks = await planHealthTasks(audit, config, {
    ...(options.category ? { category: options.category } : {}),
    ...(options.categories ? { categories: options.categories } : {}),
    timeoutMs,
    logger,
  });
  const instrumented = tasks.map((task) => ({
    ...task,
    run: async (completed: ReadonlyMap<string, HealthResult>) => {
      logger.info("health.provider.start", `Running ${task.name}`, {
        provider: task.provider,
        category: task.category,
      });
      const result = await task.run(completed);
      logger.info("health.provider.finish", `Finished ${task.name}`, {
        provider: task.provider,
        category: result.category,
        status: result.status,
      });
      return result;
    },
  }));
  results.push(...(await executeTaskPlan(instrumented, options.jobs ?? config.execution.jobs)));
  return finalizeResults(results, audit, config, options, logger);
}
