import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROVIDER_DESCRIPTIONS, PROVIDER_NEXT_STEPS } from "../core/health-category.js";
import { BUILTIN_CATEGORY_DEFINITIONS, createCategoryRegistry, type CategoryDefinition } from "../core/category-registry.js";
import { PROVIDERS } from "./catalog.js";
import type { RepositoryContext } from "../core/types.js";
import { definePlugin, PROVIDER_API_VERSION, type CategoryModule, type ProviderModule, type RepnixProviderPlugin } from "./sdk.js";

export type ProviderSupport = "detectable" | "runnable" | "installable";

export interface BuiltinProviderDefinition extends ProviderModule {
  description: string;
  documentationUrl?: string;
  nextStep?: string;
  support: ProviderSupport[];
}

export const INSTALLABLE_PROVIDER_IDS = ["knip", "jscpd", "dependency-cruiser", "publint", "attw", "syncpack", "license-checker", "markdownlint"] as const;
export type SetupProviderId = (typeof INSTALLABLE_PROVIDER_IDS)[number];

const INSTALLABLE = new Set<string>(INSTALLABLE_PROVIDER_IDS);
const DOCUMENTATION: Record<string, string> = {
  typescript: "https://www.typescriptlang.org/docs/", eslint: "https://eslint.org/docs/latest/", biome: "https://biomejs.dev/guides/getting-started/",
  vitest: "https://vitest.dev/guide/", jest: "https://jestjs.io/docs/getting-started", knip: "https://knip.dev/", jscpd: "https://github.com/kucherenko/jscpd",
  "osv-scanner": "https://google.github.io/osv-scanner/", "dependency-cruiser": "https://github.com/sverweij/dependency-cruiser", "size-limit": "https://github.com/ai/size-limit",
  publint: "https://publint.dev/", attw: "https://github.com/arethetypeswrong/arethetypeswrong.github.io",
};
const quoteScriptArg = (value: string) => /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
const SETUP: Record<SetupProviderId, NonNullable<BuiltinProviderDefinition["setup"]>> = {
  knip: { packageName: "knip", scriptName: "health:dead-code", scriptCommand: () => "knip", checks: ["Unused files, exports, and dependencies not reachable from project entry points."] },
  jscpd: { packageName: "jscpd", scriptName: "health:duplication", scriptCommand: (context) => `jscpd ${context.sourceRoots.map(quoteScriptArg).join(" ")}`, checks: ["Repeated code blocks across detected source roots."] },
  "dependency-cruiser": { packageName: "dependency-cruiser", scriptName: "health:architecture", scriptCommand: (context) => `depcruise --output-type json --config -- ${context.sourceRoots.map(quoteScriptArg).join(" ")}`, checks: ["Circular dependencies and configured module-boundary violations."] },
  publint: { packageName: "publint", scriptName: "health:package:publint", scriptCommand: () => "publint", checks: ["Published package exports, entry points, metadata, and files."] },
  attw: { packageName: "@arethetypeswrong/cli", scriptName: "health:package:types", scriptCommand: () => "attw --pack .", checks: ["TypeScript consumer resolution across Node and bundler modes."] },
  syncpack: { packageName: "syncpack", scriptName: "health:monorepo", scriptCommand: () => "syncpack list-mismatches", checks: ["Dependency version and package metadata consistency across workspaces."] },
  "license-checker": { packageName: "license-checker", scriptName: "health:licenses", scriptCommand: () => "license-checker --json", checks: ["Declared dependency licenses against repository policy."] },
  markdownlint: { packageName: "markdownlint-cli2", scriptName: "health:documentation", scriptCommand: () => "markdownlint-cli2 \"**/*.md\"", checks: ["Markdown structure and style consistency."] },
};

export const BUILTIN_PROVIDERS: BuiltinProviderDefinition[] = PROVIDERS.map((descriptor) => {
  const nextStep = PROVIDER_NEXT_STEPS[descriptor.name];
  const setup = INSTALLABLE.has(descriptor.id) ? SETUP[descriptor.id as SetupProviderId] : undefined;
  const documentationUrl = DOCUMENTATION[descriptor.id];
  return {
    ...descriptor,
    description: PROVIDER_DESCRIPTIONS[descriptor.name] ?? `Runs ${descriptor.name} as a repository health check.`,
    ...(documentationUrl ? { documentationUrl } : {}),
    ...(nextStep ? { nextStep } : {}),
    ...(setup ? { setup } : {}),
    support: ["detectable", ...(descriptor.command || descriptor.runnable ? ["runnable" as const] : []), ...(INSTALLABLE.has(descriptor.id) ? ["installable" as const] : [])],
  };
});

const builtinCategories: CategoryModule[] = BUILTIN_CATEGORY_DEFINITIONS;

export class ProviderRegistry {
  readonly providers: ProviderModule[];
  readonly categories: CategoryModule[];
  readonly categoryRegistry: Map<string, CategoryDefinition>;
  private readonly byId: Map<string, ProviderModule>;

