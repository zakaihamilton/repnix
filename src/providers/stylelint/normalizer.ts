import path from "node:path";
import { createFinding } from "../../core/finding.js";
import type { HealthFinding } from "../../core/types.js";

interface StylelintWarning {
  line?: number;
  column?: number;
  rule?: string | null;
  severity?: "error" | "warning";
  text?: string;
}

interface StylelintFileResult {
  source?: string;
  warnings?: StylelintWarning[];
}

export function normalizeStylelintResult(input: {
  output: string;
  result: { stdout: string; stderr: string };
  context: { root: string };
}): HealthFinding[] {
  const raw = `${input.result.stdout}\n${input.result.stderr}`.trim() || input.output;
  let reports: StylelintFileResult[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    reports = parsed as StylelintFileResult[];
  } catch {
    return [];
  }

  const findings: HealthFinding[] = [];
  for (const report of reports) {
    if (!report || typeof report !== "object" || !Array.isArray(report.warnings)) continue;
    const source = typeof report.source === "string" ? report.source : undefined;
    const file = source ? (path.isAbsolute(source) ? path.relative(input.context.root, source) : source) : undefined;
    for (const warning of report.warnings) {
      if (!warning || typeof warning !== "object" || typeof warning.text !== "string") continue;
      const ruleId = typeof warning.rule === "string" ? warning.rule : "stylelint";
      findings.push(
        createFinding({
          provider: "stylelint",
          category: "styles",
          type: "css-style",
          ruleId,
          title: ruleId,
          severity: warning.severity === "warning" ? "warning" : "error",
          message: warning.text,
          ...(file ? { file } : {}),
          ...(typeof warning.line === "number" ? { line: warning.line } : {}),
          ...(typeof warning.column === "number" ? { column: warning.column } : {}),
          remediation: `Correct the ${ruleId} CSS issue or configure the rule intentionally.`,
          documentationUrl: `https://stylelint.io/user-guide/rules/${ruleId}`,
        }),
      );
    }
  }
  return findings;
}
