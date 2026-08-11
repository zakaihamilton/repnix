import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { renderAudit, wrapTerminalText } from "../src/reporting/console-reporter.js";
import type { AuditModel } from "../src/recommendations/recommendation-engine.js";

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
});
