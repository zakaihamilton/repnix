import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyScopeOverrides, categoryModeFor, readConfig } from "../src/config/repo-health-config.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { fixturePath } from "./helpers.js";

describe("configuration", () => {
  it("provides zero-config defaults and accepts partial category maps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      expect((await readConfig(root)).config.severityThreshold).toBe("warning");
      await writeFile(
        path.join(root, "repnix.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          categories: { "dead-code": { mode: "required" } },
          severityThreshold: "error",
        }),
      );
      expect((await readConfig(root)).config).toMatchObject({
        categories: { "dead-code": { mode: "required" } },
        severityThreshold: "error",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects removed provider enablement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      await writeFile(
        path.join(root, "repnix.config.json"),
        JSON.stringify({ providers: { "osv-scanner": { enabled: false } } }),
      );
      await expect(readConfig(root)).rejects.toThrow("Invalid repnix.config.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts repository policies and expanded providers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      await writeFile(
        path.join(root, "repnix.config.json"),
        JSON.stringify({
          policies: {
            licenses: { allow: ["MIT"], deny: ["GPL-3.0-only"] },
            coverage: { lines: 80, branches: 70 },
            performance: { maxLcpMs: 2500, maxCls: 0.1 },
          },
        }),
      );
      expect((await readConfig(root)).config).toMatchObject({
        policies: { licenses: { allow: ["MIT"] }, coverage: { lines: 80 } },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown configuration fields", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      await writeFile(path.join(root, "repnix.config.json"), JSON.stringify({ mystery: true }));
      await expect(readConfig(root)).rejects.toThrow("Invalid repnix.config.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports explicit scope roles, category policy, execution, and baseline settings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      await writeFile(
        path.join(root, "repnix.config.json"),
        JSON.stringify({
          schemaVersion: 1,
          scopes: { ".": { roles: ["web-app"], categories: { performance: { mode: "off" } } } },
          execution: { jobs: 4, timeoutSeconds: 120 },
          baseline: { path: ".repnix-baseline.json", failOn: "new" },
        }),
      );
      const { config } = await readConfig(root);
      const context = applyScopeOverrides(await detectRepository(fixturePath("minimal-js")), config);
      expect(context.scopes[0]).toMatchObject({ roles: ["web-app"], roleEvidence: [{ confidence: "configured" }] });
      expect(categoryModeFor(config, "performance", ".")).toBe("off");
      expect(config).toMatchObject({ execution: { jobs: 4, timeoutSeconds: 120 }, baseline: { failOn: "new" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
