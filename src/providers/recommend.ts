import type { ProviderRecommendation, RepositoryContext } from "../core/types.js";
import { safeTestScript } from "../repository/script-detection.js";
import type { ProviderModule, RecommendHelpers } from "./sdk.js";

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];

export function hasPublishedTypes(context: RepositoryContext): boolean {
  if (typeof context.packageJson.types === "string" || typeof context.packageJson.typings === "string") return true;
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === "types" || visit(child));
  };
  return visit(context.packageJson.exports);
}

function coveredOrOff(helpers?: RecommendHelpers): boolean {
  return helpers?.coverageStatus === "covered" || helpers?.coverageStatus === "off";
}

function recommendKnip(context: RepositoryContext, helpers?: RecommendHelpers): ProviderRecommendation | null {
  if (coveredOrOff(helpers) || context.sourceFiles.length === 0 || helpers?.detections.get("knip")?.installed) return null;
  return {
    recommended: true,
    priority: "baseline",
    actionable: true,
    reason: `${context.sourceFiles.length} JavaScript/TypeScript source file${context.sourceFiles.length === 1 ? "" : "s"} were found, but nothing currently checks for unused files, exports, or dependencies. This helps remove stale code and keeps dependencies intentional.`,
  };
}

function recommendJscpd(context: RepositoryContext, helpers?: RecommendHelpers): ProviderRecommendation | null {
  if (coveredOrOff(helpers) || context.sourceFiles.length < 2 || helpers?.detections.get("jscpd")?.installed) return null;
  return {
    recommended: true,
    priority: "baseline",
    actionable: true,
    reason: `${context.sourceFiles.length} source files can accumulate copy-and-paste drift, and no duplication check is active. This helps you find repeated code before the copies start behaving differently.`,
  };
}

function recommendOsv(context: RepositoryContext, helpers?: RecommendHelpers): ProviderRecommendation | null {
  const lockfiles = LOCKFILES.filter((file) => context.files.has(file));
  if (coveredOrOff(helpers) || lockfiles.length === 0 || helpers?.detections.get("osv-scanner")?.activeCapabilities.vulnerabilities) return null;
  return {
    recommended: true,
    priority: "baseline",
    actionable: false,
    reason: `${lockfiles.join(", ")} lists the dependencies in this project, but none are being checked for known vulnerabilities. OSV-Scanner uses a local advisory database, so its binary and database must be prepared before checks can run.`,
  };
}

function recommendEslintBoundaries(context: RepositoryContext, helpers?: RecommendHelpers): ProviderRecommendation | null {
  if (coveredOrOff(helpers) || context.sourceFiles.length < 2) return null;
  if (helpers?.detections.get("eslint")?.activeCapabilities.linting !== true) return null;
  if (helpers?.detections.get("eslint-boundaries")?.activeCapabilities.architectureRules) return null;
  return {
    recommended: true,
    priority: "optional",
    actionable: false,
    reason: "ESLint is already active, so eslint-plugin-boundaries can add dependency rules without introducing another lint command. You will need to define which folders or module types may depend on each other.",
  };
}

function recommendDependencyCruiser(context: RepositoryContext, helpers?: RecommendHelpers): ProviderRecommendation | null {
  if (coveredOrOff(helpers) || context.sourceFiles.length < 2) return null;
  if (helpers?.detections.get("eslint")?.activeCapabilities.linting === true) return null;
  if (helpers?.detections.get("dependency-cruiser")?.activeCapabilities.architectureRules) return null;
  return {
    recommended: true,
    priority: "optional",
    actionable: true,
    reason: "No ESLint architecture rules are active. dependency-cruiser can find dependency cycles and stop production code from importing test code, without changing your existing lint setup.",
  };
}

function recommendSizeLimit(_context: RepositoryContext, helpers?: RecommendHelpers): ProviderRecommendation | null {
  if (coveredOrOff(helpers) || helpers?.coverageStatus === "not-applicable") return null;
  if (helpers?.detections.get("size-limit")?.activeCapabilities.bundleBudget) return null;
  return {
    recommended: true,
    priority: "optional",
    actionable: false,
    reason: "This frontend or publishable package ships JavaScript that can grow over time. Size Limit is useful after you choose a real build artifact and an explicit size budget; RepNix will not guess that budget for you.",
  };
}

function recommendPublint(_context: RepositoryContext, helpers?: RecommendHelpers): ProviderRecommendation | null {
  if (helpers?.coverageStatus === "off" || helpers?.coverageStatus === "not-applicable") return null;
  if (helpers?.detections.get("publint")?.activeCapabilities.packagePublishing) return null;
  return {
    recommended: true,
    priority: "baseline",
    actionable: true,
    reason: "This repository is publishable to npm, but nothing currently checks whether the package metadata, entry points, and published files agree. Publint checks the package consumers will actually install.",
  };
}

function recommendAttw(context: RepositoryContext, helpers?: RecommendHelpers): ProviderRecommendation | null {
  if (helpers?.coverageStatus === "off" || helpers?.coverageStatus === "not-applicable") return null;
  if (!hasPublishedTypes(context) || helpers?.detections.get("attw")?.activeCapabilities.typesCompatibility) return null;
  const evidence = typeof context.packageJson.types === "string"
    ? `package.json#types points to ${context.packageJson.types}`
    : typeof context.packageJson.typings === "string"
      ? `package.json#typings points to ${context.packageJson.typings}`
      : "package.json exports contains a types condition";
  return {
    recommended: true,
    priority: "baseline",
    actionable: true,
    reason: `${evidence}, but TypeScript consumer resolution is not actively checked. Are The Types Wrong? tests the locally packed package in the ways Node and bundlers resolve TypeScript types.`,
  };
}

