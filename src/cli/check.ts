import { readConfig } from "../config/repo-health-config.js";
import { HEALTH_CATEGORIES, type HealthCategory } from "../core/health-category.js";
import { renderHealth } from "../reporting/console-reporter.js";
import { runHealth } from "../runners/health-runner.js";
import { auditRepository } from "./audit.js";
import { resolveDiagnosticLogger, type DiagnosticOptions } from "./options.js";

export interface CheckOptions extends DiagnosticOptions {
  json?: boolean;
}

export async function checkCommand(category: string | undefined, options: CheckOptions): Promise<number> {
  if (category && !HEALTH_CATEGORIES.includes(category as HealthCategory)) {
    throw new Error(`Unknown health category '${category}'. Expected one of: ${HEALTH_CATEGORIES.join(", ")}`);
  }
  const logger = resolveDiagnosticLogger(options);
  const audit = await auditRepository(process.cwd(), { ...options, logger });
  const { config } = await readConfig(audit.context.root);
  const run = await runHealth(audit, config, {
    ...(category ? { category: category as HealthCategory } : {}),
    ...options,
    logger,
  });
  process.stdout.write(options.json ? `${JSON.stringify(run, null, 2)}\n` : `${renderHealth(run)}\n`);
  return run.summary.exitCode;
}
