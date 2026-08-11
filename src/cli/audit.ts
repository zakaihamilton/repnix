import { readConfig } from "../config/repo-health-config.js";
import { detectAllProviders } from "../providers/catalog.js";
import { buildAuditModel, type AuditModel } from "../recommendations/recommendation-engine.js";
import { detectRepository } from "../repository/detect-repository.js";
import { renderAudit } from "../reporting/console-reporter.js";
import { resolveDiagnosticLogger, type DiagnosticOptions } from "./options.js";

export async function auditRepository(cwd = process.cwd(), options: DiagnosticOptions = {}): Promise<AuditModel> {
  const logger = resolveDiagnosticLogger(options);
  const context = await detectRepository(cwd);
  logger.debug("repository.detected", "Repository detected", {
    root: context.root,
    packageManager: context.packageManager ?? "unresolved",
    sourceRoots: context.sourceRoots,
    fileCount: context.files.size,
  });
  const { config } = await readConfig(context.root);
  const detections = await detectAllProviders(context);
  const activeProviders = [...detections.entries()]
    .filter(([, detection]) => Object.keys(detection.activeCapabilities).length > 0)
    .map(([id]) => id);
  logger.debug("providers.detected", "Provider detection complete", { activeProviders });
  return buildAuditModel(context, detections, config);
}

export async function auditCommand(options: DiagnosticOptions = {}): Promise<number> {
  const model = await auditRepository(process.cwd(), options);
  process.stdout.write(`${renderAudit(model)}\n`);
  return model.context.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 2 : 0;
}
