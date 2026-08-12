import type { HealthCategory } from "../core/health-category.js";
import type {
  ProviderDetection,
  ProviderRecommendation,
  RepositoryContext,
} from "../core/types.js";
import { categoryModeFor, type RepnixConfig } from "../config/repo-health-config.js";
import { createBuiltinRegistry, type ProviderRegistry } from "../providers/registry.js";
import { categoryDefinition, type Capability } from "../core/category-registry.js";
import { HEALTH_CATEGORIES } from "../core/health-category.js";

export type CoverageStatus = "covered" | "partial" | "missing" | "not-applicable" | "off";

export interface CategoryCoverage {
  category: HealthCategory;
  status: CoverageStatus;
  providers: string[];
  capabilities: Capability[];
  missingCapabilities: Capability[];
  scopes: string[];
  evidence: string[];
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

function requirementsFor(category: HealthCategory, context: RepositoryContext, registry: ProviderRegistry): Capability[] {
  if (category === "package-health" && hasPublishedTypes(context)) {
    return ["packagePublishing", "typesCompatibility"];
  }
  return categoryDefinition(category, registry.categoryRegistry).requiredCapabilities;
}

export interface AuditModel {
  context: RepositoryContext;
  detections: Map<string, ProviderDetection>;
  coverage: CategoryCoverage[];
  recommendations: Recommendation[];
  registry?: ProviderRegistry;
}

function isApplicable(category: HealthCategory, context: RepositoryContext, registry: ProviderRegistry): boolean {
  return categoryDefinition(category, registry.categoryRegistry).applicable(context).applicable;
}

function coverageFor(
  category: HealthCategory,
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
  config: RepnixConfig,
  registry: ProviderRegistry,
): CategoryCoverage {
  const applicability = categoryDefinition(category, registry.categoryRegistry).applicable(context);
  const enabledScopes = applicability.scopes.filter((scope) => categoryModeFor(config, category, scope) !== "off");
  if (categoryModeFor(config, category) === "off" || (applicability.applicable && enabledScopes.length === 0)) {
    return { category, status: "off", providers: [], capabilities: [], missingCapabilities: [], scopes: applicability.scopes, evidence: ["disabled in repnix.config.json"] };
  }
  if (!applicability.applicable) {
    return { category, status: "not-applicable", providers: [], capabilities: [], missingCapabilities: [], scopes: [], evidence: [] };
  }
  const required = requirementsFor(category, context, registry);
  if (required.length === 0) {
    return {
      category,
      status: "missing",
      providers: [],
      capabilities: [],
      missingCapabilities: [],
      scopes: enabledScopes,
      evidence: applicability.evidence,
      reason: "No installable provider is available for this category in the MVP.",
    };
  }
  const providers: string[] = [];
  const active = new Set<Capability>();
  for (const descriptor of registry.providers) {
    const detection = detections.get(descriptor.id);
    if (!detection) continue;
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
    scopes: enabledScopes,
    evidence: applicability.evidence,
  };
}

export function buildAuditModel(
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
  config: RepnixConfig,
  registry: ProviderRegistry = createBuiltinRegistry(),
): AuditModel {
  const categories = [...new Set([...HEALTH_CATEGORIES, ...registry.categories.map((category) => category.id)])];
  const coverage = categories.map((category) => coverageFor(category, context, detections, config, registry));
  const byCategory = new Map(coverage.map((entry) => [entry.category, entry]));
  const recommendations: Recommendation[] = [];
  const providerEnabled = (_id: string) => true;

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
      detection?.activeCapabilities[categoryDefinition(category).requiredCapabilities[0]!] ||
      !providerEnabled(provider)
    ) return;
    recommendations.push({ provider, name, category, recommended: true, priority, actionable, reason });
  };

  if (isApplicable("accessibility", context, registry)) {
    addMissing("jsx-a11y", "eslint-plugin-jsx-a11y", "accessibility", "baseline", false, "This UI repository uses JSX, but no active accessibility rules were detected. Enable jsx-a11y’s recommended rules in the existing ESLint configuration.");
  }
  if (context.isMonorepo) {
    addMissing("syncpack", "syncpack", "monorepo", "baseline", true, "This repository contains multiple workspaces, but dependency versions and package metadata are not being checked for consistency.");
  }
  if (isApplicable("coverage", context, registry)) {
    addMissing("c8", "c8", "coverage", "baseline", false, "Tests are present, but no coverage command is active. Add a project-specific coverage command and threshold rather than treating raw line counts as a universal quality score.");
    addMissing("stryker", "Stryker", "coverage", "advanced", false, "Mutation testing measures whether tests catch behavior changes. It requires a test-specific configuration and can be expensive, so it is an advanced recommendation.");
  }
  addMissing("gitleaks", "Gitleaks", "secrets", "baseline", false, "No secret scanner is active. Gitleaks can detect credentials before they reach the repository or CI artifacts.");
  addMissing("license-checker", "license-checker", "licenses", "optional", true, "Dependencies are present, but no license report is active. Add an allow/deny policy before making license violations fail CI.");
  addMissing("markdownlint", "markdownlint", "documentation", "optional", true, "Markdown documentation is present, but no documentation style check is active.");
  if (isApplicable("performance", context, registry)) {
    addMissing("lhci", "Lighthouse CI", "performance", "optional", false, "This repository ships frontend or package output, but no runtime performance budget is active. Configure Lighthouse CI against a real URL or build.");
  }
  if (isApplicable("release", context, registry)) {
    addMissing("changesets", "Changesets", "release", "optional", false, "This repository appears publishable or multi-package, but release metadata is not being checked. Changesets can make version and changelog intent explicit.");
  }
  addMissing("actionlint", "actionlint", "ci", "optional", false, "GitHub Actions workflows are present, but their syntax and common automation mistakes are not being checked.");

  for (const provider of registry.providers) {
    if (!provider.recommend || recommendations.some((recommendation) => recommendation.provider === provider.id)) continue;
    const recommendation = provider.recommend(context);
    if (!recommendation) continue;
    recommendations.push({ provider: provider.id, name: provider.name, category: provider.category, ...recommendation });
  }

  return { context, detections, coverage, recommendations, registry };
}
