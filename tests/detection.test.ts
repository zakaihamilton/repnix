import { rm, writeFile } from "node:fs/promises";
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
    const providers = detectAllProviders(context);
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
    expect(detectAllProviders(next).get("biome")?.activeCapabilities).toMatchObject({ linting: true, formatting: true });
    expect(library.kinds).toContain("npm-library");
    expect(monorepo).toMatchObject({ packageManager: "pnpm", isMonorepo: true, packageCount: 3 });
    expect(monorepo.installedPackageOrigins.get("typescript")).toContain("packages/a/package.json");
  });

  it("reports conflicting lockfiles instead of guessing", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await writeFile(path.join(root, "yarn.lock"), "# stale\n");
    const context = await detectRepository(root);
    expect(context.packageManager).toBeNull();
    expect(context.diagnostics).toContainEqual(expect.objectContaining({ code: "ambiguous-package-manager", severity: "error" }));
  });
});
