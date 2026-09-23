import { HEALTH_CATEGORIES, type HealthCategory } from "../core/health-category.js";
import type { ProviderDetection, ProviderRecommendation, RepositoryContext } from "../core/types.js";
import { categoryModeFor, type RepnixConfig } from "../config/repo-health-config.js";
import { createBuiltinRegistry, type ProviderRegistry } from "../providers/registry.js";
import { hasPublishedTypes, scopePublishesTypes } from "../providers/recommend.js";
import type { ProviderModule } from "../providers/sdk.js";
import { categoryDefinition, type Capability } from "../core/category-registry.js";
import { workspaceCheckScript } from "../repository/workspace-checks.js";

export type CoverageStatus = "covered" | "partial" | "missing" | "not-applicable" | "off";

export interface CategoryCoverage {
  category: HealthCategory;
  status: CoverageStatus;
  providers: string[];
  capabilities: Capability[];
  missingCapabilities: Capability[];
  scopes: string[];
  scopeStatuses?: Record<string, CoverageStatus>;
  missingScopes?: string[];
  evidence: string[];
  reason?: string;
}

function statusesByScope(scopes: string[], status: CoverageStatus): Record<string, CoverageStatus> {
  const entries: Array<[string, CoverageStatus]> = scopes.map((scope) => [scope, status]);
  return Object.fromEntries(entries);
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
  scopePath?: string,
): Capability[] {
  const scope = scopePath === undefined ? undefined : context.scopes.find((candidate) => candidate.path === scopePath);
  if (
    category === "package-health" &&
    (scope ? scopePublishesTypes(scope) : hasPublishedTypes(context))
  ) {
    return ["packagePublishing", "typesCompatibility"];
  }
  return categoryDefinition(category, registry.categoryRegistry).requiredCapabilities;
}

function workspaceScriptCoverage(
  category: HealthCategory,
  scopePath: string,
  context: RepositoryContext,
  registry: ProviderRegistry,
): { capabilities: Capability[]; providers: string[] } {
  const scope = context.scopes.find((candidate) => candidate.path === scopePath);
  if (!scope) return { capabilities: [], providers: [] };
  const match = workspaceCheckScript(category, scope.packageJson.scripts ?? {}, registry.providers);
  if (!match) return { capabilities: [], providers: [] };

  const required = categoryDefinition(category, registry.categoryRegistry).requiredCapabilities;
  const capabilities = new Set<Capability>();
  const providers = new Set<string>();
  if (match.generic) {
    required.forEach((capability) => capabilities.add(capability));
    if (match.providers.length) match.providers.forEach((provider) => providers.add(provider.name));
    else providers.add("Workspace check script");
  } else {
    for (const provider of match.providers) {
      for (const capability of required) {
        if (provider.capabilities[capability]) {
          capabilities.add(capability);
          providers.add(provider.name);
        }
      }
    }
  }
  return { capabilities: [...capabilities], providers: [...providers] };
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
  if (
    enabledScopes.length === 0 &&
    (categoryModeFor(config, category) === "off" || applicability.applicable)
  ) {
    return {
      category,
      status: "off",
      providers: [],
      capabilities: [],
      missingCapabilities: [],
      scopes: applicability.scopes,
      scopeStatuses: statusesByScope(applicability.scopes, "off"),
      missingScopes: [],
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
      scopeStatuses: {},
      missingScopes: [],
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
      scopeStatuses: statusesByScope(enabledScopes, "missing"),
      missingScopes: enabledScopes,
      evidence: applicability.evidence,
      reason: "No installable provider is available for this category in the MVP.",
    };
  }
  const providers = new Set<string>();
  const active = new Set<Capability>();
  const missing = new Set<Capability>();
  const scopeStatuses: Record<string, CoverageStatus> = {};
  for (const scope of enabledScopes) {
    const scopedRequired = requirementsFor(category, context, registry, scope);
    const scopedRequirement = categoryModeFor(config, category, scope) === "required";
    const scopeActive = new Set<Capability>();
    if (scope !== ".") {
      const scopedCoverage = workspaceScriptCoverage(category, scope, context, registry);
      scopedCoverage.capabilities.forEach((capability) => {
        scopeActive.add(capability);
      });
      scopedCoverage.providers.forEach((provider) => providers.add(provider));
    }
    for (const descriptor of registry.providers) {
      const detection = detections.get(descriptor.id);
      if (scopedRequirement && scope !== "." && category !== "package-health") continue;
      const matching = scopedRequired.filter((capability) => detection?.activeCapabilities[capability]);
      if (matching.length > 0) {
        providers.add(descriptor.name);
        matching.forEach((capability) => scopeActive.add(capability));
      }
    }
    scopeActive.forEach((capability) => active.add(capability));
    const missingForScope = scopedRequired.filter((capability) => !scopeActive.has(capability));
    missingForScope.forEach((capability) => missing.add(capability));
    scopeStatuses[scope] = missingForScope.length === 0 ? "covered" : scopeActive.size > 0 ? "partial" : "missing";
  }
  const missingCapabilities = [...missing];
  const missingScopes = enabledScopes.filter((scope) => scopeStatuses[scope] !== "covered");
  return {
    category,
    status: missingScopes.length === 0 ? "covered" : active.size > 0 ? "partial" : "missing",
    providers: [...providers],
    capabilities: [...active],
    missingCapabilities,
    scopes: enabledScopes,
    scopeStatuses,
    missingScopes,
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
