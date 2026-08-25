import { createFinding } from "../../core/finding.js";
import type { FindingSeverity, HealthFinding } from "../../core/types.js";

const SEVERITIES: Record<string, FindingSeverity> = {
  suggestion: "info",
  warning: "warning",
  error: "error",
};

export function normalizePublint(report: unknown): HealthFinding[] {
  if (!report || typeof report !== "object" || !Array.isArray((report as { messages?: unknown }).messages)) {
    throw new Error("Publint JSON report has an unsupported shape.");
  }
  return (report as { messages: unknown[] }).messages.map((message) => {
    if (!message || typeof message !== "object") throw new Error("Publint JSON report contains a malformed message.");
    const item = message as Record<string, unknown>;
    if (typeof item.code !== "string" || typeof item.type !== "string" || !SEVERITIES[item.type]) {
      throw new Error("Publint JSON report contains a malformed message.");
    }
    const messagePath =
      Array.isArray(item.path) && item.path.every((part) => typeof part === "string") ? (item.path as string[]) : [];
    const rendered =
      typeof item.formatted === "string" && item.formatted.length > 0
        ? item.formatted
        : `Publint reported ${item.code}.`;
    return createFinding({
      provider: "Publint",
      category: "package-health",
      type: `publint-${item.code.toLowerCase().replaceAll("_", "-")}`,
      severity: SEVERITIES[item.type]!,
      message: rendered,
      file: "package.json",
      metadata: { code: item.code, path: messagePath, args: item.args ?? {} },
    });
  });
}
