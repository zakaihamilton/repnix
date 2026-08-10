import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
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
  binary?: string;
  searchPath?: boolean;
  packageJsonConfigKey?: string;
  activeConfigPattern?: RegExp;
  requiresConfiguration?: boolean;
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
  {
    id: "osv-scanner",
    name: "OSV-Scanner",
    category: "security",
    packages: [],
    configPatterns: [/(^|\/)osv-scanner\.toml$/],
    scriptPattern: /(^|\s|&&|\|)osv-scanner(?:\s|$)/,
    capabilities: { vulnerabilities: true },
    binary: "osv-scanner",
    searchPath: true,
    zeroConfig: true,
  },
  {
    id: "eslint-boundaries",
    name: "eslint-plugin-boundaries",
    category: "architecture",
    packages: ["eslint-plugin-boundaries"],
    configPatterns: [/(^|\/)eslint\.config\.[cm]?[jt]s$/, /(^|\/)\.eslintrc(?:\.[^/]+)?$/],
    scriptPattern: /\bboundaries\//,
    capabilities: { architectureRules: true },
    activeConfigPattern: /boundaries\/(?:dependencies|element-types|entry-point|external|no-private|no-unknown)/,
    requiresConfiguration: true,
  },
  {
    id: "dependency-cruiser",
    name: "dependency-cruiser",
    category: "architecture",
    packages: ["dependency-cruiser"],
    configPatterns: [/(^|\/)\.dependency-cruiser\.(?:json|[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)(?:depcruise|dependency-cruiser)(?:\s|$)/,
    capabilities: { dependencyCycles: true, architectureRules: true },
    activeConfigPattern: /(?:forbidden\s*:|"forbidden"\s*:)/,
    requiresConfiguration: true,
  },
  {
    id: "size-limit",
    name: "Size Limit",
    category: "bundle",
    packages: ["size-limit"],
    configPatterns: [/(^|\/)\.size-limit\.(?:json|[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)size-limit(?:\s|$)/,
    capabilities: { bundleBudget: true },
    packageJsonConfigKey: "size-limit",
    activeConfigPattern: /(?:limit\s*:|"limit"\s*:)/,
    requiresConfiguration: true,
  },
];

async function executableOnPath(binary: string): Promise<string | null> {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, `${binary}${process.platform === "win32" ? ".exe" : ""}`);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return null;
}

export async function detectProvider(
  descriptor: ProviderDescriptor,
  context: RepositoryContext,
): Promise<ProviderDetection> {
  const packageName = descriptor.packages.find((name) => context.installedPackages.has(name));
  const candidateConfigFiles = [...context.files].filter((file) =>
    descriptor.configPatterns.some((pattern) => pattern.test(file)),
  );
  const configFiles: string[] = [];
  for (const file of candidateConfigFiles) {
    if (!descriptor.activeConfigPattern) {
      configFiles.push(file);
      continue;
    }
    try {
      if (descriptor.activeConfigPattern.test(await readFile(path.join(context.root, file), "utf8"))) configFiles.push(file);
    } catch {
      // Repository diagnostics handle malformed manifests; unreadable optional tool configs stay inactive.
    }
  }
  const rootConfigFiles = configFiles.filter((file) => !file.includes("/"));
  const scriptEntries = Object.entries(context.scripts).filter(([, command]) =>
    descriptor.scriptPattern.test(command),
  );
  const packageConfigKey = descriptor.packageJsonConfigKey ?? descriptor.id;
  const packageJsonConfig = Object.hasOwn(context.packageJson, packageConfigKey);
  const packageJsonConfigActive = packageJsonConfig && (!descriptor.activeConfigPattern || descriptor.activeConfigPattern.test(JSON.stringify(context.packageJson[packageConfigKey])));
  const pathBinary = descriptor.searchPath && descriptor.binary ? await executableOnPath(descriptor.binary) : null;
  const installed = Boolean(packageName || pathBinary);
  const installedAtRoot = packageName
    ? context.installedPackageOrigins.get(packageName)?.includes("package.json") === true
    : false;
  const configured = configFiles.length > 0 || scriptEntries.length > 0 || packageJsonConfigActive;
  const active = descriptor.requiresConfiguration
    ? installed && (rootConfigFiles.length > 0 || packageJsonConfigActive)
    : scriptEntries.length > 0 ||
      ((installedAtRoot || Boolean(pathBinary)) && (rootConfigFiles.length > 0 || packageJsonConfigActive || descriptor.zeroConfig === true));
  const evidence: string[] = [];
  if (packageName) evidence.push(`${packageName} ${context.installedPackages.get(packageName)}`);
  if (pathBinary) evidence.push(pathBinary);
  evidence.push(...configFiles);
  evidence.push(...scriptEntries.map(([name]) => `script:${name}`));
  if (packageJsonConfig) evidence.push(`package.json#${packageConfigKey}`);
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

export async function detectAllProviders(context: RepositoryContext): Promise<Map<string, ProviderDetection>> {
  const detections = await Promise.all(PROVIDERS.map(async (provider) => [provider.id, await detectProvider(provider, context)] as const));
  return new Map(detections);
}
