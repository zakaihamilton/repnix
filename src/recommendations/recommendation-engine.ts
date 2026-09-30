import { HEALTH_CATEGORIES, type HealthCategory } from "../core/health-category.js";
import type { ProviderDetection, ProviderRecommendation, RepositoryContext } from "../core/types.js";
import { categoryModeFor, type RepnixConfig } from "../config/repo-health-config.js";
import { createBuiltinRegistry, type ProviderRegistry } from "../providers/registry.js";
import { hasPublishedTypes } from "../providers/recommend.js";
import type { ProviderModule } from "../providers/sdk.js";
import { categoryDefinition, type Capability } from "../core/category-registry.js";
import { QUALITY_SCRIPT_CHECKS, safeScriptFrom } from "../repository/quality-scripts.js";

export type CoverageStatus = "covered" | "partial" | "missing" | "not-applicable" | "off";

export interface ScopeCoverage {
  scope: string;
  status: CoverageStatus;
  providers: string[];
  capabilities: Capability[];
  missingCapabilities: Capability[];
}

export interface CategoryCoverage {
  category: HealthCategory;
  status: CoverageStatus;
  providers: string[];
  capabilities: Capability[];
  missingCapabilities: Capability[];
  scopes: string[];
  evidence: string[];
  reason?: string;
  /** Package quality commands are attributed to the scope where they run. */
  scopeCoverage?: ScopeCoverage[];
}

export interface Recommendation extends ProviderRecommendation {
  provider: string;
  name: string;
  category: HealthCategory;
}

function requirementsFor(
  category: HealthCategory,
  context: RepositoryContext,
  registry: ProviderRegistry,
): Capability[] {
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

function coverageFor(
  category: HealthCategory,
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
  config: RepnixConfig,
  registry: ProviderRegistry,
): CategoryCoverage {
  const applicability = categoryDefinition(category, registry.categoryRegistry).applicable(context);
  const enabledScopes = applicability.scopes.filter((scope) => categoryModeFor(config, category, scope) !== "off");
  if (enabledScopes.length === 0 && (applicability.applicable || categoryModeFor(config, category) === "off")) {
    return {
      category,
      status: "off",
      providers: [],
      capabilities: [],
      missingCapabilities: [],
      scopes: applicability.scopes,
      evidence: ["disabled in repnix.config.json"],
    };
  }
  if (!applicability.applicable) {
    return {
      category,
      status: "not-applicable",
      providers: [],
      capabilities: [],
      missingCapabilities: [],
      scopes: [],
      evidence: [],
    };
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
  const check = QUALITY_SCRIPT_CHECKS.find((entry) => entry.category === category);
  if (check && context.isMonorepo) {
    const scopeCoverage: ScopeCoverage[] = applicability.scopes.map((scope) => {
      const repositoryScope = context.scopes.find((entry) => entry.path === scope);
      const scripts = repositoryScope?.packageJson.scripts ?? {};
      const script = safeScriptFrom(scripts, check.names, check.kind);
      const capabilities = script ? required : scope === "." ? [...active] : [];
      const scopeMissing = required.filter((capability) => !capabilities.includes(capability));
      // Root inventories include workspace files. An otherwise empty container
      // does not need a duplicate command when its workspaces have their own checks.
      const hasOwnSource = (repositoryScope?.productionSourceFiles ?? repositoryScope?.sourceFiles ?? []).some(
        (file) =>
          !context.scopes.some(
            (child) => child.path !== scope && child.path !== "." && file.startsWith(`${child.path}/`),
          ),
      );
      return {
        scope,
        status:
          categoryModeFor(config, category, scope) === "off"
            ? "off"
            : !hasOwnSource && !script && capabilities.length === 0
              ? "not-applicable"
              : scopeMissing.length === 0
                ? "covered"
                : capabilities.length > 0
                  ? "partial"
                  : "missing",
        providers: script
          ? [scope === "." ? `script:${script}` : `${scope} ${script}`]
          : scope === "."
            ? providers
            : [],
        capabilities,
        missingCapabilities: scopeMissing,
      };
    });
    const enabled = scopeCoverage.filter((entry) => entry.status !== "off" && entry.status !== "not-applicable");
    const allCovered = enabled.every((entry) => entry.status === "covered");
    return {
      category,
      status:
        enabled.length === 0
          ? "off"
          : allCovered
            ? "covered"
            : enabled.some((entry) => entry.capabilities.length > 0)
              ? "partial"
              : "missing",
      providers: [...new Set(enabled.flatMap((entry) => entry.providers))],
      capabilities: [...new Set(enabled.flatMap((entry) => entry.capabilities))],
      missingCapabilities: [...new Set(enabled.flatMap((entry) => entry.missingCapabilities))],
      scopes: enabled.map((entry) => entry.scope),
      evidence: applicability.evidence,
      scopeCoverage,
    };
  }
  return {
    category,
    status: missingCapabilities.length === 0 ? "covered" : active.size > 0 ? "partial" : "missing",
    providers,
    capabilities: [...active],
    missingCapabilities,
    scopes: enabledScopes,
    evidence: applicability.evidence,
  };
}

function alreadyContributing(
  provider: ProviderModule,
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
  registry: ProviderRegistry,
): boolean {
  const required = requirementsFor(provider.category, context, registry);
  const detection = detections.get(provider.id);
  return required.some((capability) => detection?.activeCapabilities[capability]);
}

function buildRecommendations(
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
  coverage: CategoryCoverage[],
  registry: ProviderRegistry,
): Recommendation[] {
  const byCategory = new Map(coverage.map((entry) => [entry.category, entry]));
  const ranked = registry.providers
    .map((provider, index) => ({ provider, index, order: provider.recommendOrder ?? 10_000 + index }))
    .sort((left, right) => left.order - right.order || left.index - right.index);
  const recommendations: Recommendation[] = [];
  for (const { provider } of ranked) {
    if (!provider.recommend) continue;
    const coverageEntry = byCategory.get(provider.category);
    if (!coverageEntry || coverageEntry.status === "off" || coverageEntry.status === "not-applicable") continue;
    if (alreadyContributing(provider, context, detections, registry)) continue;
    const recommendation = provider.recommend(context, { detections, coverageStatus: coverageEntry.status });
    if (!recommendation?.recommended) continue;
    recommendations.push({
      provider: provider.id,
      name: provider.name,
      category: provider.category,
      ...recommendation,
    });
  }
  return recommendations;
}

export function buildAuditModel(
  context: RepositoryContext,
  detections: Map<string, ProviderDetection>,
  config: RepnixConfig,
  registry: ProviderRegistry = createBuiltinRegistry(),
): AuditModel {
  const categories = [...new Set([...HEALTH_CATEGORIES, ...registry.categories.map((category) => category.id)])];
  const coverage = categories.map((category) => coverageFor(category, context, detections, config, registry));
  return {
    context,
    detections,
    coverage,
    recommendations: buildRecommendations(context, detections, coverage, registry),
    registry,
  };
}
