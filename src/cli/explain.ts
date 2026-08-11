import { readConfig } from "../config/repo-health-config.js";
import { renderExplain } from "../reporting/console-reporter.js";
import { runHealth } from "../runners/health-runner.js";
import { auditRepository } from "./audit.js";
import { resolveDiagnosticLogger, type DiagnosticOptions } from "./options.js";

export async function explainCommand(options: DiagnosticOptions = {}): Promise<number> {
  const logger = resolveDiagnosticLogger(options);
  const audit = await auditRepository(process.cwd(), { ...options, logger });
  const { config } = await readConfig(audit.context.root);
  const run = await runHealth(audit, config, { ...options, logger });
  process.stdout.write(`${renderExplain(run)}\n`);
  return run.summary.exitCode;
}
