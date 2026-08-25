import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, type HealthCategory } from "./health-category.js";
import type { ProviderCapabilities, RepositoryContext } from "./types.js";
import type { CategoryModule } from "../providers/sdk.js";

export type Capability = keyof ProviderCapabilities;

export interface CategoryApplicability {
  applicable: boolean;
  scopes: string[];
  evidence: string[];
}

export interface CategoryDefinition extends CategoryModule {
  id: HealthCategory;
}

function matchingScopes(
  context: RepositoryContext,
  predicate: (scope: RepositoryContext["scopes"][number]) => boolean,
  evidence: (scope: RepositoryContext["scopes"][number]) => string,
): CategoryApplicability {
  const scopes = context.scopes.filter(predicate);
  return { applicable: scopes.length > 0, scopes: scopes.map((scope) => scope.path), evidence: scopes.map(evidence) };
}

function sourceScopes(context: RepositoryContext): CategoryApplicability {
  return matchingScopes(
    context,
    (scope) => (scope.productionSourceFiles ?? scope.sourceFiles).length > 0,
    (scope) => `${scope.path} contains production source files`,
  );
}

const builtinDefinitions: Omit<CategoryDefinition, "label" | "description">[] = [
  {
    id: "types",
    requiredCapabilities: ["typeChecking"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) => scope.languages.includes("TypeScript"),
        (scope) => `${scope.path} contains TypeScript`,
      ),
  },
  { id: "lint", requiredCapabilities: ["linting"], applicable: sourceScopes },
  { id: "format", requiredCapabilities: ["formatting"], applicable: sourceScopes },
  { id: "tests", requiredCapabilities: ["testing"], applicable: sourceScopes },
  {
    id: "coverage",
    requiredCapabilities: ["testCoverage"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) =>
          (scope.productionSourceFiles ?? scope.sourceFiles).length > 0 &&
          Object.keys(scope.packageJson.scripts ?? {}).some((name) => /^(test|test:run|check:test)/.test(name)),
        (scope) => `${scope.path} has source and a test command`,
      ),
  },
  {
    id: "dead-code",
    requiredCapabilities: ["unusedFiles", "unusedExports", "unusedDependencies"],
    applicable: sourceScopes,
  },
  {
    id: "duplication",
    requiredCapabilities: ["duplication"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) => (scope.productionSourceFiles ?? scope.sourceFiles).length >= 2,
        (scope) => `${scope.path} contains multiple production source files`,
      ),
  },
  { id: "security", requiredCapabilities: ["vulnerabilities"], applicable: sourceScopes },
  {
    id: "architecture",
    requiredCapabilities: ["architectureRules"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) => (scope.productionSourceFiles ?? scope.sourceFiles).length > 0 && scope.sourceFiles.length >= 2,
        (scope) => `${scope.path} contains a module graph`,
      ),
  },
  {
    id: "bundle",
    requiredCapabilities: ["bundleBudget"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) => scope.roles.includes("web-app"),
        (scope) => `${scope.path} is a web application`,
      ),
  },
  {
    id: "accessibility",
    requiredCapabilities: ["accessibilityRules"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) =>
          scope.roles.includes("web-app") &&
          (scope.productionSourceFiles ?? scope.sourceFiles).some((file) => /\.[jt]sx$/.test(file)),
        (scope) => `${scope.path} is a JSX/TSX web application`,
      ),
  },
  {
    id: "monorepo",
    requiredCapabilities: ["workspaceConsistency"],
    applicable: (context) => ({
      applicable: context.isMonorepo,
      scopes: context.isMonorepo ? context.scopes.map((scope) => scope.path) : [],
      evidence: context.isMonorepo ? [`${context.packageCount} package scopes detected`] : [],
    }),
  },
  {
    id: "secrets",
    requiredCapabilities: ["secrets"],
    applicable: (context) => ({
      applicable: context.files.size > 0,
      scopes: ["."],
      evidence: ["repository files can contain credentials"],
    }),
  },
  {
    id: "licenses",
    requiredCapabilities: ["licenses"],
    applicable: (context) => ({
      applicable: context.installedPackages.size > 0,
      scopes: ["."],
      evidence: [`${context.installedPackages.size} declared dependencies detected`],
    }),
  },
  {
    id: "documentation",
    requiredCapabilities: ["documentation"],
    applicable: (context) => ({
      applicable: [...context.files].some((file) => /\.md$/i.test(file)),
      scopes: ["."],
      evidence: ["Markdown documentation detected"],
    }),
  },
  {
    id: "performance",
    requiredCapabilities: ["performance"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) => scope.roles.includes("web-app"),
        (scope) => `${scope.path} is a web application`,
      ),
  },
  {
    id: "release",
    requiredCapabilities: ["release"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) => scope.roles.includes("library"),
        (scope) => `${scope.path} is a published library`,
      ),
  },
  {
    id: "ci",
    requiredCapabilities: ["ciWorkflow"],
    applicable: (context) => ({
      applicable: context.hasCI,
      scopes: context.hasCI ? ["."] : [],
      evidence: context.hasCI ? ["GitHub Actions workflows detected"] : [],
    }),
  },
  {
    id: "package-health",
    requiredCapabilities: ["packagePublishing"],
    applicable: (context) =>
      matchingScopes(
        context,
        (scope) => scope.roles.includes("library"),
        (scope) => `${scope.path} is a published library`,
      ),
  },
];

export const BUILTIN_CATEGORY_DEFINITIONS: CategoryDefinition[] = builtinDefinitions.map((definition) => ({
  ...definition,
  label: CATEGORY_LABELS[definition.id] ?? definition.id,
  description: CATEGORY_DESCRIPTIONS[definition.id] ?? `Checks the repository's ${definition.id} health category.`,
}));

export function createCategoryRegistry(extra: CategoryDefinition[] = []): Map<string, CategoryDefinition> {
  const definitions = [...BUILTIN_CATEGORY_DEFINITIONS, ...extra];
  const duplicate = definitions.find(
    (definition, index) => definitions.findIndex((candidate) => candidate.id === definition.id) !== index,
  );
  if (duplicate) throw new Error(`Duplicate category id '${duplicate.id}' was registered.`);
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

export const CATEGORY_REGISTRY = createCategoryRegistry();

export function categoryDefinition(
  category: HealthCategory,
  registry: Map<string, CategoryDefinition> = CATEGORY_REGISTRY,
): CategoryDefinition {
  const definition = registry.get(category);
  if (!definition) throw new Error(`Unknown health category '${category}'.`);
  return definition;
}
