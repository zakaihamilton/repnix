import { createFinding } from "../../core/finding.js";
import type { FindingSeverity, HealthFinding } from "../../core/types.js";

function severity(value: unknown): FindingSeverity | null {
  if (value === "ignore") return null;
  if (value === "error") return "error";
  if (value === "info") return "info";
  return "warning";
}

export function normalizeDependencyCruiser(report: unknown): HealthFinding[] {
  if (!report || typeof report !== "object")
    throw new Error("dependency-cruiser JSON report has an unsupported shape.");
  const summary = (report as Record<string, unknown>).summary;
  if (!summary || typeof summary !== "object" || !Array.isArray((summary as Record<string, unknown>).violations)) {
    throw new Error("dependency-cruiser JSON report has an unsupported shape.");
  }
  const findings: HealthFinding[] = [];
  for (const violation of (summary as { violations: unknown[] }).violations) {
    if (!violation || typeof violation !== "object") continue;
    const item = violation as Record<string, unknown>;
    const rule = item.rule && typeof item.rule === "object" ? (item.rule as Record<string, unknown>) : {};
    const findingSeverity = severity(rule.severity ?? item.severity);
    if (!findingSeverity) continue;
    const from = typeof item.from === "string" ? item.from : "unknown";
    const to = typeof item.to === "string" ? item.to : undefined;
    const ruleName =
      typeof rule.name === "string" ? rule.name : typeof item.rule === "string" ? item.rule : "architecture-rule";
    findings.push(
      createFinding({
        provider: "dependency-cruiser",
        category: "architecture",
        type: "architecture-violation",
        severity: findingSeverity,
        message: `${ruleName}: ${from}${to ? ` must not depend on ${to}` : ""}`,
        file: from,
        metadata: { rule: ruleName, from, to, violationType: item.type },
      }),
    );
  }
  return findings;
}
