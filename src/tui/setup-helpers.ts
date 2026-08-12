import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS } from "../core/health-category.js";
import { builtinProvider } from "../providers/registry.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { RepositoryContext } from "../core/types.js";
import type { AuditModel, CoverageStatus } from "../recommendations/recommendation-engine.js";
import { wrapTerminalText } from "../reporting/console-reporter.js";
import type { SetupTuiTheme } from "./setup-theme.js";
import type { SetupTuiModel } from "./setup-state.js";

export function auditStatusPresentation(status: CoverageStatus, theme: SetupTuiTheme): { symbol: string; color: string } {
  switch (status) {
    case "covered": return { symbol: "✓", color: theme.success };
    case "partial": return { symbol: "◐", color: theme.warning };
    case "missing": return { symbol: "✗", color: theme.danger };
    case "off": return { symbol: "–", color: theme.muted };
    case "not-applicable": return { symbol: "·", color: theme.muted };
  }
}

export function auditRecommendationSummary(recommendations: AuditModel["recommendations"], actionableOnly = false): { baseline: number; optional: number; advanced: number; total: number } {
  const considered = actionableOnly ? recommendations.filter((recommendation) => recommendation.actionable) : recommendations;
  const summary = { baseline: 0, optional: 0, advanced: 0, total: considered.length };
  for (const recommendation of considered) summary[recommendation.priority] += 1;
  return summary;
}

export function auditSetupOptions(audit: AuditModel): string[] {
  return [...audit.recommendations.filter((recommendation) => recommendation.actionable).map((recommendation) => recommendation.name), ...(audit.context.hasCI ? ["GitHub Actions health step"] : [])];
}

export function selectedSetupOptions(audit: AuditModel, model: SetupTuiModel): string[] {
  return [...audit.recommendations.filter((recommendation) => recommendation.actionable && model.selectedProviders.includes(recommendation.provider as SetupTuiModel["selectedProviders"][number])).map((recommendation) => recommendation.name), ...(model.includeCi ? ["GitHub Actions health step"] : [])];
}

export interface AuditPageSummary { repositoryName: string; packageManager: string; languages: string[]; frameworks: string[]; roles: string[]; ci: string; workspaceCount: number }

export function auditPageSummary(audit: AuditModel): AuditPageSummary {
  const context = audit.context;
  return {
    repositoryName: context.packageJson.name ?? "unnamed",
    packageManager: context.packageManager ?? "unresolved",
    languages: context.languages,
    frameworks: context.frameworks,
    roles: [...new Set(context.scopes.flatMap((scope) => scope.roles))],
    ci: context.hasCI ? "GitHub Actions" : "none detected",
    workspaceCount: context.workspaceRoots?.filter((root) => root !== ".").length ?? Math.max(context.packageCount - 1, 0),
  };
}

export function auditContentLineCount(audit: AuditModel, singleColumn: boolean, width = 80): number {
  const relevantCoverage = audit.coverage.filter((entry) => entry.status !== "not-applicable");
  const coverageRows = singleColumn ? relevantCoverage.length : Math.ceil(relevantCoverage.length / 2);
  const setupOptions = auditSetupOptions(audit);
  const setupRows = setupOptions.length ? wrapTerminalText(`Setup options: ${setupOptions.join(" · ")}`, Math.max(width - 6, 1)).length : 0;
  return 9 + coverageRows + setupRows;
}

export interface SetupCheckDetails { checks: string[]; scope: string; setup: string[]; command: string; caveat?: string }

function packageManagerRun(context: RepositoryContext, script: string): string { return context.packageManager ? `${context.packageManager} run ${script}` : `run ${script}`; }

function sourceScope(context: RepositoryContext): string {
  const fileCount = `${context.sourceFiles.length} source file${context.sourceFiles.length === 1 ? "" : "s"}`;
  if (!context.sourceRoots.length) return fileCount;
  const roots = context.sourceRoots.slice(0, 3).join(", ");
  const suffix = context.sourceRoots.length > 3 ? `, +${context.sourceRoots.length - 3} more` : "";
  return `${fileCount} under ${roots}${suffix}`;
}

function existingConfig(context: RepositoryContext, files: string[]): string | undefined { return files.find((file) => context.files.has(file)); }

export function setupCheckDetails(recommendation: AuditModel["recommendations"][number], context: RepositoryContext, registry?: ProviderRegistry): SetupCheckDetails {
  const scope = sourceScope(context);
  const provider = registry?.get(recommendation.provider) ?? builtinProvider(recommendation.provider);
  switch (recommendation.provider) {
    case "knip": return { checks: ["Unused files, exports, and dependencies that are not reachable from the project entry points."], scope: `${scope}; package.json scripts and workspace packages are used to understand entry points.`, setup: ["Install Knip as a development dependency.", "Add the health:dead-code script to package.json."], command: packageManagerRun(context, "health:dead-code") };
    case "jscpd": {
      const config = existingConfig(context, [".jscpd.json", "jscpd.json"]);
      return { checks: ["Repeated code blocks across the detected source roots, including copies that can drift apart over time."], scope, setup: ["Install jscpd as a development dependency.", "Add the health:duplication script to package.json.", config ? `Extend ${config} with safe generated/build exclusions.` : "Create .jscpd.json with safe generated/build exclusions."], command: packageManagerRun(context, "health:duplication"), ...(context.packageJson.jscpd !== undefined && !config ? { caveat: "A jscpd configuration embedded in package.json will be preserved; verify its exclusions manually." } : {}) };
    }
    case "dependency-cruiser": {
      const config = existingConfig(context, [".dependency-cruiser.json", ".dependency-cruiser.js", ".dependency-cruiser.cjs", ".dependency-cruiser.mjs", ".dependency-cruiser.ts"]);
      return { checks: ["Circular dependencies between modules.", "Production source importing test files through conservative starter rules."], scope, setup: ["Install dependency-cruiser as a development dependency.", "Add the health:architecture script to package.json.", config ? `Use the existing ${config} without overwriting it.` : "Create .dependency-cruiser.cjs with conservative starter rules."], command: packageManagerRun(context, "health:architecture"), ...(config ? { caveat: `Existing rules in ${config} are preserved and will determine the final boundaries.` } : {}) };
    }
    case "publint": return { checks: ["Package exports, entry points, metadata, and the files consumers receive from npm."], scope: `${context.packageJson.name ?? "the package"} package manifest and its publishable file layout.`, setup: ["Install Publint as a development dependency.", "Add the health:package:publint script to package.json."], command: packageManagerRun(context, "health:package:publint") };
    case "attw": return { checks: ["Whether TypeScript types resolve correctly for consumers using Node and bundler-style package entry points."], scope: `${context.packageJson.name ?? "the package"} after it is packed, including its published type declarations.`, setup: ["Install Are The Types Wrong? as a development dependency.", "Add the health:package:types script to package.json."], command: packageManagerRun(context, "health:package:types") };
    default: {
      const caveat = provider?.setup?.details?.caveat?.(context) ?? provider?.nextStep;
      return { checks: provider?.setup?.details?.checks ?? provider?.setup?.checks ?? [provider?.description ?? "The recommended repository health check."], scope: provider?.setup?.details?.scope?.(context) ?? scope, setup: provider?.setup ? [`Install ${provider.setup.packageName} as a development dependency.`, `Add the ${provider.setup.scriptName} script to package.json.`] : ["Follow the provider preparation recipe."], command: packageManagerRun(context, provider?.setup?.scriptName ?? `health:${recommendation.category}`), ...(caveat ? { caveat } : {}) };
    }
  }
}

export { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS };
