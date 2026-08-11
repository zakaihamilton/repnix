import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { renderAudit, renderExplain, renderHealth, wrapTerminalText } from "../src/reporting/console-reporter.js";
import type { AuditModel } from "../src/recommendations/recommendation-engine.js";
import type { HealthResult, HealthRun } from "../src/core/types.js";

describe("console reporting", () => {
  it("wraps text at the terminal width with readable continuation indentation", () => {
    const wrapped = wrapTerminalText("A long recommendation explanation stays readable in a narrow terminal.", 24, "  ");

    expect(wrapped).toEqual([
      "  A long recommendation",
      "  explanation stays",
      "  readable in a narrow",
      "  terminal.",
    ]);
    expect(wrapped.every((line) => line.length <= 24)).toBe(true);
  });

  it("wraps long audit details when stdout is a narrow TTY", () => {
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 60 });
    try {
      const model = {
        context: {
          kinds: [],
          frameworks: [],
          languages: [],
          packageManager: "npm",
          packageManagerEvidence: "package-manager-evidence-that-is-long-enough-to-wrap",
          hasCI: false,
          diagnostics: [],
        },
        coverage: [{
          category: "security",
          status: "missing",
          providers: [],
          capabilities: [],
          missingCapabilities: [],
          reason: "A long coverage explanation remains readable instead of being split by the terminal.",
        }],
        recommendations: [],
      } as unknown as AuditModel;

      const output = renderAudit(model);

      expect(output.split("\n").every((line) => stripVTControlCharacters(line).length <= 60)).toBe(true);
      expect(output).toMatch(/A long coverage explanation\s+remains readable/);
    } finally {
      if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
      if (columns) Object.defineProperty(process.stdout, "columns", columns);
      else delete (process.stdout as { columns?: number }).columns;
    }
  });

  it("explains audit statuses and recommendations for new developers", () => {
    const model = {
      context: {
        kinds: ["node-application"],
        frameworks: [],
        languages: ["TypeScript"],
        packageManager: "npm",
        packageManagerEvidence: "lockfile",
        hasCI: false,
        diagnostics: [],
      },
      coverage: [{
        category: "dead-code",
        status: "missing",
        providers: [],
        capabilities: [],
        missingCapabilities: [],
      }],
      recommendations: [{
        provider: "knip",
        name: "Knip",
        category: "dead-code",
        recommended: true,
        priority: "baseline",
        actionable: true,
        reason: "Nothing currently checks for unused files, exports, or dependencies.",
      }],
    } as unknown as AuditModel;

    const output = renderAudit(model);

    expect(output).toContain("read-only");
    expect(output).toContain("partly covered");
    expect(output).toContain("What it checks: Finds unused files, exports, and dependencies.");
    expect(output).toContain("Recommended baseline — start here");
  });

  it("distinguishes passing checks, findings, and check errors", () => {
    const baseResult: HealthResult = {
      provider: "test-script",
      name: "Test script",
      category: "tests",
      status: "pass",
      findings: [],
      durationMs: 10,
    };
    const base: HealthRun = {
      schemaVersion: 1 as const,
      generatedAt: "2026-08-11T00:00:00.000Z",
      repository: { root: "/tmp/project", packageManager: "npm" as const, kinds: ["node-application" as const], frameworks: [], languages: [] },
      summary: { status: "healthy" as const, findings: 0, errors: 0, exitCode: 0 as const },
      results: [baseResult],
    };
    expect(renderHealth(base)).toContain("All configured checks passed");

    const findingRun = {
      ...base,
      summary: { status: "findings" as const, findings: 1, errors: 0, exitCode: 1 as const },
      results: [{ ...baseResult, status: "fail" as const, findings: [{ id: "test-failure", type: "command", provider: "Test script", category: "tests" as const, severity: "error" as const, message: "A test failed." }] }],
    };
    expect(renderHealth(findingRun)).toContain("what each finding means");

    const belowThresholdRun = {
      ...base,
      summary: { status: "healthy" as const, findings: 1, errors: 0, exitCode: 0 as const },
      results: [{ ...baseResult, status: "fail" as const, findings: [{ id: "test-info", type: "command", provider: "Test script", category: "tests" as const, severity: "info" as const, message: "A test reported an informational note." }] }],
    };
    expect(renderHealth(belowThresholdRun)).toContain("none meet the configured severity threshold");

    const emptyRun = { ...base, results: [] };
    expect(renderHealth(emptyRun)).toContain("No applicable health checks ran");

    const errorRun = {
      ...base,
      summary: { status: "error" as const, findings: 0, errors: 1, exitCode: 2 as const },
      results: [{ ...baseResult, status: "error" as const, message: "The test command was not found." }],
    };
    expect(renderHealth(errorRun)).toContain("not necessarily a problem in your code");
  });

  it("adds severity, location, and provider guidance to findings", () => {
    const run = {
      schemaVersion: 1,
      generatedAt: "2026-08-11T00:00:00.000Z",
      repository: { root: "/tmp/project", packageManager: "npm", kinds: ["node-application"], frameworks: [], languages: [] },
      summary: { status: "findings", findings: 1, errors: 0, exitCode: 1 },
      results: [{
        provider: "knip",
        name: "Knip",
        category: "dead-code",
        status: "fail",
        durationMs: 10,
        findings: [{ id: "unused-file", type: "unused-file", provider: "Knip", category: "dead-code", severity: "warning", message: "Unused file: src/old.ts", file: "src/old.ts", line: 1 }],
      }],
    } as unknown as HealthRun;

    const output = renderExplain(run);
    const plainOutput = stripVTControlCharacters(output);

    expect(plainOutput).toContain("What this means:");
    expect(plainOutput).toContain("Severity: warning — review soon");
    expect(plainOutput).toContain("Where to look: src/old.ts:1");
    expect(plainOutput).toContain("Reported by: Knip");
  });

  it("gives a useful explanation when no findings exist", () => {
    const run = {
      schemaVersion: 1,
      generatedAt: "2026-08-11T00:00:00.000Z",
      repository: { root: "/tmp/project", packageManager: "npm", kinds: [], frameworks: [], languages: [] },
      summary: { status: "healthy", findings: 0, errors: 0, exitCode: 0 },
      results: [],
    } as unknown as HealthRun;

    expect(renderExplain(run)).toContain("No health findings. All configured checks passed.");
  });
});
