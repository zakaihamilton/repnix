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
  "dead-code": ["unusedFiles", "unusedExports", "unusedDependencies"],
  duplication: ["duplication"],
  security: ["vulnerabilities"],
  architecture: ["architectureRules"],
  bundle: ["bundleBudget"],
  accessibility: [],
  monorepo: [],
  "package-health": [],
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
  provider: "knip" | "jscpd" | "osv-scanner" | "eslint-boundaries" | "dependency-cruiser" | "size-limit";
  name: string;
  category: HealthCategory;
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
  const required = REQUIREMENTS[category];
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

  const deadCode = byCategory.get("dead-code")!;
  const knip = detections.get("knip")!;
  if (
    deadCode.status !== "covered" &&
    deadCode.status !== "off" &&
    context.sourceFiles.length > 0 &&
    !knip.installed &&
    config.providers?.knip?.enabled !== false
  ) {
    recommendations.push({
      provider: "knip",
      name: "Knip",
      category: "dead-code",
      recommended: true,
      priority: "baseline",
      actionable: true,
      reason: `${context.sourceFiles.length} JavaScript/TypeScript source file${context.sourceFiles.length === 1 ? "" : "s"} were found, but unused files, exports, and dependencies are not fully covered. Knip fills those gaps without replacing existing linting.`,
    });
  }

  const duplication = byCategory.get("duplication")!;
  const jscpd = detections.get("jscpd")!;
  if (
    duplication.status !== "covered" &&
    duplication.status !== "off" &&
    context.sourceFiles.length >= 2 &&
    !jscpd.installed &&
    config.providers?.jscpd?.enabled !== false
  ) {
    recommendations.push({
      provider: "jscpd",
      name: "jscpd",
      category: "duplication",
      recommended: true,
      priority: "baseline",
      actionable: true,
      reason: `${context.sourceFiles.length} source files can accumulate copy/paste drift, and no duplication provider is active. jscpd adds focused duplication detection without overlapping lint or dead-code analysis.`,
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
    config.providers?.["osv-scanner"]?.enabled !== false
  ) {
    recommendations.push({
      provider: "osv-scanner",
      name: "OSV-Scanner",
      category: "security",
      recommended: true,
      priority: "baseline",
      actionable: false,
      reason: `${lockfiles.join(", ")} provides a dependency inventory, but no offline vulnerability scan is active. OSV-Scanner protects dependencies using the OSV advisory database; install its platform binary and cache its offline database before checks.`,
    });
  }

  const architecture = byCategory.get("architecture")!;
  if (architecture.status !== "covered" && architecture.status !== "off" && context.sourceFiles.length >= 2) {
    const eslintActive = detections.get("eslint")?.activeCapabilities.linting === true;
    const boundaries = detections.get("eslint-boundaries")!;
    const cruiser = detections.get("dependency-cruiser")!;
    if (eslintActive && !boundaries.activeCapabilities.architectureRules && config.providers?.["eslint-boundaries"]?.enabled !== false) {
      recommendations.push({
        provider: "eslint-boundaries",
        name: "eslint-plugin-boundaries",
        category: "architecture",
        recommended: true,
        priority: "optional",
        actionable: false,
        reason: "ESLint is already active, so eslint-plugin-boundaries is the smallest non-overlapping architecture option. Its element types and dependency rules are repository-specific and must be configured intentionally.",
      });
    } else if (!eslintActive && !cruiser.activeCapabilities.architectureRules && config.providers?.["dependency-cruiser"]?.enabled !== false) {
      recommendations.push({
        provider: "dependency-cruiser",
        name: "dependency-cruiser",
        category: "architecture",
        recommended: true,
        priority: "optional",
        actionable: true,
        reason: "No ESLint architecture rules are active. dependency-cruiser adds standalone cycle protection and a conservative source-to-test boundary without overlapping linting.",
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
    config.providers?.["size-limit"]?.enabled !== false
  ) {
    recommendations.push({
      provider: "size-limit",
      name: "Size Limit",
      category: "bundle",
      recommended: true,
      priority: "optional",
      actionable: false,
      reason: "This frontend or publishable package can regress in shipped JavaScript size. Size Limit is appropriate once a real build artifact and an explicit budget are chosen; RepNix will not invent that budget.",
    });
  }

  return { context, detections, coverage, recommendations };
}
