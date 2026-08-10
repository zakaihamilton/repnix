import { readConfig } from "../config/repo-health-config.js";
import { detectAllProviders } from "../providers/catalog.js";
import { buildAuditModel, type AuditModel } from "../recommendations/recommendation-engine.js";
import { detectRepository } from "../repository/detect-repository.js";
import { renderAudit } from "../reporting/console-reporter.js";

export async function auditRepository(cwd = process.cwd()): Promise<AuditModel> {
  const context = await detectRepository(cwd);
  const { config } = await readConfig(context.root);
  return buildAuditModel(context, detectAllProviders(context), config);
}

export async function auditCommand(): Promise<number> {
  const model = await auditRepository();
  process.stdout.write(`${renderAudit(model)}\n`);
  return model.context.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 2 : 0;
}