  constructor(providers: ProviderModule[], categories: CategoryModule[] = []) {
    const duplicateProvider = providers.find((provider, index) => providers.findIndex((candidate) => candidate.id === provider.id) !== index);
    if (duplicateProvider) throw new Error(`Duplicate provider id '${duplicateProvider.id}' was registered.`);
    const duplicateCategory = categories.find((category, index) => categories.findIndex((candidate) => candidate.id === category.id) !== index);
    if (duplicateCategory) throw new Error(`Duplicate category id '${duplicateCategory.id}' was registered.`);
    this.providers = providers;
    this.categories = categories;
    this.categoryRegistry = createCategoryRegistry(categories.filter((category) => !BUILTIN_CATEGORY_DEFINITIONS.some((builtin) => builtin.id === category.id)) as CategoryDefinition[]);
    this.byId = new Map(providers.map((provider) => [provider.id, provider]));
  }

  get(id: string): ProviderModule | undefined { return this.byId.get(id); }
  list(): ProviderModule[] { return [...this.providers]; }
}

export function createBuiltinRegistry(): ProviderRegistry {
  return new ProviderRegistry([...BUILTIN_PROVIDERS], builtinCategories);
}

function pluginFromModule(value: unknown, packageName: string): RepnixProviderPlugin {
  const candidate = value && typeof value === "object" && "default" in value ? (value as { default: unknown }).default : value;
  if (!candidate || typeof candidate !== "object") throw new Error(`Provider plugin '${packageName}' did not export an object.`);
  const plugin = candidate as Partial<RepnixProviderPlugin>;
  if (plugin.apiVersion !== PROVIDER_API_VERSION) throw new Error(`Provider plugin '${packageName}' requires apiVersion ${String(plugin.apiVersion)}; supported version is ${PROVIDER_API_VERSION}.`);
  if (!Array.isArray(plugin.providers) || plugin.providers.length === 0) throw new Error(`Provider plugin '${packageName}' must export at least one provider.`);
  for (const provider of plugin.providers) {
    if (!provider || typeof provider !== "object" || typeof provider.id !== "string" || typeof provider.name !== "string" || typeof provider.category !== "string" || !Array.isArray(provider.packages) || !Array.isArray(provider.configPatterns) || !(provider.scriptPattern instanceof RegExp) || !provider.capabilities || typeof provider.capabilities !== "object") {
      throw new Error(`Provider plugin '${packageName}' contains an invalid provider definition.`);
    }
  }
  for (const category of plugin.categories ?? []) {
    if (!category || typeof category !== "object" || typeof category.id !== "string" || typeof category.label !== "string" || typeof category.description !== "string" || !Array.isArray(category.requiredCapabilities) || typeof category.applicable !== "function") {
      throw new Error(`Provider plugin '${packageName}' contains an invalid category definition.`);
    }
  }
  return plugin as RepnixProviderPlugin;
}

async function discoverPlugins(context: RepositoryContext): Promise<RepnixProviderPlugin[]> {
  const packageNames = new Set([
    ...Object.keys(context.packageJson.dependencies ?? {}),
    ...Object.keys(context.packageJson.devDependencies ?? {}),
    ...Object.keys(context.packageJson.optionalDependencies ?? {}),
  ].filter((name) => name.startsWith("repnix-provider-")));
  const require = createRequire(path.join(context.root, "package.json"));
  const plugins: RepnixProviderPlugin[] = [];
  for (const packageName of packageNames) {
    let resolved: string;
    try {
      resolved = require.resolve(`${packageName}/repnix-provider`);
    } catch {
      throw new Error(`Provider plugin '${packageName}' is installed but does not expose './repnix-provider'.`);
    }
    try {
      plugins.push(pluginFromModule(await import(pathToFileURL(resolved).href), packageName));
    } catch (error) {
      throw new Error(`Could not load provider plugin '${packageName}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return plugins;
}

export async function createProviderRegistry(context?: RepositoryContext): Promise<ProviderRegistry> {
  const registry = createBuiltinRegistry();
  if (!context) return registry;
  const plugins = await discoverPlugins(context);
  const providers = [...registry.providers];
  const categories = [...registry.categories];
  for (const plugin of plugins) {
    providers.push(...plugin.providers);
    categories.push(...(plugin.categories ?? []));
  }
  return new ProviderRegistry(providers, categories);
}

const byId = new Map(BUILTIN_PROVIDERS.map((provider) => [provider.id, provider]));
const byName = new Map(BUILTIN_PROVIDERS.map((provider) => [provider.name, provider]));
export function builtinProvider(id: string): BuiltinProviderDefinition | undefined { return byId.get(id); }
export function builtinProviderByName(name: string): BuiltinProviderDefinition | undefined { return byName.get(name); }
export { definePlugin };
export { detectAllProviders } from "./catalog.js";
