import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectRepository } from "../src/repository/detect-repository.js";
import { planCiChange } from "../src/setup/ci-plan.js";
import { validateChanges, writeChanges } from "../src/setup/file-plan.js";
import { buildInstallPlan } from "../src/setup/install-plan.js";
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
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n      - run: npm ci\n      - run: npm test\n`);
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
});
