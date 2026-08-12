import { applyScopeOverrides, readConfig, validateConfigCategories } from "../config/repo-health-config.js";
import { detectAllProviders } from "../providers/catalog.js";
import { createProviderRegistry } from "../providers/registry.js";
import { buildAuditModel, type AuditModel } from "../recommendations/recommendation-engine.js";
import { detectRepository } from "../repository/detect-repository.js";
import { renderAudit } from "../reporting/console-reporter.js";
import { resolveDiagnosticLogger, type DiagnosticOptions } from "./options.js";

export interface AuditOptions extends DiagnosticOptions {
  format?: "text" | "json";
  details?: boolean;
}

export async function auditRepository(cwd = process.cwd(), options: DiagnosticOptions = {}): Promise<AuditModel> {
  const logger = resolveDiagnosticLogger(options);
  const detectedContext = await detectRepository(cwd);
  logger.debug("repository.detected", "Repository detected", {
    root: detectedContext.root,
    packageManager: detectedContext.packageManager ?? "unresolved",
    sourceRoots: detectedContext.sourceRoots,
    fileCount: detectedContext.files.size,
  });
  const registry = await createProviderRegistry(detectedContext);
  const { config } = await readConfig(detectedContext.root);
  validateConfigCategories(config, registry.categories.map((category) => category.id));
  const context = applyScopeOverrides(detectedContext, config);
  const detections = await detectAllProviders(context, registry.providers);
  const activeProviders = [...detections.entries()]
    .filter(([, detection]) => Object.keys(detection.activeCapabilities).length > 0)
    .map(([id]) => id);
  logger.debug("providers.detected", "Provider detection complete", { activeProviders });
  return buildAuditModel(context, detections, config, registry);
}

function serializeAudit(model: AuditModel): object {
  return {
    schemaVersion: 1,
    repository: {
      root: model.context.root,
      packageManager: model.context.packageManager,
      scopes: model.context.scopes.map((scope) => ({ path: scope.path, roles: scope.roles, roleEvidence: scope.roleEvidence, frameworks: scope.frameworks, languages: scope.languages, sourceFiles: scope.sourceFiles.length })),
      diagnostics: model.context.diagnostics,
    },
    coverage: model.coverage,
    recommendations: model.recommendations,
  };
}

export async function auditCommand(options: AuditOptions = {}): Promise<number> {
  if (options.format && !["text", "json"].includes(options.format)) throw new Error(`Unknown audit format '${options.format}'. Use text or json.`);
  const model = await auditRepository(process.cwd(), options);
  process.stdout.write(options.format === "json" ? `${JSON.stringify(serializeAudit(model), null, 2)}\n` : `${renderAudit(model, options.details === undefined ? {} : { details: options.details })}\n`);
  return model.context.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 2 : 0;
}
