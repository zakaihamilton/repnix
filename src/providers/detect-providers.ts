import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderDetection, RepositoryContext } from "../core/types.js";
import {
  isNonMutatingQualityCommand,
  isNonMutatingTestCommand,
  matchesScriptPattern,
} from "../repository/script-detection.js";
import { executableOnPath } from "../runners/health/task-executor.js";
import { PROVIDERS, type ProviderDescriptor } from "./catalog/index.js";

/** Detect whether a single provider is installed, configured, and active in the repository. */
async function detectProvider(descriptor: ProviderDescriptor, context: RepositoryContext): Promise<ProviderDetection> {
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
      if (descriptor.activeConfigPattern.test(await readFile(path.join(context.root, file), "utf8")))
        configFiles.push(file);
    } catch {
      // Repository diagnostics handle malformed manifests; unreadable optional tool configs stay inactive.
    }
  }
  const scriptEntries = Object.entries(context.scripts).filter(([name, command]) => {
    if (!descriptor.scriptNames) return matchesScriptPattern(command, descriptor.scriptPattern);
    const safe =
      descriptor.scriptKind === "quality" ? isNonMutatingQualityCommand(command) : isNonMutatingTestCommand(command);
    // A conventional script name does not always identify its provider. In
    // particular, Vitest's --coverage mode is not c8, and an unrestricted
    // Markdown glob would lint dependency documentation as well as the app.
    const invokesNamedProvider =
      !["c8", "lhci"].includes(descriptor.id) || matchesScriptPattern(command, descriptor.scriptPattern);
    const excludesDependencyDocs =
      descriptor.id !== "markdownlint" || /(?:^|\s)["']?#node_modules["']?(?:\s|$)/.test(command);
    return descriptor.scriptNames.includes(name) && safe && invokesNamedProvider && excludesDependencyDocs;
  });
  const packageConfigKey = descriptor.packageJsonConfigKey ?? descriptor.id;
  const packageJsonConfig = Object.hasOwn(context.packageJson, packageConfigKey);
  const packageJsonConfigActive =
    packageJsonConfig &&
    (!descriptor.activeConfigPattern ||
      descriptor.activeConfigPattern.test(JSON.stringify(context.packageJson[packageConfigKey])));
  const pathBinary = descriptor.searchPath && descriptor.binary ? await executableOnPath(descriptor.binary) : null;
  const installed = Boolean(packageName || pathBinary);
  const installedAtRoot = packageName
    ? context.installedPackageOrigins.get(packageName)?.includes("package.json") === true
    : false;
  const configured = configFiles.length > 0 || scriptEntries.length > 0 || packageJsonConfigActive;
  const pathBinaryConfigured = Boolean(pathBinary) && configured;
  const active = descriptor.requiresConfiguration
    ? installed && (configFiles.length > 0 || packageJsonConfigActive)
    : scriptEntries.length > 0 ||
      ((installedAtRoot || pathBinaryConfigured) &&
        (configFiles.length > 0 || packageJsonConfigActive || descriptor.zeroConfig === true));
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

/** Detect all providers in the repository and resolve generic test-script overlap. */
export async function detectAllProviders(
  context: RepositoryContext,
  providers: readonly ProviderDescriptor[] = PROVIDERS,
): Promise<Map<string, ProviderDetection>> {
  const detections = await Promise.all(
    providers.map(async (provider) => [provider.id, await detectProvider(provider, context)] as const),
  );
  const result = new Map(detections);
  if (["jest", "vitest"].some((id) => result.get(id)?.activeCapabilities.testing)) {
    const generic = result.get("test-script");
    if (generic) result.set("test-script", { ...generic, activeCapabilities: {} });
  }
  return result;
}