function recommendJsxA11y(context: RepositoryContext): ProviderRecommendation {
  const legacyJsonConfig = context.editableLegacyEslintConfig === true;
  return {
    recommended: true,
    priority: "baseline",
    actionable: legacyJsonConfig,
    reason: legacyJsonConfig
      ? "This UI repository uses JSX, but no active accessibility rules were detected. RepNix can safely add jsx-a11y’s recommended rules to the root legacy JSON ESLint configuration."
      : "This UI repository uses JSX, but no active accessibility rules were detected. Enable jsx-a11y’s recommended rules in the existing ESLint configuration.",
  };
}

function recommendSyncpack(): ProviderRecommendation {
  return {
    recommended: true,
    priority: "baseline",
    actionable: true,
    reason: "This repository contains multiple workspaces, but dependency versions and package metadata are not being checked for consistency.",
  };
}

function recommendC8(context: RepositoryContext): ProviderRecommendation {
  const testScript = safeTestScript(context.scripts);
  return {
    recommended: true,
    priority: "baseline",
    actionable: testScript !== null,
    reason: testScript
      ? "Tests are present, but no coverage command is active. RepNix can safely add a report-only c8 command around the existing non-watch test script; coverage thresholds remain an explicit project policy."
      : "Tests are present, but RepNix could not find a safe non-watch test script to wrap with c8. Add a project-specific coverage command and threshold rather than treating raw line counts as a universal quality score.",
  };
}

function recommendStryker(): ProviderRecommendation {
  return {
    recommended: true,
    priority: "advanced",
    actionable: false,
    reason: "Mutation testing measures whether tests catch behavior changes. It requires a test-specific configuration and can be expensive, so it is an advanced recommendation.",
  };
}

function recommendGitleaks(): ProviderRecommendation {
  return {
    recommended: true,
    priority: "baseline",
    actionable: false,
    reason: "No secret scanner is active. Gitleaks can detect credentials before they reach the repository or CI artifacts.",
  };
}

function recommendLicenseChecker(): ProviderRecommendation {
  return {
    recommended: true,
    priority: "optional",
    actionable: true,
    reason: "Dependencies are present, but no license report is active. Add an allow/deny policy before making license violations fail CI.",
  };
}

function recommendMarkdownlint(): ProviderRecommendation {
  return {
    recommended: true,
    priority: "optional",
    actionable: true,
    reason: "Markdown documentation is present, but no documentation style check is active.",
  };
}

function recommendLhci(): ProviderRecommendation {
  return {
    recommended: true,
    priority: "optional",
    actionable: false,
    reason: "This repository ships frontend or package output, but no runtime performance budget is active. Configure Lighthouse CI against a real URL or build.",
  };
}

function recommendChangesets(context: RepositoryContext): ProviderRecommendation {
  const hasDefaultBranch = Boolean(context.gitDefaultBranch);
  return {
    recommended: true,
    priority: "optional",
    actionable: hasDefaultBranch,
    reason: hasDefaultBranch
      ? "This repository appears publishable or multi-package, but release metadata is not being checked. RepNix can create standard Changesets configuration using the Git remote’s default branch."
      : "This repository appears publishable or multi-package, but release metadata is not being checked. Changesets needs the Git remote’s default branch, which RepNix could not resolve safely.",
  };
}

function recommendActionlint(): ProviderRecommendation {
  return {
    recommended: true,
    priority: "optional",
    actionable: false,
    reason: "GitHub Actions workflows are present, but their syntax and common automation mistakes are not being checked.",
  };
}

export const PROVIDER_RECOMMENDATIONS: Record<string, { order: number; recommend: NonNullable<ProviderModule["recommend"]> }> = {
  knip: { order: 10, recommend: recommendKnip },
  jscpd: { order: 20, recommend: recommendJscpd },
  "osv-scanner": { order: 30, recommend: recommendOsv },
  "eslint-boundaries": { order: 40, recommend: recommendEslintBoundaries },
  "dependency-cruiser": { order: 50, recommend: recommendDependencyCruiser },
  "size-limit": { order: 60, recommend: recommendSizeLimit },
  publint: { order: 70, recommend: recommendPublint },
  attw: { order: 80, recommend: recommendAttw },
  "jsx-a11y": { order: 90, recommend: recommendJsxA11y },
  syncpack: { order: 100, recommend: recommendSyncpack },
  c8: { order: 110, recommend: recommendC8 },
  stryker: { order: 120, recommend: recommendStryker },
  gitleaks: { order: 130, recommend: recommendGitleaks },
  "license-checker": { order: 140, recommend: recommendLicenseChecker },
  markdownlint: { order: 150, recommend: recommendMarkdownlint },
  lhci: { order: 160, recommend: recommendLhci },
  changesets: { order: 170, recommend: recommendChangesets },
  actionlint: { order: 180, recommend: recommendActionlint },
};
