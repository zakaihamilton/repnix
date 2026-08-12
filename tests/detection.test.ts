import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectAllProviders } from "../src/providers/catalog.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { copyFixture, fixturePath } from "./helpers.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("repository detection", () => {
  it("detects a React TypeScript project and its existing providers", async () => {
    const context = await detectRepository(fixturePath("react-eslint"));
    const providers = await detectAllProviders(context);
    expect(context.packageManager).toBe("npm");
    expect(context.kinds).toEqual(expect.arrayContaining(["react", "typescript", "node-application"]));
    expect(context.frameworks).toContain("React");
    expect(providers.get("eslint")).toMatchObject({ installed: true, configured: true });
    expect(providers.get("vitest")?.activeCapabilities.testing).toBe(true);
  });

  it("classifies Next, libraries, and workspaces", async () => {
    const next = await detectRepository(fixturePath("next-biome"));
    const library = await detectRepository(fixturePath("npm-library"));
    const monorepo = await detectRepository(fixturePath("pnpm-monorepo"));
    expect(next.kinds).toEqual(expect.arrayContaining(["nextjs", "react"]));
    expect((await detectAllProviders(next)).get("biome")?.activeCapabilities).toMatchObject({ linting: true, formatting: true });
    expect(library.kinds).toContain("npm-library");
    expect(monorepo).toMatchObject({ packageManager: "pnpm", isMonorepo: true, packageCount: 3 });
    expect(monorepo.installedPackageOrigins.get("typescript")).toContain("packages/a/package.json");
    expect(monorepo.workspaceRoots).toEqual([".", "packages/a", "packages/b"]);
    expect(monorepo.workspaceSourceFiles?.["packages/a"]).toContain("packages/a/src/index.ts");
    expect((await detectAllProviders(monorepo)).get("syncpack")?.activeCapabilities.workspaceConsistency).toBeUndefined();
  });

  it("reports conflicting lockfiles instead of guessing", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await writeFile(path.join(root, "yarn.lock"), "# stale\n");
    const context = await detectRepository(root);
    expect(context.packageManager).toBeNull();
    expect(context.diagnostics).toContainEqual(expect.objectContaining({ code: "ambiguous-package-manager", severity: "error" }));
  });

  it("does not credit installed architecture or bundle tools until rules and budgets are active", async () => {
    const root = await copyFixture("react-eslint");
    temporary.push(root);
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { devDependencies: Record<string, string>; [key: string]: unknown };
    manifest.devDependencies["eslint-plugin-boundaries"] = "^6.0.0";
    manifest.devDependencies["size-limit"] = "^12.0.0";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    let providers = await detectAllProviders(await detectRepository(root));
    expect(providers.get("eslint-boundaries")?.availableCapabilities.architectureRules).toBe(true);
    expect(providers.get("eslint-boundaries")?.activeCapabilities.architectureRules).toBeUndefined();
    expect(providers.get("size-limit")?.activeCapabilities.bundleBudget).toBeUndefined();

    await writeFile(path.join(root, "eslint.config.js"), `export default [{ rules: { "boundaries/dependencies": "error" } }];\n`);
    manifest["size-limit"] = [{ path: "dist/app.js", limit: "10 kB" }];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    providers = await detectAllProviders(await detectRepository(root));
    expect(providers.get("eslint-boundaries")?.activeCapabilities.architectureRules).toBe(true);
    expect(providers.get("size-limit")?.activeCapabilities.bundleBudget).toBe(true);
  });

  it("accepts UTF-8 BOM manifests and credits real test scripts conservatively", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { scripts: Record<string, string> };
    manifest.scripts.test = "mocha test";
    await writeFile(manifestPath, `\uFEFF${JSON.stringify(manifest, null, 2)}\n`);

    let providers = await detectAllProviders(await detectRepository(root));
    expect(providers.get("test-script")?.activeCapabilities.testing).toBe(true);
    expect(providers.get("test-script")?.evidence).toContain("script:test");

    manifest.scripts.test = "pnpm prettier:check";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    providers = await detectAllProviders(await detectRepository(root));
    expect(providers.get("test-script")?.activeCapabilities.testing).toBeUndefined();

    manifest.scripts.test = "npm install";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    providers = await detectAllProviders(await detectRepository(root));
    expect(providers.get("test-script")?.activeCapabilities.testing).toBeUndefined();
  });

  it("does not offer legacy ESLint automation when a flat config is present", async () => {
    const root = await copyFixture("react-eslint");
    temporary.push(root);
    await writeFile(path.join(root, ".eslintrc.json"), `{ "extends": "eslint:recommended" }\n`);

    const context = await detectRepository(root);
    expect(context.editableLegacyEslintConfig).toBeUndefined();
  });

  it("detects Oxfmt and suppresses redundant generic test-script coverage", async () => {
    const root = await copyFixture("react-eslint");
    temporary.push(root);
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    manifest.devDependencies.oxfmt = "^0.61.0";
    manifest.scripts.format = "oxfmt";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const providers = await detectAllProviders(await detectRepository(root));
    expect(providers.get("oxfmt")?.activeCapabilities.formatting).toBe(true);
    expect(providers.get("vitest")?.activeCapabilities.testing).toBe(true);
    expect(providers.get("test-script")?.activeCapabilities.testing).toBeUndefined();
  });

  it("does not mistake another coverage provider's script for c8", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { scripts: Record<string, string>; devDependencies?: Record<string, string> };
    manifest.devDependencies ??= {};
    manifest.devDependencies.vitest = "^3.0.0";
    manifest.scripts["test:coverage"] = "vitest run --coverage";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const providers = await detectAllProviders(await detectRepository(root));
    expect(providers.get("c8")?.activeCapabilities.testCoverage).toBeUndefined();
  });

  it("credits configured accessibility rules and workspace consistency", async () => {
    const reactRoot = await copyFixture("react-eslint");
    temporary.push(reactRoot);
    const reactManifestPath = path.join(reactRoot, "package.json");
    const reactManifest = JSON.parse(await readFile(reactManifestPath, "utf8")) as { devDependencies: Record<string, string> };
    reactManifest.devDependencies["eslint-plugin-jsx-a11y"] = "^6.10.2";
    await writeFile(reactManifestPath, `${JSON.stringify(reactManifest, null, 2)}\n`);
    await writeFile(path.join(reactRoot, "eslint.config.js"), `export default [{ plugins: { "jsx-a11y": {} }, rules: { "jsx-a11y/alt-text": "error" } }];\n`);
    const reactProviders = await detectAllProviders(await detectRepository(reactRoot));
    expect(reactProviders.get("jsx-a11y")?.activeCapabilities.accessibilityRules).toBe(true);

    const monorepo = await detectRepository(fixturePath("pnpm-monorepo"));
    monorepo.installedPackages.set("syncpack", "^14.0.0");
    monorepo.installedPackageOrigins.set("syncpack", ["package.json"]);
    expect((await detectAllProviders(monorepo)).get("syncpack")?.activeCapabilities.workspaceConsistency).toBe(true);
  });
});
