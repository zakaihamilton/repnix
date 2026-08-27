import { describe, expect, it } from "vitest";
import { formatFixPlan, resolveFixTasks, categoriesToVerify } from "../src/cli/fix.js";
import type { AuditModel } from "../src/recommendations/recommendation-engine.js";
import type { RepositoryContext } from "../src/core/types.js";
import { createBuiltinRegistry } from "../src/providers/registry.js";

function mockContext(overrides: Partial<RepositoryContext> = {}): RepositoryContext {
  return {
    root: "/mock/repo",
    packageManager: "pnpm",
    frameworks: [],
    languages: ["TypeScript"],
    kinds: ["typescript", "node-application"],
    isMonorepo: false,
    packageCount: 1,
    hasCI: false,
    packageJson: { name: "mock-pkg" },
    manifests: [],
    installedPackages: new Map(),
    installedPackageOrigins: new Map(),
    scripts: {},
    files: new Set(),
    sourceFiles: ["src/index.ts"],
    sourceRoots: ["src"],
    scopes: [],
    diagnostics: [],
    ...overrides,
  };
}

function mockAudit(
  context: RepositoryContext,
  detections: Map<string, AuditModel["detections"] extends Map<string, infer T> ? T : never> = new Map(),
): AuditModel {
  return {
    context,
    detections,
    coverage: [],
    recommendations: [],
    registry: createBuiltinRegistry(),
  };
}

describe("resolveFixTasks", () => {
  it("resolves formatting script when format script exists", () => {
    const tasks = resolveFixTasks(mockAudit(mockContext({ scripts: { format: "prettier --write ." } })));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("format");
    expect(tasks[0]?.category).toBe("format");
    expect(tasks[0]?.command).toBe("pnpm");
    expect(tasks[0]?.args).toEqual(["run", "format"]);
  });

  it("prefers Prettier over Oxfmt and Biome when several formatters are active", () => {
    const detections = new Map([
      [
        "eslint",
        {
          installed: true,
          configured: true,
          configFiles: ["eslint.config.js"],
          evidence: [],
          availableCapabilities: { linting: true },
          activeCapabilities: { linting: true },
        },
      ],
      [
        "prettier",
        {
          installed: true,
          configured: true,
          configFiles: [".prettierrc"],
          evidence: [],
          availableCapabilities: { formatting: true },
          activeCapabilities: { formatting: true },
        },
      ],
      [
        "oxfmt",
        {
          installed: true,
          configured: true,
          configFiles: [],
          evidence: [],
          availableCapabilities: { formatting: true },
          activeCapabilities: { formatting: true },
        },
      ],
    ]);

    const tasks = resolveFixTasks(mockAudit(mockContext({ packageManager: "npm" }), detections));
    expect(tasks.map((task) => task.name)).toEqual(["prettier", "eslint"]);
    expect(tasks[0]?.args).toEqual(["exec", "--", "prettier", "--write", "."]);
  });

  it("resolves Oxfmt when it is the active formatter", () => {
    const detections = new Map([
      [
        "oxfmt",
        {
          installed: true,
          configured: true,
          configFiles: [],
          evidence: [],
          availableCapabilities: { formatting: true },
          activeCapabilities: { formatting: true },
        },
      ],
    ]);

    const tasks = resolveFixTasks(mockAudit(mockContext({ packageManager: "npm" }), detections));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("oxfmt");
    expect(tasks[0]?.description).toBe("Format files with Oxfmt");
    expect(tasks[0]?.args).toEqual(["exec", "--", "oxfmt", "."]);
  });

  it("filters tasks by category", () => {
    const audit = mockAudit(
      mockContext({
        scripts: {
          format: "prettier --write .",
          "lint:fix": "eslint . --fix",
        },
      }),
    );

    const formatTasks = resolveFixTasks(audit, "format");
    expect(formatTasks).toHaveLength(1);
    expect(formatTasks[0]?.category).toBe("format");

    const lintTasks = resolveFixTasks(audit, "lint");
    expect(lintTasks).toHaveLength(1);
    expect(lintTasks[0]?.category).toBe("lint");

    const docTasks = resolveFixTasks(audit, "documentation");
    expect(docTasks).toHaveLength(0);
  });

  it("prints a preview of the commands that will run", () => {
    const tasks = resolveFixTasks(mockAudit(mockContext({ scripts: { format: "prettier --write ." } })));
    expect(formatFixPlan(tasks)).toContain("Applying 1 automated fix:");
    expect(formatFixPlan(tasks)).toContain("pnpm run format");
  });

  it("collects unique categories from applied tasks in order", () => {
    expect(
      categoriesToVerify([
        { name: "format", category: "format", description: "", command: "pnpm", args: ["run", "format"] },
        { name: "eslint", category: "lint", description: "", command: "pnpm", args: ["exec", "eslint"] },
        { name: "prettier", category: "format", description: "", command: "pnpm", args: ["exec", "prettier"] },
      ]),
    ).toEqual(["format", "lint"]);
  });
});
