import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config/repo-health-config.js";

describe("configuration", () => {
  it("provides zero-config defaults and accepts partial category maps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      expect((await readConfig(root)).config.severityThreshold).toBe("warning");
      await writeFile(path.join(root, "repnix.config.json"), JSON.stringify({ categories: { "dead-code": "required" }, severityThreshold: "error" }));
      expect((await readConfig(root)).config).toMatchObject({ categories: { "dead-code": "required" }, severityThreshold: "error" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts Phase 2 provider enablement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      await writeFile(path.join(root, "repnix.config.json"), JSON.stringify({ providers: { "osv-scanner": { enabled: false }, "dependency-cruiser": { enabled: true }, "eslint-boundaries": { enabled: true }, "size-limit": { enabled: false } } }));
      expect((await readConfig(root)).config.providers).toMatchObject({ "osv-scanner": { enabled: false }, "dependency-cruiser": { enabled: true } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts package-health provider enablement", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      await writeFile(path.join(root, "repnix.config.json"), JSON.stringify({ providers: { publint: { enabled: true }, attw: { enabled: false } } }));
      expect((await readConfig(root)).config.providers).toMatchObject({ publint: { enabled: true }, attw: { enabled: false } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts repository policies and expanded providers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-config-"));
    try {
      await writeFile(path.join(root, "repnix.config.json"), JSON.stringify({
        policies: {
          licenses: { allow: ["MIT"], deny: ["GPL-3.0-only"] },
          coverage: { lines: 80, branches: 70 },
          performance: { maxLcpMs: 2500, maxCls: 0.1 },
        },
        providers: { syncpack: { enabled: true }, gitleaks: { enabled: false }, markdownlint: { enabled: true } },
      }));
      expect((await readConfig(root)).config).toMatchObject({
        policies: { licenses: { allow: ["MIT"] }, coverage: { lines: 80 } },
        providers: { syncpack: { enabled: true }, gitleaks: { enabled: false } },
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
});
