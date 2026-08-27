import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enableBaselineConfig, writeBaseline } from "../src/config/baseline.js";
import type { HealthRun } from "../src/core/types.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function healthRun(): HealthRun {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-27T00:00:00.000Z",
    repository: {
      root: "/tmp/repository",
      packageManager: "npm",
      kinds: ["node-application"],
      frameworks: [],
      languages: ["JavaScript"],
      scopes: [{ path: ".", roles: ["node-app"] }],
    },
    summary: {
      status: "findings",
      findings: 1,
      newFindings: 1,
      existingFindings: 0,
      resolvedFindings: 0,
      errors: 0,
      exitCode: 1,
    },
    results: [
      {
        provider: "test-script",
        name: "Tests",
        category: "tests",
        status: "fail",
        findings: [
          {
            id: "finding-id",
            fingerprint: "finding-fingerprint",
            type: "test-failure",
            provider: "test-script",
            category: "tests",
            severity: "error",
            message: "The test command failed.",
          },
        ],
        durationMs: 10,
      },
    ],
  };
}

describe("baseline file writes", () => {
  it("preserves tab indentation, CRLF endings, and existing trailing newlines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-baseline-"));
    temporary.push(root);
    await writeFile(
      path.join(root, "repnix.config.json"),
      '{\r\n\t"schemaVersion": 1,\r\n\t"severityThreshold": "error"\r\n}\r\n',
    );
    await writeFile(
      path.join(root, ".repnix-baseline.json"),
      '{\r\n\t"schemaVersion": 1,\r\n\t"generatedAt": "old",\r\n\t"entries": []\r\n}\r\n\r\n',
    );

    await writeBaseline(root, ".repnix-baseline.json", healthRun());
    await enableBaselineConfig(root, ".repnix-baseline.json");

    const baseline = await readFile(path.join(root, ".repnix-baseline.json"), "utf8");
    const config = await readFile(path.join(root, "repnix.config.json"), "utf8");
    expect(baseline).toContain('\r\n\t"entries"');
    expect(baseline).not.toContain('\r\n  "entries"');
    expect(baseline.endsWith("\r\n\r\n")).toBe(true);
    expect(config).toContain('\r\n\t"baseline"');
    expect(config).not.toContain('\r\n  "baseline"');
    expect(config.endsWith("\r\n")).toBe(true);
    expect(JSON.parse(baseline)).toMatchObject({ schemaVersion: 1, entries: [{ fingerprint: "finding-fingerprint" }] });
    expect(JSON.parse(config)).toMatchObject({
      schemaVersion: 1,
      severityThreshold: "error",
      baseline: { path: ".repnix-baseline.json", failOn: "new" },
    });
  });

  it("preserves two-space indentation and the absence of a trailing newline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-baseline-"));
    temporary.push(root);
    await writeFile(path.join(root, "repnix.config.json"), '{\n  "severityThreshold": "error"\n}');
    await writeFile(
      path.join(root, ".repnix-baseline.json"),
      '{\n  "schemaVersion": 1,\n  "generatedAt": "old",\n  "entries": []\n}',
    );

    await writeBaseline(root, ".repnix-baseline.json", healthRun());
    await enableBaselineConfig(root, ".repnix-baseline.json");

    const baseline = await readFile(path.join(root, ".repnix-baseline.json"), "utf8");
    const config = await readFile(path.join(root, "repnix.config.json"), "utf8");
    expect(baseline).toContain('\n  "entries"');
    expect(baseline).not.toContain('\n\t"entries"');
    expect(baseline.endsWith("\n")).toBe(false);
    expect(config).toContain('\n  "baseline"');
    expect(config).not.toContain('\n\t"baseline"');
    expect(config.endsWith("\n")).toBe(false);
    expect(JSON.parse(config)).toMatchObject({ severityThreshold: "error", baseline: { failOn: "new" } });
  });

  it("uses two spaces and a final LF when both files are new", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-baseline-"));
    temporary.push(root);

    await writeBaseline(root, ".repnix-baseline.json", healthRun());
    await enableBaselineConfig(root, ".repnix-baseline.json");

    const baseline = await readFile(path.join(root, ".repnix-baseline.json"), "utf8");
    const config = await readFile(path.join(root, "repnix.config.json"), "utf8");
    expect(baseline).toContain('\n  "entries"');
    expect(baseline).not.toContain('\n\t"entries"');
    expect(baseline.endsWith("\n")).toBe(true);
    expect(config).toContain('\n  "baseline"');
    expect(config).not.toContain('\n\t"baseline"');
    expect(config.endsWith("\n")).toBe(true);
    expect(JSON.parse(config)).toMatchObject({ schemaVersion: 1, baseline: { failOn: "new" } });
  });
});
