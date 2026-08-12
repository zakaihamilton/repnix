import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config/repo-health-config.js";
import { detectAllProviders } from "../src/providers/catalog.js";
import { createDiagnosticLogger } from "../src/cli/options.js";
import { buildAuditModel } from "../src/recommendations/recommendation-engine.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { planHealthTasks } from "../src/runners/health/task-planner.js";
import { copyFixture, fixturePath } from "./helpers.js";

describe("health task planner", () => {
  it("filters categories and emits each provider only once", async () => {
    const context = await detectRepository(fixturePath("minimal-js"));
    const { config } = await readConfig(context.root);
    const audit = buildAuditModel(context, await detectAllProviders(context), config);
    const tasks = await planHealthTasks(audit, config, { category: "tests", timeoutMs: 1_000, logger: createDiagnosticLogger({ quiet: true }) });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ provider: "script:test", category: "tests" });
    expect(new Set(tasks.map((task) => task.provider)).size).toBe(tasks.length);
  });

  it("serializes root coverage after the test command it wraps", async () => {
    const root = await copyFixture("minimal-js");
    const manifestPath = `${root}/package.json`;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { devDependencies?: Record<string, string>; scripts: Record<string, string> };
    manifest.devDependencies = { ...manifest.devDependencies, c8: "1.0.0" };
    manifest.scripts["health:coverage"] = "c8 --all npm run test";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    const context = await detectRepository(root);
    const { config } = await readConfig(context.root);
    const audit = buildAuditModel(context, await detectAllProviders(context), config);
    const tasks = await planHealthTasks(audit, config, { timeoutMs: 1_000, logger: createDiagnosticLogger({ quiet: true }) });

    expect(tasks.find((task) => task.provider === "c8")?.dependsOn).toBe("script:test");
  });
});
