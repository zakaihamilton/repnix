import type { HealthCategory } from "../core/health-category.js";
import type {
  ProviderCapabilities,
  ProviderDetection,
  ProviderRecommendation,
  RepositoryContext,
} from "../core/types.js";
import type { RepnixConfig } from "../config/repo-health-config.js";
import { PROVIDERS } from "../providers/catalog.js";

type Capability = keyof ProviderCapabilities;

const REQUIREMENTS: Record<HealthCategory, Capability[]> = {
  types: ["typeChecking"],
  lint: ["linting"],
  format: ["formatting"],
  tests: ["testing"],
  coverage: ["testCoverage"],
  "dead-code": ["unusedFiles", "unusedExports", "unusedDependencies"],
  duplication: ["duplication"],
  security: ["vulnerabilities"],
  architecture: ["architectureRules"],
  bundle: ["bundleBudget"],
  accessibility: ["accessibilityRules"],
  monorepo: ["workspaceConsistency"],
  secrets: ["secrets"],
  licenses: ["licenses"],
  documentation: ["documentation"],
  performance: ["performance"],
  release: ["release"],
  ci: ["ciWorkflow"],
  "package-health": ["packagePublishing"],
};

export type CoverageStatus = "covered" | "partial" | "missing" | "not-applicable" | "off";

export interface CategoryCoverage {
  category: HealthCategory;
  status: CoverageStatus;
  providers: string[];
  capabilities: Capability[];
  missingCapabilities: Capability[];
  reason?: string;
}

export interface Recommendation extends ProviderRecommendation {
  provider: string;
  name: string;
  category: HealthCategory;
}

function hasPublishedTypes(context: RepositoryContext): boolean {
  if (typeof context.packageJson.types === "string" || typeof context.packageJson.typings === "string") return true;
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === "types" || visit(child));
  };
  return visit(context.packageJson.exports);
}

function requirementsFor(category: HealthCategory, context: RepositoryContext): Capability[] {
  if (category === "package-health" && hasPublishedTypes(context)) {
    return ["packagePublishing", "typesCompatibility"];
  }
  return REQUIREMENTS[category];
}

export interface AuditModel {
  context: RepositoryContext;
  detections: Map<string, ProviderDetection>;
  coverage: CategoryCoverage[];
  recommendations: Recommendation[];
}

function isApplicable(category: HealthCategory, context: RepositoryContext): boolean {
  switch (category) {
    case "types":
      return context.languages.includes("TypeScript");
    case "bundle":
      return context.kinds.includes("react") || context.kinds.includes("nextjs") || context.kinds.includes("npm-library");
    case "accessibility":
      return context.kinds.includes("react") || context.kinds.includes("nextjs");
    case "monorepo":
      return context.isMonorepo;
    case "package-health":
      return context.kinds.includes("npm-library");
    case "coverage":
      return context.sourceFiles.length > 0 && context.manifests.some((manifest) => Object.keys(manifest.packageJson.scripts ?? {}).some((name) => /^(test|test:run|check:test)/.test(name)));
    case "secrets":
      return context.files.size > 0;
    case "licenses":
      return context.installedPackages.size > 0;
    case "documentation":
      return [...context.files].some((file) => /\.md$/i.test(file));
    case "performance":
      return context.kinds.includes("react") || context.kinds.includes("nextjs") || context.kinds.includes("npm-library");
    case "release":
      return context.kinds.includes("npm-library") || context.isMonorepo;
    case "ci":
      return context.hasCI;
    default:
      return context.sourceFiles.length > 0;
  }
}

function coverageFor(
  category: HealthCategory,
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
  config: RepnixConfig,
): CategoryCoverage {
  if (config.categories?.[category] === "off") {
    return { category, status: "off", providers: [], capabilities: [], missingCapabilities: [] };
  }
  if (!isApplicable(category, context)) {
    return { category, status: "not-applicable", providers: [], capabilities: [], missingCapabilities: [] };
  }
  const required = requirementsFor(category, context);
  if (required.length === 0) {
    return {
      category,
      status: "missing",
      providers: [],
      capabilities: [],
      missingCapabilities: [],
      reason: "No installable provider is available for this category in the MVP.",
    };
  }
  const providers: string[] = [];
  const active = new Set<Capability>();
  for (const descriptor of PROVIDERS) {
    const detection = detections.get(descriptor.id);
    if (!detection) continue;
    const explicitlyDisabled = config.providers?.[descriptor.id as keyof NonNullable<RepnixConfig["providers"]>]?.enabled === false;
    if (explicitlyDisabled) continue;
    const matching = required.filter((capability) => detection.activeCapabilities[capability]);
    if (matching.length > 0) {
      providers.push(descriptor.name);
      matching.forEach((capability) => active.add(capability));
    }
  }
  const missingCapabilities = required.filter((capability) => !active.has(capability));
  return {
    category,
    status:
      missingCapabilities.length === 0 ? "covered" : active.size > 0 ? "partial" : "missing",
    providers,
    capabilities: [...active],
    missingCapabilities,
  };
}

