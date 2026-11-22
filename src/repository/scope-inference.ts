import path from "node:path";
import type { PackageJson, RepositoryRole, RepositoryScope, RoleEvidence, WorkspaceManifest } from "../core/types.js";

export const TEST_FILE_PATTERN = /(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/i;
export const FIXTURE_FILE_PATTERN = /(^|\/)(?:fixture|fixtures|example|examples)(\/|$)/i;
export const GENERATED_FILE_PATTERN =
  /(^|\/)(?:generated|gen|coverage|storybook-static)(\/|$)|\.generated\.[cm]?[jt]sx?$/i;

export function allDependencies(manifest: PackageJson): Record<string, string> {
  return {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
}

export function detectSourceRoots(sourceFiles: string[]): string[] {
  const roots = new Set<string>();
  for (const file of sourceFiles) {
    const parts = file.split("/");
    const sourceIndex = parts.findIndex((part) => ["src", "app", "pages"].includes(part));
    if (sourceIndex >= 0) roots.add(parts.slice(0, sourceIndex + 1).join("/"));
  }
  if (!roots.size) return ["."];
  const sorted = [...roots].sort();
  const primary = sorted.filter((root) => !/^(?:fixtures?|examples?|tests?)(?:\/|$)/.test(root));
  return primary.length > 0 ? primary : sorted;
}

function scopeFiles(files: string[], scope: string): string[] {
  return scope === "." ? files : files.filter((file) => file.startsWith(`${scope}/`));
}

export function classifySourceFiles(sourceFiles: string[]): {
  production: string[];
  tests: string[];
  fixtures: string[];
  generated: string[];
} {
  const production: string[] = [];
  const tests: string[] = [];
  const fixtures: string[] = [];
  const generated: string[] = [];
  for (const file of sourceFiles) {
    if (GENERATED_FILE_PATTERN.test(file)) generated.push(file);
    else if (FIXTURE_FILE_PATTERN.test(file)) fixtures.push(file);
    else if (TEST_FILE_PATTERN.test(file)) tests.push(file);
    else production.push(file);
  }
  return { production, tests, fixtures, generated };
}

/** Infer repository roles, frameworks, languages, and source classification for a workspace scope. */
export function inferScope(
  manifest: WorkspaceManifest,
  allFiles: string[],
  allSourceFiles: string[],
  isMonorepo: boolean,
): RepositoryScope {
  const scope = path.posix.dirname(manifest.path.replaceAll(path.sep, "/"));
  const scopePath = scope === "." ? "." : scope;
  const files = scopeFiles(allFiles, scopePath);
  const sourceFiles = scopeFiles(allSourceFiles, scopePath);
  const classified = classifySourceFiles(sourceFiles);
  const dependencies = allDependencies(manifest.packageJson);
  const scripts = manifest.packageJson.scripts ?? {};
  const scriptText = Object.values(scripts).join(" ");
  const evidence: RoleEvidence[] = [];
  const addRole = (role: RepositoryRole, confidence: RoleEvidence["confidence"], signals: string[]) => {
    if (!evidence.some((entry) => entry.role === role)) evidence.push({ role, confidence, signals });
  };

  if (manifest.packageJson.bin) addRole("cli", "high", ["package.json#bin"]);

  const publishSignals = [
    manifest.packageJson.main,
    manifest.packageJson.module,
    manifest.packageJson.types,
    manifest.packageJson.typings,
    manifest.packageJson.exports,
    manifest.packageJson.files,
    manifest.packageJson.publishConfig,
  ].some(Boolean);
  if (manifest.packageJson.private !== true && publishSignals) {
    addRole("library", "high", ["publishable package entry points"]);
  }

  const next = dependencies.next !== undefined;
  const browserBuild = /(?:^|\s|&&|\|)(?:next|vite|react-scripts|astro|remix)(?:\s|$)/.test(scriptText);
  const browserEntry = files.some((file) => /(^|\/)(?:index\.html|pages\/|app\/).+/.test(file));
  const jsx = classified.production.some((file) => /\.[jt]sx$/.test(file));
  if (next) {
    addRole("web-app", "high", ["Next.js dependency"]);
  } else if (!manifest.packageJson.bin && jsx && (browserBuild || browserEntry)) {
    addRole("web-app", "medium", [
      browserBuild ? "browser build script" : "browser application entry",
      "JSX/TSX source",
    ]);
  }

  const serverScript = Object.entries(scripts).some(
    ([name, command]) =>
      /^(?:start|serve|dev)$/.test(name) && /(?:node|tsx|ts-node|express|fastify|nest)(?:\s|$)/.test(command),
  );
  if (serverScript) addRole("node-app", "medium", ["Node server script"]);

  if (!evidence.length) {
    if (isMonorepo && scopePath === "." && classified.production.length === 0)
      addRole("tooling", "high", ["workspace root without application source"]);
    else addRole("node-app", "medium", ["JavaScript/TypeScript executable project"]);
  }

  const frameworks = [next ? "Next.js" : null, dependencies.react !== undefined ? "React" : null].filter(
    (item): item is string => Boolean(item),
  );
  const hasTypeScript =
    dependencies.typescript !== undefined || classified.production.some((file) => /\.[cm]?tsx?$/.test(file));
  const hasJavaScript = classified.production.some((file) => /\.[cm]?jsx?$/.test(file));
  return {
    path: scopePath,
    manifestPath: manifest.path,
    packageJson: manifest.packageJson,
    roles: evidence.map((entry) => entry.role),
    roleEvidence: evidence,
    frameworks,
    languages: [hasTypeScript ? "TypeScript" : null, hasJavaScript ? "JavaScript" : null].filter(
      (item): item is string => Boolean(item),
    ),
    sourceFiles,
    productionSourceFiles: classified.production,
    testFiles: classified.tests,
    fixtureFiles: classified.fixtures,
    generatedFiles: classified.generated,
    sourceRoots: detectSourceRoots(classified.production),
  };
}
