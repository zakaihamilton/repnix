import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderDetection, RepositoryContext } from "../core/types.js";
import { isNonMutatingQualityCommand, isNonMutatingTestCommand } from "../repository/script-detection.js";
import type { ProviderModule } from "./sdk.js";

export type ProviderDescriptor = ProviderModule;

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
    id: "oxfmt",
    name: "Oxfmt",
    category: "format",
    packages: ["oxfmt"],
    configPatterns: [/(^|\/)\.oxfmtrc\.json$/],
    scriptPattern: /(^|\s|&&|\|)oxfmt(?:\s|$)/,
    capabilities: { formatting: true },
    zeroConfig: true,
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
    id: "test-script",
    name: "Test script",
    category: "tests",
    packages: [],
    configPatterns: [],
    scriptPattern: /$^/,
    scriptNames: ["test", "test:run", "check:test"],
    capabilities: { testing: true },
  },
  {
    id: "c8",
    name: "c8",
    category: "coverage",
    packages: ["c8"],
    configPatterns: [/(^|\/)(?:\.c8rc(?:\.[^/]+)?|c8\.config\.[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)c8(?:\s|$)/,
    scriptNames: ["health:coverage", "coverage", "test:coverage", "check:coverage"],
    scriptKind: "test",
    capabilities: { testCoverage: true },
  },
  {
    id: "stryker",
    name: "Stryker",
    category: "coverage",
    packages: ["@stryker-mutator/core"],
    configPatterns: [/(^|\/)stryker\.config\.[cm]?[jt]s$/],
    scriptPattern: /(^|\s|&&|\|)stryker(?:\s|$)/,
    scriptNames: ["health:mutation", "mutation", "stryker"],
    capabilities: { mutationTesting: true },
    command: { binary: "stryker", args: ["run"] },
    requiresConfiguration: true,
  },
  {
    id: "knip",
    name: "Knip",
    category: "dead-code",
    runnable: true,
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
    runnable: true,
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
    runnable: true,
    packages: [],
    configPatterns: [/(^|\/)osv-scanner\.toml$/],
    scriptPattern: /(^|\s|&&|\|)osv-scanner(?:\s|$)/,
    capabilities: { vulnerabilities: true },
    binary: "osv-scanner",
    searchPath: true,
    zeroConfig: true,
  },
  {
    id: "jsx-a11y",
    name: "eslint-plugin-jsx-a11y",
    category: "accessibility",
    runnable: true,
    packages: ["eslint-plugin-jsx-a11y"],
    configPatterns: [/(^|\/)eslint\.config\.[cm]?[jt]s$/, /(^|\/)\.eslintrc(?:\.[^/]+)?$/],
    scriptPattern: /(^|\s|&&|\|)eslint(?:\s|$)/,
    capabilities: { accessibilityRules: true },
    activeConfigPattern: /jsx-a11y/,
    requiresConfiguration: true,
  },
  {
    id: "eslint-boundaries",
    name: "eslint-plugin-boundaries",
    category: "architecture",
    runnable: true,
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
    runnable: true,
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
    runnable: true,
    packages: ["size-limit"],
    configPatterns: [/(^|\/)\.size-limit\.(?:json|[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)size-limit(?:\s|$)/,
    capabilities: { bundleBudget: true },
    packageJsonConfigKey: "size-limit",
    activeConfigPattern: /(?:limit\s*:|"limit"\s*:)/,
    requiresConfiguration: true,
  },
  {
    id: "syncpack",
    name: "syncpack",
    category: "monorepo",
    packages: ["syncpack"],
    configPatterns: [/(^|\/)\.syncpack(?:\.[^/]+)?$/],
    scriptPattern: /(^|\s|&&|\|)syncpack(?:\s|$)/,
    scriptNames: ["health:monorepo", "monorepo", "syncpack"],
    capabilities: { workspaceConsistency: true },
    command: { binary: "syncpack", args: ["list-mismatches"] },
    zeroConfig: true,
  },
  {
    id: "gitleaks",
    name: "Gitleaks",
    category: "secrets",
    packages: [],
    configPatterns: [/(^|\/)\.gitleaks\.(?:toml|ya?ml)$/],
    scriptPattern: /(^|\s|&&|\|)gitleaks(?:\s|$)/,
    capabilities: { secrets: true },
    binary: "gitleaks",
    searchPath: true,
    command: { binary: "gitleaks", args: ["detect", "--source", ".", "--no-banner", "--redact", "--exit-code", "1"], searchPath: true },
    zeroConfig: true,
  },
  {
    id: "license-checker",
    name: "license-checker",
    category: "licenses",
    packages: ["license-checker"],
    configPatterns: [],
    scriptPattern: /(^|\s|&&|\|)license-checker(?:\s|$)/,
    scriptNames: ["health:licenses", "licenses", "license-checker"],
    capabilities: { licenses: true },
    command: { binary: "license-checker", args: ["--json"] },
    zeroConfig: true,
  },
  {
    id: "markdownlint",
    name: "markdownlint",
    category: "documentation",
    packages: ["markdownlint-cli2"],
    configPatterns: [/(^|\/)\.markdownlint(?:[.-][^/]+)?$/],
    scriptPattern: /(^|\s|&&|\|)markdownlint(?:-cli2)?(?:\s|$)/,
    scriptNames: ["health:documentation", "documentation", "docs", "markdownlint"],
    capabilities: { documentation: true },
    command: { binary: "markdownlint-cli2", args: ["**/*.md"] },
    zeroConfig: true,
  },
  {
    id: "lhci",
    name: "Lighthouse CI",
    category: "performance",
    packages: ["@lhci/cli"],
    configPatterns: [/(^|\/)lighthouserc\.[cm]?[jt]s(?:on)?$/],
    scriptPattern: /(^|\s|&&|\|)lhci(?:\s|$)/,
    scriptNames: ["health:performance", "performance", "lhci"],
    capabilities: { performance: true },
    requiresConfiguration: true,
  },
  {
    id: "changesets",
    name: "Changesets",
    category: "release",
    packages: ["@changesets/cli"],
    configPatterns: [/(^|\/)\.changeset\/config\.json$/],
    scriptPattern: /(^|\s|&&|\|)changeset(?:\s|$)/,
    scriptNames: ["health:release", "release", "changeset:status"],
    capabilities: { release: true },
    requiresConfiguration: true,
  },
  {
    id: "actionlint",
    name: "actionlint",
    category: "ci",
    packages: [],
    configPatterns: [/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/],
    scriptPattern: /(^|\s|&&|\|)actionlint(?:\s|$)/,
    capabilities: { ciWorkflow: true },
    binary: "actionlint",
    searchPath: true,
    command: { binary: "actionlint", args: [".github/workflows"], searchPath: true },
    zeroConfig: true,
  },
  {
    id: "publint",
    name: "Publint",
    category: "package-health",
    runnable: true,
    packages: ["publint"],
    configPatterns: [],
    scriptPattern: /(^|\s|&&|\|)publint(?:\s|$)/,
    capabilities: { packagePublishing: true },
    zeroConfig: true,
  },
  {
    id: "attw",
    name: "Are The Types Wrong?",
    category: "package-health",
    runnable: true,
    packages: ["@arethetypeswrong/cli"],
    configPatterns: [/(^|\/)\.attw\.json$/],
    scriptPattern: /(^|\s|&&|\|)attw(?:\s|$)/,
    capabilities: { typesCompatibility: true },
    zeroConfig: true,
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
  if (descriptor.detect) return descriptor.detect(context);
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
  const scriptEntries = Object.entries(context.scripts).filter(([name, command]) =>
    descriptor.scriptNames
      ? descriptor.scriptNames.includes(name) && (descriptor.scriptKind === "quality" ? isNonMutatingQualityCommand(command) : isNonMutatingTestCommand(command))
      : descriptor.scriptPattern.test(command),
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
    ? installed && (configFiles.length > 0 || packageJsonConfigActive)
    : scriptEntries.length > 0 ||
      ((installedAtRoot || Boolean(pathBinary)) && (configFiles.length > 0 || packageJsonConfigActive || descriptor.zeroConfig === true));
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

export async function detectAllProviders(context: RepositoryContext, providers: readonly ProviderDescriptor[] = PROVIDERS): Promise<Map<string, ProviderDetection>> {
  const detections = await Promise.all(providers.map(async (provider) => [provider.id, await detectProvider(provider, context)] as const));
  const result = new Map(detections);
  if (["jest", "vitest"].some((id) => result.get(id)?.activeCapabilities.testing)) {
    const generic = result.get("test-script");
    if (generic) result.set("test-script", { ...generic, activeCapabilities: {} });
  }
  return result;
}
