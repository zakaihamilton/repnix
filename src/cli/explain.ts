import { readConfig } from "../config/repo-health-config.js";
import { renderExplain } from "../reporting/console-reporter.js";
import { runHealth } from "../runners/health-runner.js";
import { auditRepository } from "./audit.js";

export async function explainCommand(): Promise<number> {
  const audit = await auditRepository();
  const { config } = await readConfig(audit.context.root);
  const run = await runHealth(audit, config);
  process.stdout.write(`${renderExplain(run)}\n`);
  return run.summary.exitCode;
}
