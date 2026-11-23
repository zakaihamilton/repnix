import type { AuditModel, CoverageStatus } from "../recommendations/recommendation-engine.js";
import { wrapTerminalText } from "../reporting/terminal-format.js";
import type { SetupTuiModel } from "./setup-state.js";
import type { SetupTuiTheme } from "./setup-theme.js";

export {
  manualContentLineCount,
  manualRecommendationLines,
  manualRecommendationSteps,
  manualRecommendationViewport,
  setupCheckDetails,
} from "./provider-guidance.js";

export function auditStatusPresentation(
  status: CoverageStatus,
  theme: SetupTuiTheme,
): { symbol: string; color: string } {
  switch (status) {
    case "covered":
      return { symbol: "✓", color: theme.success };
    case "partial":
      return { symbol: "◐", color: theme.warning };
    case "missing":
      return { symbol: "✗", color: theme.danger };
    case "off":
      return { symbol: "–", color: theme.muted };
    case "not-applicable":
      return { symbol: "·", color: theme.muted };
  }
}

export function auditRecommendationSummary(
  recommendations: AuditModel["recommendations"],
  actionableOnly = false,
): { baseline: number; optional: number; advanced: number; total: number } {
  const considered = actionableOnly
    ? recommendations.filter((recommendation) => recommendation.actionable)
    : recommendations;
  const summary = { baseline: 0, optional: 0, advanced: 0, total: considered.length };
  for (const recommendation of considered) summary[recommendation.priority] += 1;
  return summary;
}

export function auditSetupOptions(audit: AuditModel): string[] {
  return [
    ...audit.recommendations
      .filter((recommendation) => recommendation.actionable)
      .map((recommendation) => recommendation.name),
    ...(audit.context.hasCI ? ["GitHub Actions health step"] : []),
  ];
}

export function selectedSetupOptions(audit: AuditModel, model: SetupTuiModel): string[] {
  return [
    ...audit.recommendations
      .filter(
        (recommendation) =>
          recommendation.actionable &&
          model.selectedProviders.includes(recommendation.provider as SetupTuiModel["selectedProviders"][number]),
      )
      .map((recommendation) => recommendation.name),
    ...(model.includeCi ? ["GitHub Actions health step"] : []),
  ];
}

export interface AuditPageSummary {
  repositoryName: string;
  packageManager: string;
  languages: string[];
  frameworks: string[];
  roles: string[];
  ci: string;
  workspaceCount: number;
}

export function auditPageSummary(audit: AuditModel): AuditPageSummary {
  const context = audit.context;
  return {
    repositoryName: context.packageJson.name ?? "unnamed",
    packageManager: context.packageManager ?? "unresolved",
    languages: context.languages,
    frameworks: context.frameworks,
    roles: [...new Set(context.scopes.flatMap((scope) => scope.roles))],
    ci: context.hasCI ? "GitHub Actions" : "none detected",
    workspaceCount:
      context.workspaceRoots?.filter((root) => root !== ".").length ?? Math.max(context.packageCount - 1, 0),
  };
}

export function auditContentLineCount(audit: AuditModel, singleColumn: boolean, width = 80): number {
  const relevantCoverage = audit.coverage.filter((entry) => entry.status !== "not-applicable");
  const coverageRows = singleColumn ? relevantCoverage.length : Math.ceil(relevantCoverage.length / 2);
  const setupOptions = auditSetupOptions(audit);
  const setupRows = setupOptions.length
    ? wrapTerminalText(`Setup options: ${setupOptions.join(" · ")}`, Math.max(width - 6, 1)).length
    : 0;
  return 9 + coverageRows + setupRows;
}
