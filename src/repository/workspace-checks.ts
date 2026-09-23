import type { HealthCategory } from "../core/health-category.js";
import type { ProviderModule } from "../providers/sdk.js";
import { isNonMutatingQualityCommand, isNonMutatingTestCommand, matchesScriptPattern } from "./script-detection.js";

const WORKSPACE_SCOPED_CATEGORIES: HealthCategory[] = [
  "types",
  "lint",
  "format",
  "tests",
  "coverage",
  "dead-code",
  "duplication",
  "architecture",
  "bundle",
  "accessibility",
  "performance",
];

const SCRIPT_NAMES: Partial<Record<HealthCategory, string[]>> = {
  types: ["typecheck", "type-check", "check:types"],
  lint: ["lint", "check:lint", "lint:check"],
  format: ["format:check", "check:format", "format-check"],
  tests: ["test", "test:run", "check:test"],
  coverage: ["coverage", "test:coverage", "check:coverage"],
  "dead-code": ["knip"],
  duplication: ["jscpd"],
  architecture: ["architecture", "depcruise", "dependency-cruiser"],
  bundle: ["size", "size-limit", "check:size"],
  accessibility: ["a11y", "check:a11y"],
  performance: ["performance", "lhci"],
};

export interface WorkspaceCheckScript {
  name: string;
  command: string;
  generic: boolean;
  providers: ProviderModule[];
}

export function workspaceCheckCategories(providers: readonly ProviderModule[]): HealthCategory[] {
  return WORKSPACE_SCOPED_CATEGORIES.filter((category) =>
    providers.some((provider) => provider.category === category) ||
      ["types", "lint", "format", "tests"].includes(category),
  );
}

export function workspaceCheckScript(
  category: HealthCategory,
  scripts: Record<string, string>,
  providers: readonly ProviderModule[],
): WorkspaceCheckScript | null {
  if (!WORKSPACE_SCOPED_CATEGORIES.includes(category)) return null;
  const categoryProviders = providers.filter((provider) => provider.category === category);
  const genericName = `health:${category}`;
  const namedProviders = categoryProviders.flatMap((provider) => [
    ...(provider.scriptNames ?? []),
    ...(provider.setup ? [provider.setup.scriptName] : []),
  ]);
  const names = [...new Set([genericName, ...(SCRIPT_NAMES[category] ?? []), ...namedProviders])];
  const isTest = category === "tests";
  for (const name of names) {
    const command = scripts[name];
    if (!command || (isTest ? !isNonMutatingTestCommand(command) : !isNonMutatingQualityCommand(command))) continue;
    if (name === genericName) return { name, command, generic: true, providers: [] };
    if (isTest && SCRIPT_NAMES.tests?.includes(name))
      return {
        name,
        command,
        generic: true,
        providers: categoryProviders.filter((provider) => provider.id === "test-script"),
      };
    const matched = categoryProviders.filter(
      (provider) =>
        ((SCRIPT_NAMES[category] ?? []).includes(name) ||
          (provider.scriptNames ?? []).includes(name) ||
          provider.setup?.scriptName === name) &&
        matchesScriptPattern(command, provider.scriptPattern),
    );
    if (matched.length) return { name, command, generic: false, providers: matched };
  }
  return null;
}
