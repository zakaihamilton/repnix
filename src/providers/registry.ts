import { BUILTIN_CATEGORY_DEFINITIONS, createCategoryRegistry, type CategoryDefinition } from "../core/category-registry.js";
import { PROVIDERS } from "./catalog.js";
import type { CategoryModule, ProviderModule } from "./sdk.js";

export type ProviderSupport = "detectable" | "runnable" | "installable";

export interface BuiltinProviderDefinition extends ProviderModule {
  description: string;
  documentationUrl?: string;
  nextStep?: string;
  support: ProviderSupport[];
}

function providerSupport(descriptor: ProviderModule): ProviderSupport[] {
  return [
    "detectable",
    ...(descriptor.command || descriptor.runnable || descriptor.run ? ["runnable" as const] : []),
    ...(descriptor.setup ? ["installable" as const] : []),
  ];
}

export const BUILTIN_PROVIDERS: BuiltinProviderDefinition[] = PROVIDERS.map((descriptor) => ({
  ...descriptor,
  description: descriptor.description ?? `Runs ${descriptor.name} as a repository health check.`,
  support: providerSupport(descriptor),
}));

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

export function createProviderRegistry(): ProviderRegistry {
  return createBuiltinRegistry();
}

const byId = new Map(BUILTIN_PROVIDERS.map((provider) => [provider.id, provider]));
const byName = new Map(BUILTIN_PROVIDERS.map((provider) => [provider.name, provider]));
export function builtinProvider(id: string): BuiltinProviderDefinition | undefined { return byId.get(id); }
export function builtinProviderByName(name: string): BuiltinProviderDefinition | undefined { return byName.get(name); }
