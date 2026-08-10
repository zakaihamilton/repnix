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
