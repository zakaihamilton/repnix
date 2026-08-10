import type {
  ProviderCapabilities,
  ProviderDetection,
  RepositoryContext,
} from "../core/types.js";
import type { HealthCategory } from "../core/health-category.js";

export interface ProviderDescriptor {
  id: string;
  name: string;
  category: HealthCategory;
  packages: string[];
  configPatterns: RegExp[];
  scriptPattern: RegExp;
  capabilities: ProviderCapabilities;
  zeroConfig?: boolean;
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: "typescript",
    name: "TypeScript",
    category: "types",
    packages: ["typescript"],
    configPatterns: [/(^|\/)tsconfig(?:\.[^/]+)?\.json$/],
    scriptPattern: /(^|\s|&&|\|)tsc(?:\s|$)/,
    capabilities: { typeChecking: true },
  },
  {
    id: "eslint",
    name: "ESLint",
    category: "lint",
    packages: ["eslint"],
    configPatterns: [/(^|\/)eslint\.config\.[cm]?[jt]s$/, /(^|\/)\.eslintrc(?:\.[^/]+)?$/],
    scriptPattern: /(^|\s|&&|\|)eslint(?:\s|$)/,
    capabilities: { linting: true },
  },
  {
    id: "oxlint",
    name: "Oxlint",
    category: "lint",
    packages: ["oxlint"],
    configPatterns: [/(^|\/)\.oxlintrc\.json$/],
    scriptPattern: /(^|\s|&&|\|)oxlint(?:\s|$)/,
    capabilities: { linting: true },
    zeroConfig: true,
  },
  {
    id: "biome",
    name: "Biome",
    category: "lint",
    packages: ["@biomejs/biome"],
    configPatterns: [/(^|\/)biome\.jsonc?$/],
    scriptPattern: /(^|\s|&&|\|)biome(?:\s|$)/,
    capabilities: { linting: true, formatting: true },
  },
  {
    id: "prettier",
    name: "Prettier",
    category: "format",
    packages: ["prettier"],
    configPatterns: [/(^|\/)\.prettierrc(?:\.[^/]+)?$/, /(^|\/)prettier\.config\.[cm]?[jt]s$/],
    scriptPattern: /(^|\s|&&|\|)prettier(?:\s|$)/,
    capabilities: { formatting: true },
  },
  {
    id: "jest",
    name: "Jest",
    category: "tests",
    packages: ["jest"],
    configPatterns: [/(^|\/)jest\.config\.[cm]?[jt]s(?:on)?$/],
    scriptPattern: /(^|\s|&&|\|)jest(?:\s|$)/,
    capabilities: { testing: true },
    zeroConfig: true,
  },
  {
    id: "vitest",
    name: "Vitest",
    category: "tests",
    packages: ["vitest"],
    configPatterns: [/(^|\/)vitest\.config\.[cm]?[jt]s$/],
    scriptPattern: /(^|\s|&&|\|)vitest(?:\s|$)/,
    capabilities: { testing: true },
    zeroConfig: true,
  },
  {
    id: "knip",
    name: "Knip",
    category: "dead-code",
    packages: ["knip"],
    configPatterns: [/(^|\/)knip\.(?:jsonc?|[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)knip(?:\s|$)/,
    capabilities: {
      unusedFiles: true,
      unusedExports: true,
      unusedDependencies: true,
      dependencyCycles: true,
    },
    zeroConfig: true,
  },
  {
    id: "jscpd",
    name: "jscpd",
    category: "duplication",
    packages: ["jscpd"],
    configPatterns: [/(^|\/)\.jscpd\.json$/, /(^|\/)jscpd\.json$/],
    scriptPattern: /(^|\s|&&|\|)jscpd(?:\s|$)/,
    capabilities: { duplication: true },
    zeroConfig: true,
  },
];

export function detectProvider(
  descriptor: ProviderDescriptor,
  context: RepositoryContext,
): ProviderDetection {
  const packageName = descriptor.packages.find((name) => context.installedPackages.has(name));
  const configFiles = [...context.files].filter((file) =>
    descriptor.configPatterns.some((pattern) => pattern.test(file)),
  );
  const rootConfigFiles = configFiles.filter((file) => !file.includes("/"));
  const scriptEntries = Object.entries(context.scripts).filter(([, command]) =>
    descriptor.scriptPattern.test(command),
  );
  const packageJsonConfig = Object.hasOwn(context.packageJson, descriptor.id);
  const installed = Boolean(packageName);
  const installedAtRoot = packageName
    ? context.installedPackageOrigins.get(packageName)?.includes("package.json") === true
    : false;
  const configured = configFiles.length > 0 || scriptEntries.length > 0 || packageJsonConfig;
  const active =
    scriptEntries.length > 0 ||
    (installedAtRoot && (rootConfigFiles.length > 0 || packageJsonConfig || descriptor.zeroConfig === true));
  const evidence: string[] = [];
  if (packageName) evidence.push(`${packageName} ${context.installedPackages.get(packageName)}`);
  evidence.push(...configFiles);
  evidence.push(...scriptEntries.map(([name]) => `script:${name}`));
  if (packageJsonConfig) evidence.push(`package.json#${descriptor.id}`);
  const detection: ProviderDetection = {
    installed,
    configured,
    configFiles,
    evidence,
    availableCapabilities: installed ? descriptor.capabilities : {},
    activeCapabilities: active ? descriptor.capabilities : {},
  };
  if (packageName) detection.version = context.installedPackages.get(packageName)!;
  return detection;
}

export function detectAllProviders(context: RepositoryContext): Map<string, ProviderDetection> {
  return new Map(PROVIDERS.map((provider) => [provider.id, detectProvider(provider, context)]));
}
