import { access, readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parse as parseYaml } from "yaml";
import type {
  PackageJson,
  RepositoryContext,
  RepositoryKind,
  WorkspaceManifest,
} from "../core/types.js";
import { detectPackageManager } from "./detect-package-manager.js";

const IGNORES = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/out/**",
];

const SOURCE_PATTERN = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(file: string): Promise<PackageJson> {
  const raw = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected an object");
    }
    return parsed as PackageJson;
  } catch (error) {
    throw new Error(`Invalid package.json at ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function workspacePatterns(packageJson: PackageJson, pnpmWorkspace: unknown): string[] {
  const declared = Array.isArray(packageJson.workspaces)
    ? packageJson.workspaces
    : packageJson.workspaces?.packages ?? [];
  const pnpm =
    pnpmWorkspace && typeof pnpmWorkspace === "object" && "packages" in pnpmWorkspace
      ? (pnpmWorkspace as { packages?: unknown }).packages
      : undefined;
  const patterns = [...declared];
  if (Array.isArray(pnpm)) {
    patterns.push(...pnpm.filter((item): item is string => typeof item === "string"));
  }
  return [...new Set(patterns)].map((pattern) =>
    pattern.endsWith("package.json") ? pattern : `${pattern.replace(/\/$/, "")}/package.json`,
  );
}

async function findRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  let nearest: string | null = null;
  let workspaceRoot: string | null = null;
  while (true) {
    const hasPackage = await exists(path.join(current, "package.json"));
    if (hasPackage) {
      nearest ??= current;
      const packageJson = await readPackageJson(path.join(current, "package.json"));
      if (
        packageJson.workspaces ||
        (await exists(path.join(current, "pnpm-workspace.yaml"))) ||
        (await exists(path.join(current, "turbo.json"))) ||
        (await exists(path.join(current, "nx.json"))) ||
        (await exists(path.join(current, "lerna.json")))
      ) {
        workspaceRoot = current;
      }
    }
    const gitBoundary = await exists(path.join(current, ".git"));
    const parent = path.dirname(current);
    if (gitBoundary || parent === current) break;
    current = parent;
  }
  const root = workspaceRoot ?? nearest;
  if (!root) throw new Error(`No package.json found from ${start}`);
  return root;
}

function allDependencies(manifest: PackageJson): Record<string, string> {
  return {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
}

function detectSourceRoots(sourceFiles: string[]): string[] {
  const roots = new Set<string>();
  for (const file of sourceFiles) {
    const parts = file.split("/");
    const sourceIndex = parts.findIndex((part) => ["src", "app", "pages"].includes(part));
    if (sourceIndex >= 0) roots.add(parts.slice(0, sourceIndex + 1).join("/"));
  }
  return roots.size > 0 ? [...roots].sort() : ["."];
}

export async function detectRepository(start = process.cwd()): Promise<RepositoryContext> {
  const root = await findRoot(start);
  const packageJson = await readPackageJson(path.join(root, "package.json"));
  const discoveredFiles = await fg("**/*", {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: IGNORES,
    followSymbolicLinks: false,
  });
  const files = new Set(discoveredFiles.map((file) => file.replaceAll(path.sep, "/")));

  let pnpmWorkspace: unknown;
  if (files.has("pnpm-workspace.yaml")) {
    try {
      pnpmWorkspace = parseYaml(await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8"));
    } catch {
      pnpmWorkspace = undefined;
    }
  }
  const patterns = workspacePatterns(packageJson, pnpmWorkspace);
  if (
    patterns.length === 0 &&
    ["turbo.json", "nx.json", "lerna.json"].some((file) => files.has(file))
  ) {
    patterns.push("packages/*/package.json", "apps/*/package.json");
  }
  const manifestPaths = patterns.length
    ? await fg(patterns, { cwd: root, ignore: IGNORES, onlyFiles: true })
    : [];
  const manifests: WorkspaceManifest[] = [{ path: "package.json", packageJson }];
  for (const manifestPath of [...new Set(manifestPaths)].sort()) {
    if (manifestPath === "package.json") continue;
    manifests.push({
      path: manifestPath,
      packageJson: await readPackageJson(path.join(root, manifestPath)),
    });
  }

  const installedPackages = new Map<string, string>();
  const installedPackageOrigins = new Map<string, string[]>();
  for (const manifest of manifests) {
    for (const [name, version] of Object.entries(allDependencies(manifest.packageJson))) {
      installedPackages.set(name, version);
      installedPackageOrigins.set(name, [
        ...(installedPackageOrigins.get(name) ?? []),
        manifest.path,
      ]);
    }
  }

  const sourceFiles = (await fg(SOURCE_PATTERN, {
    cwd: root,
    ignore: IGNORES,
    onlyFiles: true,
  })).sort();
  const hasTsConfig = [...files].some((file) => /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(file));
  const hasTypeScript =
    installedPackages.has("typescript") || hasTsConfig || sourceFiles.some((file) => /\.[cm]?tsx?$/.test(file));
  const hasJavaScript = sourceFiles.some((file) => /\.[cm]?jsx?$/.test(file));
  const frameworks = [
    installedPackages.has("next") ? "Next.js" : null,
    installedPackages.has("react") ? "React" : null,
  ].filter((item): item is string => Boolean(item));
  const isMonorepo =
    manifests.length > 1 ||
    Boolean(packageJson.workspaces) ||
    ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json"].some((file) => files.has(file));
  const publishSignals = [
    packageJson.main,
    packageJson.module,
    packageJson.types,
    packageJson.typings,
    packageJson.exports,
    packageJson.files,
    packageJson.publishConfig,
  ].some(Boolean);
  const isLibrary = packageJson.private !== true && publishSignals;
  const kinds: RepositoryKind[] = [];
  if (hasTypeScript) kinds.push("typescript");
  if (installedPackages.has("react")) kinds.push("react");
  if (installedPackages.has("next")) kinds.push("nextjs");
  kinds.push(isLibrary ? "npm-library" : "node-application");
  if (isMonorepo) kinds.push("monorepo");

  const packageManager = detectPackageManager(packageJson, files);
  const githubWorkflows = [...files].some((file) => /^\.github\/workflows\/.*\.ya?ml$/.test(file));
  const context: RepositoryContext = {
    root,
    packageManager: packageManager.packageManager,
    frameworks,
    languages: [hasTypeScript ? "TypeScript" : null, hasJavaScript ? "JavaScript" : null].filter(
      (item): item is string => Boolean(item),
    ),
    kinds,
    isMonorepo,
    packageCount: manifests.length,
    hasCI: githubWorkflows,
    packageJson,
    manifests,
    installedPackages,
    installedPackageOrigins,
    scripts: packageJson.scripts ?? {},
    files,
    sourceFiles,
    sourceRoots: detectSourceRoots(sourceFiles),
    diagnostics: packageManager.diagnostics,
  };
  if (packageManager.evidence) context.packageManagerEvidence = packageManager.evidence;
  if (githubWorkflows) context.ciProvider = "github-actions";
  return context;
}
