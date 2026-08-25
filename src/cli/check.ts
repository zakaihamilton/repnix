import { readConfig } from "../config/repo-health-config.js";
import { enableBaselineConfig, readBaseline, writeBaseline } from "../config/baseline.js";
import { CATEGORY_LABELS, HEALTH_CATEGORIES, type HealthCategory } from "../core/health-category.js";
import { renderHealth, renderHealthDetails, renderSarif } from "../reporting/console-reporter.js";
import { runHealth } from "../runners/health-runner.js";
import { auditRepository } from "./audit.js";
import { resolveDiagnosticLogger, type DiagnosticOptions } from "./options.js";

export interface CheckOptions extends DiagnosticOptions {
  format?: "summary" | "details" | "json" | "sarif";
  writeBaseline?: boolean | string;
  jobs?: number;
}

export async function checkCommand(category: string | undefined, options: CheckOptions): Promise<number> {
  if (options.format && !["summary", "details", "json", "sarif"].includes(options.format))
    throw new Error(`Unknown check format '${options.format}'. Use summary, details, json, or sarif.`);
  const logger = resolveDiagnosticLogger(options);
  const audit = await auditRepository(process.cwd(), { ...options, logger });
  const availableCategories = audit.registry?.categories.map((entry) => entry.id) ?? HEALTH_CATEGORIES;
  if (category && !availableCategories.includes(category)) {
    const choices = availableCategories.map((name) => `${name} (${CATEGORY_LABELS[name] ?? name})`).join(", ");
    throw new Error(
      `Unknown health category '${category}'. Use a category name such as 'dead-code' or 'security'. Available categories: ${choices}`,
    );
  }
  const { config } = await readConfig(audit.context.root);
  const baseline =
    config.baseline && !options.writeBaseline
      ? await readBaseline(audit.context.root, config.baseline.path)
      : undefined;
  const run = await runHealth(audit, config, {
    ...(category ? { category: category as HealthCategory } : {}),
    ...options,
    ...(baseline ? { baseline, baselineFailOn: config.baseline?.failOn ?? "new" } : {}),
    logger,
  });
  const format = options.format ?? "summary";
  const output =
    format === "json"
      ? JSON.stringify(run, null, 2)
      : format === "sarif"
        ? renderSarif(run)
        : format === "details"
          ? renderHealthDetails(run)
          : renderHealth(run);
  process.stdout.write(`${output}\n`);
  if (options.writeBaseline) {
    const baselinePath =
      typeof options.writeBaseline === "string"
        ? options.writeBaseline
        : (config.baseline?.path ?? ".repnix-baseline.json");
    await writeBaseline(audit.context.root, baselinePath, run);
    await enableBaselineConfig(audit.context.root, baselinePath);
    if (format !== "json" && format !== "sarif")
      process.stdout.write(`\nBaseline written to ${baselinePath}. Future checks will fail only on new findings.\n`);
    return 0;
  }
  return run.summary.exitCode;
}
