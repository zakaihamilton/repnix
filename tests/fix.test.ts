import { describe, expect, it } from "vitest";
import { resolveFixTasks } from "../src/cli/fix.js";
import type { AuditModel } from "../src/recommendations/recommendation-engine.js";
import type { RepositoryContext } from "../src/core/types.js";

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

describe("resolveFixTasks", () => {
  it("resolves formatting script when format script exists", () => {
    const context = mockContext({
      scripts: { format: "prettier --write ." },
    });
    const audit: AuditModel = {
      context,
      detections: new Map(),
      coverage: [],
      recommendations: [],
    };

    const tasks = resolveFixTasks(audit);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.name).toBe("format");
    expect(tasks[0]?.category).toBe("format");
    expect(tasks[0]?.command).toBe("pnpm");
    expect(tasks[0]?.args).toEqual(["run", "format"]);
  });

  it("resolves biome and eslint fixes based on active capabilities", () => {
    const context = mockContext({
      packageManager: "npm",
    });
    const detections = new Map();
    detections.set("eslint", {
      installed: true,
      configured: true,
      configFiles: ["eslint.config.js"],
      evidence: [],
      availableCapabilities: { linting: true },
      activeCapabilities: { linting: true },
    });
    detections.set("prettier", {
      installed: true,
      configured: true,
      configFiles: [".prettierrc"],
      evidence: [],
      availableCapabilities: { formatting: true },
      activeCapabilities: { formatting: true },
    });

    const audit: AuditModel = {
      context,
      detections,
      coverage: [],
      recommendations: [],
    };

    const tasks = resolveFixTasks(audit);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.name).toBe("prettier-format");
    expect(tasks[1]?.name).toBe("eslint-fix");
  });

  it("filters tasks by category", () => {
    const context = mockContext({
      scripts: {
        format: "prettier --write .",
        "lint:fix": "eslint . --fix",
      },
    });
    const audit: AuditModel = {
      context,
      detections: new Map(),
      coverage: [],
      recommendations: [],
    };

    const formatTasks = resolveFixTasks(audit, "format");
    expect(formatTasks).toHaveLength(1);
    expect(formatTasks[0]?.category).toBe("format");

    const lintTasks = resolveFixTasks(audit, "lint");
    expect(lintTasks).toHaveLength(1);
    expect(lintTasks[0]?.category).toBe("lint");

    const docTasks = resolveFixTasks(audit, "documentation");
    expect(docTasks).toHaveLength(0);
  });
});