export function buildAuditModel(
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
  config: RepnixConfig,
): AuditModel {
  const categories = Object.keys(REQUIREMENTS) as HealthCategory[];
  const coverage = categories.map((category) => coverageFor(category, context, detections, config));
  const byCategory = new Map(coverage.map((entry) => [entry.category, entry]));
  const recommendations: Recommendation[] = [];
  const providerEnabled = (id: string) => (config.providers as Record<string, { enabled: boolean }> | undefined)?.[id]?.enabled !== false;

  const deadCode = byCategory.get("dead-code")!;
  const knip = detections.get("knip")!;
  if (
    deadCode.status !== "covered" &&
    deadCode.status !== "off" &&
    context.sourceFiles.length > 0 &&
    !knip.installed &&
    providerEnabled("knip")
  ) {
    recommendations.push({
      provider: "knip",
      name: "Knip",
      category: "dead-code",
      recommended: true,
      priority: "baseline",
      actionable: true,
      reason: `${context.sourceFiles.length} JavaScript/TypeScript source file${context.sourceFiles.length === 1 ? "" : "s"} were found, but nothing currently checks for unused files, exports, or dependencies. This helps remove stale code and keeps dependencies intentional.`,
    });
  }

  const duplication = byCategory.get("duplication")!;
  const jscpd = detections.get("jscpd")!;
  if (
    duplication.status !== "covered" &&
    duplication.status !== "off" &&
    context.sourceFiles.length >= 2 &&
    !jscpd.installed &&
    providerEnabled("jscpd")
  ) {
    recommendations.push({
      provider: "jscpd",
      name: "jscpd",
      category: "duplication",
      recommended: true,
      priority: "baseline",
      actionable: true,
      reason: `${context.sourceFiles.length} source files can accumulate copy-and-paste drift, and no duplication check is active. This helps you find repeated code before the copies start behaving differently.`,
    });
  }

  const security = byCategory.get("security")!;
  const osv = detections.get("osv-scanner")!;
  const lockfiles = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]
    .filter((file) => context.files.has(file));
  if (
    security.status !== "covered" &&
    security.status !== "off" &&
    lockfiles.length > 0 &&
    !osv.activeCapabilities.vulnerabilities &&
    providerEnabled("osv-scanner")
  ) {
    recommendations.push({
      provider: "osv-scanner",
      name: "OSV-Scanner",
      category: "security",
      recommended: true,
      priority: "baseline",
      actionable: false,
      reason: `${lockfiles.join(", ")} lists the dependencies in this project, but none are being checked for known vulnerabilities. OSV-Scanner uses a local advisory database, so its binary and database must be prepared before checks can run.`,
    });
  }

  const architecture = byCategory.get("architecture")!;
  if (architecture.status !== "covered" && architecture.status !== "off" && context.sourceFiles.length >= 2) {
    const eslintActive = detections.get("eslint")?.activeCapabilities.linting === true;
    const boundaries = detections.get("eslint-boundaries")!;
    const cruiser = detections.get("dependency-cruiser")!;
    if (eslintActive && !boundaries.activeCapabilities.architectureRules && providerEnabled("eslint-boundaries")) {
      recommendations.push({
        provider: "eslint-boundaries",
        name: "eslint-plugin-boundaries",
        category: "architecture",
        recommended: true,
        priority: "optional",
        actionable: false,
        reason: "ESLint is already active, so eslint-plugin-boundaries can add dependency rules without introducing another lint command. You will need to define which folders or module types may depend on each other.",
      });
    } else if (!eslintActive && !cruiser.activeCapabilities.architectureRules && providerEnabled("dependency-cruiser")) {
      recommendations.push({
        provider: "dependency-cruiser",
        name: "dependency-cruiser",
        category: "architecture",
        recommended: true,
        priority: "optional",
        actionable: true,
        reason: "No ESLint architecture rules are active. dependency-cruiser can find dependency cycles and stop production code from importing test code, without changing your existing lint setup.",
      });
    }
  }

  const bundle = byCategory.get("bundle")!;
  const sizeLimit = detections.get("size-limit")!;
  if (
    bundle.status !== "covered" &&
    bundle.status !== "off" &&
    bundle.status !== "not-applicable" &&
    !sizeLimit.activeCapabilities.bundleBudget &&
    providerEnabled("size-limit")
  ) {
    recommendations.push({
      provider: "size-limit",
      name: "Size Limit",
      category: "bundle",
      recommended: true,
      priority: "optional",
      actionable: false,
      reason: "This frontend or publishable package ships JavaScript that can grow over time. Size Limit is useful after you choose a real build artifact and an explicit size budget; RepNix will not guess that budget for you.",
    });
  }

  const packageHealth = byCategory.get("package-health")!;
  if (packageHealth.status !== "off" && packageHealth.status !== "not-applicable") {
    const publint = detections.get("publint")!;
    if (!publint.activeCapabilities.packagePublishing && providerEnabled("publint")) {
      recommendations.push({
        provider: "publint",
        name: "Publint",
        category: "package-health",
        recommended: true,
        priority: "baseline",
        actionable: true,
        reason: "This repository is publishable to npm, but nothing currently checks whether the package metadata, entry points, and published files agree. Publint checks the package consumers will actually install.",
      });
    }
    const attw = detections.get("attw")!;
    if (hasPublishedTypes(context) && !attw.activeCapabilities.typesCompatibility && providerEnabled("attw")) {
      const evidence = typeof context.packageJson.types === "string"
        ? `package.json#types points to ${context.packageJson.types}`
        : typeof context.packageJson.typings === "string"
          ? `package.json#typings points to ${context.packageJson.typings}`
          : "package.json exports contains a types condition";
      recommendations.push({
        provider: "attw",
        name: "Are The Types Wrong?",
        category: "package-health",
        recommended: true,
        priority: "baseline",
        actionable: true,
        reason: `${evidence}, but TypeScript consumer resolution is not actively checked. Are The Types Wrong? tests the locally packed package in the ways Node and bundlers resolve TypeScript types.`,
      });
    }
  }

  const addMissing = (
    provider: string,
    name: string,
    category: HealthCategory,
    priority: Recommendation["priority"],
    actionable: boolean,
    reason: string,
  ) => {
    const coverageEntry = byCategory.get(category)!;
    const detection = detections.get(provider);
    if (
      coverageEntry.status === "off" ||
      coverageEntry.status === "not-applicable" ||
      detection?.activeCapabilities[REQUIREMENTS[category][0]!] ||
      !providerEnabled(provider)
    ) return;
    recommendations.push({ provider, name, category, recommended: true, priority, actionable, reason });
  };

  if (context.kinds.includes("react") || context.kinds.includes("nextjs")) {
    addMissing("jsx-a11y", "eslint-plugin-jsx-a11y", "accessibility", "baseline", false, "This UI repository uses JSX, but no active accessibility rules were detected. Enable jsx-a11y’s recommended rules in the existing ESLint configuration.");
  }
  if (context.isMonorepo) {
    addMissing("syncpack", "syncpack", "monorepo", "baseline", true, "This repository contains multiple workspaces, but dependency versions and package metadata are not being checked for consistency.");
  }
  if (isApplicable("coverage", context)) {
    addMissing("c8", "c8", "coverage", "baseline", false, "Tests are present, but no coverage command is active. Add a project-specific coverage command and threshold rather than treating raw line counts as a universal quality score.");
    addMissing("stryker", "Stryker", "coverage", "advanced", false, "Mutation testing measures whether tests catch behavior changes. It requires a test-specific configuration and can be expensive, so it is an advanced recommendation.");
  }
  addMissing("gitleaks", "Gitleaks", "secrets", "baseline", false, "No secret scanner is active. Gitleaks can detect credentials before they reach the repository or CI artifacts.");
  addMissing("license-checker", "license-checker", "licenses", "optional", true, "Dependencies are present, but no license report is active. Add an allow/deny policy before making license violations fail CI.");
  addMissing("markdownlint", "markdownlint", "documentation", "optional", true, "Markdown documentation is present, but no documentation style check is active.");
  if (isApplicable("performance", context)) {
    addMissing("lhci", "Lighthouse CI", "performance", "optional", false, "This repository ships frontend or package output, but no runtime performance budget is active. Configure Lighthouse CI against a real URL or build.");
  }
  if (isApplicable("release", context)) {
    addMissing("changesets", "Changesets", "release", "optional", false, "This repository appears publishable or multi-package, but release metadata is not being checked. Changesets can make version and changelog intent explicit.");
  }
  addMissing("actionlint", "actionlint", "ci", "optional", false, "GitHub Actions workflows are present, but their syntax and common automation mistakes are not being checked.");

  return { context, detections, coverage, recommendations };
}
