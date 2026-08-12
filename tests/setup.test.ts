import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createDiagnosticLogger } from "../src/cli/options.js";
import { readConfig } from "../src/config/repo-health-config.js";
import { detectAllProviders } from "../src/providers/catalog.js";
import { markdownlintScriptCommand } from "../src/providers/markdownlint/command.js";
import { buildAuditModel } from "../src/recommendations/recommendation-engine.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { runHealth } from "../src/runners/health-runner.js";
import { planCiChange } from "../src/setup/ci-plan.js";
import { fileChange, renderFileDiff, resolveRepositoryPath, validateChanges, writeChanges } from "../src/setup/file-plan.js";
import { buildInstallPlan } from "../src/setup/install-plan.js";
import { applyInstallPlan } from "../src/setup/apply-plan.js";
import { assertSavedPlanMatches, parseSavedInstallPlan, serializeInstallPlan } from "../src/setup/saved-plan.js";
import { copyFixture } from "./helpers.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("setup planning", () => {
  it("renders a compact, width-bounded diff with nearby context", () => {
    const before = ["{", '  "scripts": {', '    "test": "vitest run",', '    "old": "remove me",', "  },", '  "name": "demo",', '  "description": "a line far from the change",', '  "keywords": ["demo"],', '  "license": "MIT",', "}"].join("\n");
    const after = ["{", '  "scripts": {', '    "test": "vitest run",', '    "health": "repnix check",', "  },", '  "name": "demo",', '  "description": "a line far from the change",', '  "keywords": ["demo"],', '  "license": "MIT",', "}"].join("\n");

    const output = renderFileDiff(fileChange("package.json", before, after, "Add health script")!, 40);

    expect(output).toContain("M package.json (+1 -1)");
    expect(output).toContain('+    "health": "repnix check",');
    expect(output).toContain("unchanged line");
    expect(output.split("\n").every((line) => stripVTControlCharacters(line).length <= 40)).toBe(true);
    expect(output).not.toContain('"description": "a line far from the change"');
  });

  it("rejects planned file paths outside the repository", () => {
    expect(() => resolveRepositoryPath("/tmp/repository", "../outside.txt")).toThrow("must stay inside the repository");
    expect(() => resolveRepositoryPath("/tmp/repository", "/tmp/outside.txt")).toThrow("must stay inside the repository");
    expect(resolveRepositoryPath("/tmp/repository", "nested/file.txt")).toBe(path.join("/tmp/repository", "nested/file.txt"));
  });

  it("rejects planned writes through a symbolic-link directory", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const outside = await copyFixture("minimal-js");
    temporary.push(outside);
    await symlink(outside, path.join(root, "linked-directory"));
    const change = fileChange("linked-directory/escape.json", null, "{}\n", "test symlink containment")!;

    await expect(validateChanges(root, [change])).rejects.toThrow("symbolic link");
    await expect(writeChanges(root, [change])).rejects.toThrow("symbolic link");
  });

  it("requires saved setup plans to match a regenerated plan exactly", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const plan = await buildInstallPlan(await detectRepository(root), ["knip"], false);
    const saved = serializeInstallPlan(plan, { providers: ["knip"], includeCi: false });
    expect(parseSavedInstallPlan(saved)).toEqual(saved);
    assertSavedPlanMatches(saved, plan);

    const tampered = { ...saved, commands: [{ command: process.execPath, args: ["-e", "process.exit(99)"], reason: "tampered" }] };
    expect(() => assertSavedPlanMatches(parseSavedInstallPlan(tampered), plan)).toThrow("no longer matches");
  });

  it("previews minimal scripts/config and is file-idempotent", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const context = await detectRepository(root);
    const plan = await buildInstallPlan(context, ["knip", "jscpd"], false);
    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "knip", "jscpd"]);
    expect(plan.files.map((item) => item.path)).toEqual(["package.json", ".gitignore", "repnix.config.json", ".jscpd.json"]);
    expect(plan.files.find((item) => item.path === ".gitignore")?.after).toBe(".repnix/\n");
    await validateChanges(root, plan.files);
    await writeChanges(root, plan.files);
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts).toMatchObject({ health: "repnix check", "health:dead-code": "knip", "health:duplication": "jscpd src" });
    const second = await buildInstallPlan(await detectRepository(root), ["knip", "jscpd"], false);
    expect(second.files).toEqual([]);
  });

  it("adds the RepNix report directory to an existing gitignore without duplicating it", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const gitignorePath = path.join(root, ".gitignore");
    await writeFile(gitignorePath, "node_modules/\n");

    const plan = await buildInstallPlan(await detectRepository(root), ["knip"], false);
    expect(plan.files.find((item) => item.path === ".gitignore")).toMatchObject({
      kind: "modify",
      after: "node_modules/\n.repnix/\n",
    });

    await writeChanges(root, plan.files);
    const second = await buildInstallPlan(await detectRepository(root), ["knip"], false);
    expect(second.files.find((item) => item.path === ".gitignore")).toBeUndefined();
  });

  it("adds report-only c8 coverage around a safe test script", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const plan = await buildInstallPlan(await detectRepository(root), ["c8"], false);

    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "c8"]);
    expect(plan.files.find((item) => item.path === "package.json")?.after).toContain('"health:coverage": "c8 --all --reporter=text npm run test"');
    expect(plan.files.find((item) => item.path === "repnix.config.json")).toBeDefined();
  });

  it("excludes dependency and generated Markdown from documentation checks", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const plan = await buildInstallPlan(await detectRepository(root), ["markdownlint"], false);
    const packageChange = plan.files.find((item) => item.path === "package.json");
    expect(packageChange).toBeDefined();
    const packageJson = JSON.parse(packageChange!.after) as { scripts: Record<string, string> };
    expect(packageJson.scripts["health:documentation"]).toBe(markdownlintScriptCommand());
    expect(packageJson.scripts["health:documentation"]).toContain("#node_modules");
    expect(packageJson.scripts["health:documentation"]).toContain("#playwright-report");
  });

  it("upgrades previous generated Markdown scripts without replacing custom scripts", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const manifestPath = path.join(root, "package.json");
    const expected = markdownlintScriptCommand();
    for (const previous of ["markdownlint-cli2 \"**/*.md\"", "markdownlint-cli2 \"**/*.md\" \"#node_modules\""]) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { scripts: Record<string, string> };
      manifest.scripts["health:documentation"] = previous;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const plan = await buildInstallPlan(await detectRepository(root), ["markdownlint"], false);
      const packageJson = JSON.parse(plan.files.find((item) => item.path === "package.json")!.after) as { scripts: Record<string, string> };
      expect(packageJson.scripts["health:documentation"]).toBe(expected);
      expect(plan.conflicts).not.toContain("package.json script 'health:documentation' already exists and was preserved.");
    }
  });

  it("runs report-only c8 and adds configured thresholds when a policy exists", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const plan = await buildInstallPlan(await detectRepository(root), ["c8"], false);
    await writeChanges(root, plan.files);
    const binDirectory = path.join(root, "node_modules", ".bin");
    await mkdir(binDirectory, { recursive: true });
    const argsPath = path.join(root, "c8-args.txt");
    const binary = path.join(binDirectory, "c8");
    await writeFile(binary, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(argsPath)}\n`);
    await chmod(binary, 0o755);

    const context = await detectRepository(root);
    const { config } = await readConfig(root);
    const audit = buildAuditModel(context, await detectAllProviders(context), config);
    const report = await runHealth(audit, config, { category: "coverage", logger: createDiagnosticLogger({ quiet: true }) });
    expect(report.results).toContainEqual(expect.objectContaining({ provider: "c8", status: "pass" }));
    expect(await readFile(argsPath, "utf8")).toContain("--all --reporter=text npm run test");

    const withThreshold = { ...config, policies: { coverage: { lines: 80 } } };
    await runHealth(audit, withThreshold, { category: "coverage", logger: createDiagnosticLogger({ quiet: true }) });
    expect(await readFile(argsPath, "utf8")).toContain("--check-coverage --lines 80 npm run test");
  });

  it("creates Changesets config only with a resolved remote default branch", async () => {
    const root = await copyFixture("npm-library");
    temporary.push(root);
    const context = await detectRepository(root);
    const withoutBranch = await buildInstallPlan(context, ["changesets"], false);
    expect(withoutBranch.packages.map((item) => item.name)).toEqual(["repnix"]);
    expect(withoutBranch.conflicts).toContain("Changesets needs the Git remote default branch, which could not be resolved safely.");

    context.gitDefaultBranch = "main";
    const withBranch = await buildInstallPlan(context, ["changesets"], false);
    expect(withBranch.packages.map((item) => item.name)).toEqual(["repnix", "@changesets/cli"]);
    expect(withBranch.files.find((item) => item.path === ".changeset/config.json")?.after).toContain('"baseBranch": "main"');
    expect(withBranch.files.find((item) => item.path === "package.json")?.after).toContain('"health:release": "changeset status"');
  });

  it("adds jsx-a11y to a legacy JSON ESLint configuration without duplicates", async () => {
    const root = await copyFixture("react-eslint");
    temporary.push(root);
    await rm(path.join(root, "eslint.config.js"));
    await writeFile(path.join(root, ".eslintrc.json"), `{\n  // Existing comments stay intact.\n  "plugins": ["react"],\n  "extends": "eslint:recommended"\n}\n`);

    const context = await detectRepository(root);
    expect(context.editableLegacyEslintConfig).toBe(true);
    const { config } = await readConfig(root);
    context.scopes = context.scopes.map((scope) => ({ ...scope, roles: ["web-app"] }));
    const audit = buildAuditModel(context, await detectAllProviders(context), config);
    expect(audit.recommendations.find((item) => item.provider === "jsx-a11y")).toMatchObject({ actionable: true, priority: "baseline" });

    const plan = await buildInstallPlan(context, ["jsx-a11y"], false);
    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "eslint-plugin-jsx-a11y"]);
    const eslint = plan.files.find((item) => item.path === ".eslintrc.json")?.after;
    expect(eslint).toContain("// Existing comments stay intact.");
    expect(eslint).toContain('"jsx-a11y"');
    expect(eslint).toContain('"plugin:jsx-a11y/recommended"');

    await writeChanges(root, plan.files);
    const repeated = await buildInstallPlan(await detectRepository(root), ["jsx-a11y"], false);
    expect(repeated.files.some((item) => item.path === ".eslintrc.json")).toBe(false);
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

  it("inserts CI after the matching package-manager install step", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n      - run: yarn install --frozen-lockfile\n      - run: yarn test\n  docs:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm install\n      - run: npm test\n`);

    const planned = await planCiChange(await detectRepository(root), "yarn");

    expect(planned.warning).toBeUndefined();
    expect(planned.change?.after).toContain("- run: yarn install --frozen-lockfile\n      - name: Repository health\n        run: yarn run health");
    expect(planned.change?.after).not.toContain("- run: npm install\n      - name: Repository health");
  });

  it("accepts a workflow without setup-node when checkout and install are unambiguous", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm test\n`);

    const planned = await planCiChange(await detectRepository(root), "pnpm");

    expect(planned.warning).toBeUndefined();
    expect(planned.change?.after).toContain("- run: pnpm install --frozen-lockfile\n      - name: Repository health");
  });

  it("recognizes Corepack Yarn installs and prefers the test job", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), `jobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: corepack yarn --immutable\n      - run: yarn lint\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: corepack yarn install\n      - run: corepack yarn test\n`);

    const planned = await planCiChange(await detectRepository(root), "yarn");

    expect(planned.warning).toBeUndefined();
    expect(planned.change?.after).toContain("- run: corepack yarn install\n      - name: Repository health\n        run: yarn run health");
    expect(planned.change?.after).not.toContain("- run: corepack yarn --immutable\n      - name: Repository health");
  });

  it("uses the package manager that the selected CI job actually installs", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), `jobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci --ignore-scripts\n      - run: npm test\n`);

    const planned = await planCiChange(await detectRepository(root), "yarn");

    expect(planned.warning).toBeUndefined();
    expect(planned.change?.after).toContain("- run: npm ci --ignore-scripts\n      - name: Repository health\n        run: npm run health");
  });

  it("explains which jobs are ambiguous when their CI purpose ties", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm install\n      - run: npm test\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm install\n      - run: npm check\n`);

    const planned = await planCiChange(await detectRepository(root), "npm");

    expect(planned.change).toBeNull();
    expect(planned.warning).toContain("Candidates: .github/workflows/ci.yml#test (npm), .github/workflows/ci.yml#check (npm).");
  });

  it("does not warn when a health step already exists", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(root, ".github", "workflows", "ci.yml"), `jobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm install\n      - run: npm run health\n`);

    const planned = await planCiChange(await detectRepository(root), "npm");

    expect(planned.warning).toBeUndefined();
    expect(planned.change).toBeNull();
  });

  it("plans conservative dependency-cruiser rules without inferring repository layers", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const plan = await buildInstallPlan(await detectRepository(root), ["dependency-cruiser"], false);
    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "dependency-cruiser"]);
    expect(plan.files.map((item) => item.path)).toEqual(["package.json", ".gitignore", "repnix.config.json", ".dependency-cruiser.cjs"]);
    expect(plan.files.find((item) => item.path === "package.json")?.after).toContain('"health:architecture": "depcruise --output-type json --config -- src"');
    expect(plan.files.find((item) => item.path === ".dependency-cruiser.cjs")?.after).toContain("no-source-to-test");
  });

  it("plans complementary package-health providers without shared script conflicts", async () => {
    const root = await copyFixture("npm-library");
    temporary.push(root);
    const plan = await buildInstallPlan(await detectRepository(root), ["publint", "attw"], false);
    expect(plan.packages.map((item) => item.name)).toEqual(["repnix", "publint", "@arethetypeswrong/cli"]);
    expect(plan.files).toHaveLength(3);
    expect(plan.files.find((item) => item.path === ".gitignore")?.after).toBe(".repnix/\n");
    expect(plan.files.find((item) => item.path === "package.json")?.after).toContain('"health:package:publint": "publint"');
    expect(plan.files.find((item) => item.path === "package.json")?.after).toContain('"health:package:types": "attw --pack ."');
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
    const progress: string[] = [];
    const plan = {
      schemaVersion: 1 as const,
      packages: [],
      files: [fileChange("package.json", before, after, "test rollback")!],
      commands: [{ command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('package-lock.json', 'changed'); process.exit(1)"], reason: "test failure" }],
      warnings: [],
      conflicts: [],
    };

    await expect(applyInstallPlan(context, plan, createDiagnosticLogger({ quiet: true }), 1000, (event) => progress.push(event.phase))).rejects.toThrow("rolled back");
    expect(progress).toEqual(["validating", "snapshotting", "writing-files", "running-command", "rollback"]);
    expect(await readFile(packagePath, "utf8")).toBe(before);
    expect(await readFile(lockfilePath, "utf8")).toBe(lockfileBefore);
  });

  it("restores a binary Bun lockfile byte-for-byte when installation fails", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const lockfilePath = path.join(root, "bun.lockb");
    const before = Buffer.from([0, 255, 128, 65, 10]);
    await writeFile(lockfilePath, before);
    const context = await detectRepository(root);
    const plan = {
      schemaVersion: 1 as const,
      packages: [],
      files: [],
      commands: [{ command: process.execPath, args: ["-e", "require('node:fs').writeFileSync('bun.lockb', 'changed'); process.exit(1)"], reason: "test failure" }],
      warnings: [],
      conflicts: [],
    };

    await expect(applyInstallPlan(context, plan, createDiagnosticLogger({ quiet: true }), 1000)).rejects.toThrow("rolled back");
    expect(await readFile(lockfilePath)).toEqual(before);
  });
});
