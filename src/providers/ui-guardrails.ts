import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderDetection, RepositoryContext } from "../core/types.js";
import { isNonMutatingTestCommand, matchesScriptPattern } from "../repository/script-detection.js";

interface SourceUsageOptions {
  packageNames: string[];
  usagePattern: RegExp;
  configFiles?: string[];
  scriptNames: string[];
  scriptPattern: RegExp;
}

function installedPackage(context: RepositoryContext, names: string[]): string | undefined {
  return names.find((name) => context.installedPackages.has(name));
}

function testFiles(context: RepositoryContext): string[] {
  const scopedTestFiles = [...new Set(context.scopes.flatMap((scope) => scope.testFiles ?? []))];
  if (scopedTestFiles.length > 0) return scopedTestFiles;
  return context.sourceFiles.filter((file) =>
    /(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/i.test(file),
  );
}

async function findUsage(context: RepositoryContext, pattern: RegExp): Promise<string | undefined> {
  for (const file of testFiles(context)) {
    try {
      if (pattern.test(await readFile(path.join(context.root, file), "utf8"))) return file;
    } catch {
      // Unreadable test files do not prove that the provider is active.
    }
  }
  return undefined;
}

function testScripts(context: RepositoryContext, names: string[], pattern: RegExp): string[] {
  return Object.entries(context.scripts)
    .filter(
      ([name, command]) =>
        names.includes(name) && isNonMutatingTestCommand(command) && matchesScriptPattern(command, pattern),
    )
    .map(([name]) => name);
}

function detection(
  context: RepositoryContext,
  packageName: string | undefined,
  configured: boolean,
  evidence: string[],
  capability: string,
  configFiles: string[] = [],
): ProviderDetection {
  const installed = packageName !== undefined;
  return {
    installed,
    configured,
    configFiles,
    evidence,
    availableCapabilities: installed ? { [capability]: true } : {},
    activeCapabilities: installed && configured ? { [capability]: true } : {},
    ...(packageName ? { version: context.installedPackages.get(packageName)! } : {}),
  };
}

async function detectTestBackedProvider(
  context: RepositoryContext,
  options: SourceUsageOptions,
  capability: string,
): Promise<ProviderDetection> {
  const packageName = installedPackage(context, options.packageNames);
  const usageFile = await findUsage(context, options.usagePattern);
  const scripts = testScripts(context, options.scriptNames, options.scriptPattern);
  const configFiles = options.configFiles ?? [];
  const configured =
    Boolean(usageFile && scripts.length > 0) && (options.configFiles === undefined || configFiles.length > 0);
  const evidence = [
    ...(packageName ? [`${packageName} ${context.installedPackages.get(packageName)}`] : []),
    ...configFiles,
    ...(usageFile ? [`test usage: ${usageFile}`] : []),
    ...scripts.map((script) => `script:${script}`),
  ];
  return detection(context, packageName, configured, evidence, capability, configFiles);
}

export function detectAxePlaywright(context: RepositoryContext): Promise<ProviderDetection> {
  return detectTestBackedProvider(
    context,
    {
      packageNames: ["@axe-core/playwright"],
      usagePattern: /(?:from\s*["']@axe-core\/playwright["']|require\(["']@axe-core\/playwright["']\)|\bAxeBuilder\b)/,
      scriptNames: ["health:a11y", "test:a11y", "a11y:test"],
      scriptPattern: /(?:playwright\s+test|vitest(?:\s+run)?|jest)/,
    },
    "runtimeAccessibility",
  );
}

export async function detectStorybookA11y(context: RepositoryContext): Promise<ProviderDetection> {
  const packageName = installedPackage(context, ["@storybook/addon-a11y"]);
  const mainFiles = [...context.files].filter((file) => /(^|\/)\.storybook\/main\.[cm]?[jt]sx?$/.test(file));
  const mainContents = await Promise.all(
    mainFiles.map(async (file) => {
      try {
        return await readFile(path.join(context.root, file), "utf8");
      } catch {
        return "";
      }
    }),
  );
  const activeConfigFiles = mainFiles.filter((_, index) => /@storybook\/addon-a11y/.test(mainContents[index]!));
  const vitestAddonConfigFiles = mainFiles.filter((_, index) => /@storybook\/addon-vitest/.test(mainContents[index]!));
  const previewFiles = [...context.files].filter((file) => /(^|\/)\.storybook\/preview\.[cm]?[jt]sx?$/.test(file));
  const previewContents = await Promise.all(
    previewFiles.map(async (file) => {
      try {
        return await readFile(path.join(context.root, file), "utf8");
      } catch {
        return "";
      }
    }),
  );
  const errorModeFiles = previewFiles.filter((_, index) =>
    /(?:\ba11y\s*:\s*\{[^}]*?\btest\s*:\s*["']error["']|\bparameters\s*\.\s*a11y\s*\.\s*test\s*=\s*["']error["'])/s.test(
      previewContents[index]!,
    ),
  );
  const testConfigFiles = [...context.files].filter((file) =>
    /(^|\/)(?:vitest|vite)\.(?:config|workspace)\.[cm]?[jt]sx?$/.test(file),
  );
  const testConfigContents = await Promise.all(
    testConfigFiles.map(async (file) => {
      try {
        return await readFile(path.join(context.root, file), "utf8");
      } catch {
        return "";
      }
    }),
  );
  const vitestIntegrationFiles = testConfigFiles.filter(
    (_, index) =>
      /@storybook\/addon-vitest\/vitest-plugin/.test(testConfigContents[index]!) &&
      /\bstorybookTest\s*\(/.test(testConfigContents[index]!),
  );
  const namedScripts = Object.entries(context.scripts).filter(
    ([name, command]) =>
      ["health:storybook-a11y", "test:storybook-a11y", "storybook:a11y"].includes(name) &&
      isNonMutatingTestCommand(command),
  );
  const vitestScriptNames = namedScripts
    .filter(([, command]) =>
      matchesScriptPattern(command, /(?:^|\s)vitest(?:\s+[^;&|]*)--project(?:=|\s+)["']?storybook(?:["']|\s|$)/),
    )
    .map(([name]) => name);
  const testRunnerScriptNames = namedScripts
    .filter(([, command]) => matchesScriptPattern(command, /(?:^|\s)test-storybook(?:\s|$)/))
    .map(([name]) => name);
  const hasVitestIntegration =
    installedPackage(context, ["@storybook/addon-vitest"]) !== undefined &&
    vitestAddonConfigFiles.length > 0 &&
    vitestIntegrationFiles.length > 0 &&
    vitestScriptNames.length > 0;
  const hasTestRunnerIntegration =
    installedPackage(context, ["@storybook/test-runner"]) !== undefined && testRunnerScriptNames.length > 0;
  const scripts = [...vitestScriptNames, ...testRunnerScriptNames];
  const integrationConfigFiles = [...vitestAddonConfigFiles, ...vitestIntegrationFiles, ...errorModeFiles];
  const configFiles = [...new Set([...activeConfigFiles, ...integrationConfigFiles])];
  const evidence = [
    ...(packageName ? [`${packageName} ${context.installedPackages.get(packageName)}`] : []),
    ...configFiles,
    ...scripts.map((script) => `script:${script}`),
  ];
  const configured =
    activeConfigFiles.length > 0 && errorModeFiles.length > 0 && (hasVitestIntegration || hasTestRunnerIntegration);
  return {
    installed: packageName !== undefined,
    configured,
    configFiles,
    evidence,
    availableCapabilities: packageName ? { runtimeAccessibility: true } : {},
    activeCapabilities: packageName && configured ? { runtimeAccessibility: true } : {},
    ...(packageName ? { version: context.installedPackages.get(packageName)! } : {}),
  };
}

export function detectPlaywrightVisual(context: RepositoryContext): Promise<ProviderDetection> {
  return detectTestBackedProvider(
    context,
    {
      packageNames: ["@playwright/test", "playwright"],
      usagePattern: /\btoHaveScreenshot\s*\(/,
      configFiles: [...context.files].filter((file) => /(^|\/)playwright\.config\.[cm]?[jt]s$/.test(file)),
      scriptNames: ["health:visual", "test:visual", "visual:test"],
      scriptPattern: /playwright\s+test/,
    },
    "visualRegression",
  );
}

export function detectUserEvent(context: RepositoryContext): Promise<ProviderDetection> {
  return detectTestBackedProvider(
    context,
    {
      packageNames: ["@testing-library/user-event"],
      usagePattern:
        /(?:from\s*["']@testing-library\/user-event["']|require\(["']@testing-library\/user-event["']\)|\buserEvent\.setup\s*\()/,
      scriptNames: ["health:interactions", "test:interactions", "ui:interactions"],
      scriptPattern: /(?:vitest(?:\s+run)?|jest|playwright\s+test)/,
    },
    "userInteractionTesting",
  );
}

export function hasUiStyles(context: RepositoryContext): boolean {
  return [...context.files].some((file) => /\.(?:css|pcss|postcss)$/i.test(file));
}

export function hasStorybook(context: RepositoryContext): boolean {
  return (
    [...context.files].some((file) => /(^|\/)\.storybook\/main\.[cm]?[jt]sx?$/.test(file)) ||
    ["storybook", "@storybook/react", "@storybook/react-vite", "@storybook/nextjs"].some((name) =>
      context.installedPackages.has(name),
    )
  );
}

export function hasWebApp(context: RepositoryContext): boolean {
  return context.scopes.some((scope) => scope.roles.includes("web-app"));
}
