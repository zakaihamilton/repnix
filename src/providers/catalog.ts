import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ProviderDetection, RepositoryContext } from "../core/types.js";
import { isNonMutatingQualityCommand, isNonMutatingTestCommand } from "../repository/script-detection.js";
import type { ProviderModule } from "./sdk.js";

export type ProviderDescriptor = ProviderModule;

function committedIntegration(
  configFiles: string[],
  capabilities: ProviderDetection["availableCapabilities"],
  active: boolean,
): ProviderDetection {
  const configured = configFiles.length > 0;
  return {
    installed: configured,
    configured,
    configFiles,
    evidence: [...configFiles],
    availableCapabilities: configured ? capabilities : {},
    activeCapabilities: active ? capabilities : {},
  };
}

async function workflowFiles(context: RepositoryContext, pattern: RegExp): Promise<Array<{ path: string; content: string }>> {
  const files = [...context.files].filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));
  const matching: Array<{ path: string; content: string }> = [];
  for (const file of files) {
    try {
      const content = await readFile(path.join(context.root, file), "utf8");
      if (pattern.test(content)) matching.push({ path: file, content });
    } catch {
      // Unreadable workflow files remain inactive; GitHub Actions will surface their own diagnostics.
    }
  }
  return matching;
}

async function detectCodeql(context: RepositoryContext): Promise<ProviderDetection> {
  const workflows = await workflowFiles(context, /github\/codeql-action\//);
  const active = workflows.some((file) => /github\/codeql-action\/init@/.test(file.content) && /github\/codeql-action\/analyze@/.test(file.content));
  return committedIntegration(workflows.map((file) => file.path), { codeSecurity: true }, active);
}

type SemgrepProduct = "code" | "supply-chain" | "secrets";

function semgrepProductEnabled(content: string, product: SemgrepProduct): boolean {
  const commands = [...content.matchAll(/^\s*-\s+run:\s+(.+)$/gm)].map((match) => match[1] ?? "");
  return commands.some((command) => {
    if (!/\bsemgrep\s+ci\b/.test(command)) return false;
    if (product === "supply-chain") return /--supply-chain\b/.test(command);
    if (product === "secrets") return /--secrets\b/.test(command);
    return !/--(?:supply-chain|secrets)\b/.test(command);
  });
}

async function detectSemgrep(context: RepositoryContext, product: SemgrepProduct, capabilities: ProviderDetection["availableCapabilities"]): Promise<ProviderDetection> {
  const workflows = await workflowFiles(context, /\bsemgrep\s+ci\b/);
  const configs = [...context.files].filter((file) => /(?:^|\/)semgrep(?:\.config)?\.ya?ml$/.test(file));
  return committedIntegration([...new Set([...workflows.map((file) => file.path), ...configs])], capabilities, workflows.some((file) => semgrepProductEnabled(file.content, product)));
}

async function detectSocket(context: RepositoryContext): Promise<ProviderDetection> {
  const config = context.files.has("socket.yml") ? "socket.yml" : context.files.has("socket.yaml") ? "socket.yaml" : undefined;
  // socket.yml controls an installed GitHub App, but local repository files cannot prove that the App is installed or enabled.
  return committedIntegration(config ? [config] : [], { supplyChainRisk: true }, false);
}

async function detectSonarqubeCloud(context: RepositoryContext): Promise<ProviderDetection> {
  const workflows = await workflowFiles(context, /SonarSource\/(?:sonarqube-scan-action|sonarcloud-github-action)@/);
  const project = context.files.has("sonar-project.properties") ? ["sonar-project.properties"] : [];
  return committedIntegration([...workflows.map((file) => file.path), ...project], { codeSecurity: true }, workflows.length > 0 && project.length > 0);
}

async function detectDependabot(context: RepositoryContext): Promise<ProviderDetection> {
  const config = context.files.has(".github/dependabot.yml") ? ".github/dependabot.yml" : context.files.has(".github/dependabot.yaml") ? ".github/dependabot.yaml" : undefined;
  if (!config) return committedIntegration([], { dependencyUpdates: true }, false);
  try {
    const parsed: unknown = parseYaml(await readFile(path.join(context.root, config), "utf8"));
    const updates = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { version?: unknown; updates?: unknown }).updates : undefined;
    const active = (parsed as { version?: unknown } | null)?.version === 2 && Array.isArray(updates) && updates.some((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const update = entry as { "package-ecosystem"?: unknown; directory?: unknown; directories?: unknown; schedule?: unknown };
      const ecosystem = update["package-ecosystem"];
      const hasDirectory = typeof update.directory === "string" || (Array.isArray(update.directories) && update.directories.some((directory) => typeof directory === "string"));
      const interval = update.schedule && typeof update.schedule === "object" && !Array.isArray(update.schedule) ? (update.schedule as { interval?: unknown }).interval : undefined;
      return (ecosystem === "npm" || ecosystem === "github-actions") && hasDirectory && typeof interval === "string";
    });
    return committedIntegration([config], { dependencyUpdates: true }, active);
  } catch {
    return committedIntegration([config], { dependencyUpdates: true }, false);
  }
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
    id: "codeql",
    name: "CodeQL",
    category: "code-security",
    packages: [],
    configPatterns: [/^\.github\/workflows\/[^/]+\.ya?ml$/],
    scriptPattern: /$^/,
    capabilities: { codeSecurity: true },
    detect: detectCodeql,
    documentationUrl: "https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning",
  },
  {
    id: "semgrep-code",
    name: "Semgrep Code",
    category: "code-security",
    packages: [],
    configPatterns: [/^\.github\/workflows\/[^/]+\.ya?ml$/, /(?:^|\/)semgrep(?:\.config)?\.ya?ml$/],
    scriptPattern: /$^/,
    capabilities: { codeSecurity: true },
    detect: (context) => detectSemgrep(context, "code", { codeSecurity: true }),
    documentationUrl: "https://semgrep.dev/docs/semgrep-ci/sample-ci-configs",
  },
  {
    id: "semgrep-supply-chain",
    name: "Semgrep Supply Chain",
    category: "supply-chain",
    packages: [],
    configPatterns: [/^\.github\/workflows\/[^/]+\.ya?ml$/, /(?:^|\/)semgrep(?:\.config)?\.ya?ml$/],
    scriptPattern: /$^/,
    capabilities: { supplyChainRisk: true },
    detect: (context) => detectSemgrep(context, "supply-chain", { supplyChainRisk: true }),
    documentationUrl: "https://semgrep.dev/products/semgrep-supply-chain/",
  },
  {
    id: "semgrep-secrets",
    name: "Semgrep Secrets",
    category: "secrets",
    packages: [],
    configPatterns: [/^\.github\/workflows\/[^/]+\.ya?ml$/, /(?:^|\/)semgrep(?:\.config)?\.ya?ml$/],
    scriptPattern: /$^/,
    capabilities: { secrets: true },
    detect: (context) => detectSemgrep(context, "secrets", { secrets: true }),
    documentationUrl: "https://semgrep.dev/docs/semgrep-ci/sample-ci-configs",
  },
  {
    id: "socket",
    name: "Socket",
    category: "supply-chain",
    packages: [],
    configPatterns: [/^socket\.ya?ml$/],
    scriptPattern: /$^/,
    capabilities: { supplyChainRisk: true },
    detect: detectSocket,
    documentationUrl: "https://docs.socket.dev/docs/socket-for-github-installation",
  },
  {
    id: "sonarqube-cloud",
    name: "SonarQube Cloud",
    category: "code-security",
    packages: [],
    configPatterns: [/^sonar-project\.properties$/, /^\.github\/workflows\/[^/]+\.ya?ml$/],
    scriptPattern: /$^/,
    capabilities: { codeSecurity: true },
    detect: detectSonarqubeCloud,
    documentationUrl: "https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/github-actions-for-sonarcloud",
  },
  {
    id: "dependabot",
    name: "Dependabot",
    category: "dependency-updates",
    packages: [],
    configPatterns: [/^\.github\/dependabot\.ya?ml$/],
    scriptPattern: /$^/,
    capabilities: { dependencyUpdates: true },
    detect: detectDependabot,
    documentationUrl: "https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file",
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
