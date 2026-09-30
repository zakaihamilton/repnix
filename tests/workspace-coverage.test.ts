import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditRepository } from "../src/cli/audit.js";
import { readConfig, type RepnixConfig } from "../src/config/repo-health-config.js";
import type { PackageJson } from "../src/core/types.js";
import { runHealth } from "../src/runners/health-runner.js";
import { copyFixture } from "./helpers.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspaceRepository(
  config: Partial<RepnixConfig>,
  scripts: Record<string, string> = { lint: "eslint packages/a" },
) {
  const root = await copyFixture("pnpm-monorepo");
  temporary.push(root);
  const manifestPath = path.join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageJson;
  await writeFile(manifestPath, JSON.stringify({ ...manifest, scripts, devDependencies: { eslint: "^10.0.0" } }));
  await writeFile(path.join(root, "eslint.config.js"), "export default [];\n");
  await writeFile(path.join(root, "packages/b/src/index.ts"), "export const x = 1;\n");
  await writeFile(path.join(root, "repnix.config.json"), JSON.stringify(config));
  await mkdir(path.join(root, "node_modules/.bin"), { recursive: true });
  const binary = path.join(root, "node_modules/.bin/eslint");
  await writeFile(binary, "#!/usr/bin/env node\nprocess.exit(0);\n");
  await chmod(binary, 0o755);
  return root;
}

async function addWorkspaceLint(root: string, workspace: string, command = "eslint .") {
  const manifestPath = path.join(root, workspace, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageJson;
  await writeFile(manifestPath, JSON.stringify({ ...manifest, scripts: { lint: command } }));
}

async function checkLint(root: string) {
  const audit = await auditRepository(root, { quiet: true });
  const { config } = await readConfig(root);
  return { audit, run: await runHealth(audit, config, { category: "lint", quiet: true }) };
}

describe("workspace coverage", () => {
  it.each([
    ["types", "typecheck", "tsc --noEmit"],
    ["lint", "lint", "eslint packages/a"],
    ["format", "format:check", "prettier --check packages/a"],
    ["tests", "test:run", "node --test"],
  ] as const)("does not credit a root %s command to unchecked workspaces", async (category, script, command) => {
    const root = await workspaceRepository({}, { [script]: command });
    const audit = await auditRepository(root, { quiet: true });
    expect(audit.coverage.find((entry) => entry.category === category)).toMatchObject({
      status: "partial",
      scopeCoverage: expect.arrayContaining([
        expect.objectContaining({ scope: ".", status: "covered" }),
        expect.objectContaining({ scope: "packages/b", status: "missing" }),
      ]),
    });
  });

  it("fails missing required workspace coverage even when the root command passes", async () => {
    const root = await workspaceRepository({
      scopes: { "packages/b": { categories: { lint: { mode: "required" } } } },
    });
    const { run } = await checkLint(root);
    expect(run.summary.exitCode).toBe(2);
    expect(run.results).toContainEqual(expect.objectContaining({ provider: "script:lint", status: "pass" }));
    expect(run.results).toContainEqual(
      expect.objectContaining({ scope: "packages/b", category: "lint", status: "error" }),
    );
  });

  it("only requires the configured workspace and credits its scheduled check", async () => {
    const root = await workspaceRepository({
      scopes: { "packages/a": { categories: { lint: { mode: "required" } } } },
    });
    await addWorkspaceLint(root, "packages/a");
    const { audit, run } = await checkLint(root);
    expect(audit.coverage.find((entry) => entry.category === "lint")?.status).toBe("partial");
    expect(run.summary.exitCode).toBe(0);
    expect(run.results).toContainEqual(
      expect.objectContaining({ provider: "workspace:packages/a:lint", status: "pass", scope: "packages/a" }),
    );
  });

  it("allows a workspace to require a check when the repository default is off", async () => {
    const root = await workspaceRepository({
      categories: { lint: { mode: "off" } },
      scopes: { "packages/b": { categories: { lint: { mode: "required" } } } },
    });
    await addWorkspaceLint(root, "packages/b");
    const { audit, run } = await checkLint(root);
    expect(audit.coverage.find((entry) => entry.category === "lint")?.status).toBe("covered");
    expect(run.summary.exitCode).toBe(0);
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ provider: "workspace:packages/b:lint", status: "pass" });
  });

  it("respects off overrides when the repository requires a category", async () => {
    const root = await workspaceRepository({
      categories: { lint: { mode: "required" } },
      scopes: { "packages/b": { categories: { lint: { mode: "off" } } } },
    });
    await addWorkspaceLint(root, "packages/a");
    const { audit, run } = await checkLint(root);
    expect(audit.coverage.find((entry) => entry.category === "lint")?.status).toBe("covered");
    expect(run.summary.exitCode).toBe(0);
    expect(run.results.some((result) => result.scope === "packages/b")).toBe(false);
  });

  it("does not credit or execute a mutating workspace script", async () => {
    const root = await workspaceRepository({
      scopes: { "packages/b": { categories: { lint: { mode: "required" } } } },
    });
    await addWorkspaceLint(root, "packages/b", "eslint . --fix");
    const { run } = await checkLint(root);
    expect(run.summary.exitCode).toBe(2);
    expect(run.results.some((result) => result.provider === "workspace:packages/b:lint")).toBe(false);
  });

  it("does not require a duplicate root check when every source workspace is covered", async () => {
    const root = await workspaceRepository({ categories: { lint: { mode: "required" } } }, {});
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageJson;
    delete manifest.devDependencies;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await rm(path.join(root, "eslint.config.js"));
    await addWorkspaceLint(root, "packages/a");
    await addWorkspaceLint(root, "packages/b");
    const { audit, run } = await checkLint(root);
    expect(audit.coverage.find((entry) => entry.category === "lint")).toMatchObject({
      status: "covered",
      scopes: ["packages/a", "packages/b"],
    });
    expect(run.summary.exitCode).toBe(0);
    expect(run.results).toHaveLength(2);
  });
});
