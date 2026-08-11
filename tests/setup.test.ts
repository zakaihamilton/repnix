import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiagnosticLogger } from "../src/cli/options.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { planCiChange } from "../src/setup/ci-plan.js";
import { fileChange, validateChanges, writeChanges } from "../src/setup/file-plan.js";
import { buildInstallPlan } from "../src/setup/install-plan.js";
import { applyInstallPlan } from "../src/setup/apply-plan.js";
import { copyFixture } from "./helpers.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("setup planning", () => {
  it("previews minimal scripts/config and is file-idempotent", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const context = await detectRepository(root);
    const plan = await buildInstallPlan(context, ["knip", "jscpd"], false);
    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "knip", "jscpd"]);
    expect(plan.files.map((item) => item.path)).toEqual(["package.json", ".jscpd.json"]);
    await validateChanges(root, plan.files);
    await writeChanges(root, plan.files);
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts).toMatchObject({ health: "repnix check", "health:dead-code": "knip", "health:duplication": "jscpd src" });
    const second = await buildInstallPlan(await detectRepository(root), ["knip", "jscpd"], false);
    expect(second.files).toEqual([]);
  });

  it("preserves conflicting user scripts", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { scripts: Record<string, string> };
    manifest.scripts.health = "custom-health";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const plan = await buildInstallPlan(await detectRepository(root), ["knip"], false);
    expect(plan.conflicts).toContain("package.json script 'health' already exists and was preserved.");
    expect(plan.files[0]?.after).toContain('"health": "custom-health"');
  });

  it("adds CI only when a workflow is unambiguous", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n      - run: npm ci --ignore-scripts\n      - run: npm test\n`);
    const context = await detectRepository(root);
    const planned = await planCiChange(context, "npm");
    expect(planned.change?.after).toContain("name: Repository health\n        run: npm run health");
  });

  it("plans conservative dependency-cruiser rules without inferring repository layers", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const plan = await buildInstallPlan(await detectRepository(root), ["dependency-cruiser"], false);
    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "dependency-cruiser"]);
    expect(plan.files.map((item) => item.path)).toEqual(["package.json", ".dependency-cruiser.cjs"]);
    expect(plan.files.find((item) => item.path === "package.json")?.after).toContain('"health:architecture": "depcruise --output-type json --config -- src"');
    expect(plan.files.find((item) => item.path === ".dependency-cruiser.cjs")?.after).toContain("no-source-to-test");
  });

  it("plans complementary package-health providers without shared script conflicts", async () => {
    const root = await copyFixture("npm-library");
    temporary.push(root);
    const plan = await buildInstallPlan(await detectRepository(root), ["publint", "attw"], false);
    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "publint", "@arethetypeswrong/cli"]);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]?.after).toContain('"health:package:publint": "publint"');
    expect(plan.files[0]?.after).toContain('"health:package:types": "attw --pack ."');
    expect(plan.conflicts).toEqual([]);
  });

  it("installs providers at the workspace root when they only exist in a child", async () => {
    const root = await copyFixture("pnpm-monorepo");
    temporary.push(root);
    const childManifestPath = path.join(root, "packages", "a", "package.json");
    const childManifest = JSON.parse(await readFile(childManifestPath, "utf8")) as { devDependencies: Record<string, string> };
    childManifest.devDependencies.knip = "^5.0.0";
    await writeFile(childManifestPath, `${JSON.stringify(childManifest)}\n`);

    const plan = await buildInstallPlan(await detectRepository(root), ["knip"], false);
    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "knip"]);
  });

  it("rolls back planned files when package installation fails", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const packagePath = path.join(root, "package.json");
    const lockfilePath = path.join(root, "package-lock.json");
    const before = await readFile(packagePath, "utf8");
    const lockfileBefore = await readFile(lockfilePath, "utf8");
    const after = `${before.trimEnd()} \n`;
    const context = await detectRepository(root);
    const plan = {
      packages: [],
      files: [fileChange("package.json", before, after, "test rollback")!],
      commands: [{ command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('package-lock.json', 'changed'); process.exit(1)"], reason: "test failure" }],
      warnings: [],
      conflicts: [],
    };

    await expect(applyInstallPlan(context, plan, createDiagnosticLogger({ quiet: true }), 1000)).rejects.toThrow("rolled back");
    expect(await readFile(packagePath, "utf8")).toBe(before);
    expect(await readFile(lockfilePath, "utf8")).toBe(lockfileBefore);
  });
});
