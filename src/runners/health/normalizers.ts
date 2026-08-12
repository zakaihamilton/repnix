import { createFinding } from "../../core/finding.js";
import type { FindingSeverity, HealthFinding } from "../../core/types.js";

const KNIP_TYPES: Record<string, { type: string; severity: FindingSeverity; label: string }> = {
  files: { type: "unused-file", severity: "warning", label: "Unused file" },
  exports: { type: "unused-export", severity: "warning", label: "Unused export" },
  nsExports: { type: "unused-export", severity: "warning", label: "Unused namespace export" },
  types: { type: "unused-export", severity: "warning", label: "Unused exported type" },
  nsTypes: { type: "unused-export", severity: "warning", label: "Unused namespace type" },
  enumMembers: { type: "unused-export", severity: "warning", label: "Unused enum member" },
  namespaceMembers: { type: "unused-export", severity: "warning", label: "Unused namespace member" },
  dependencies: { type: "unused-dependency", severity: "warning", label: "Unused dependency" },
  devDependencies: { type: "unused-dependency", severity: "warning", label: "Unused dev dependency" },
  optionalPeerDependencies: { type: "unused-dependency", severity: "warning", label: "Unused optional peer dependency" },
  unlisted: { type: "missing-dependency", severity: "error", label: "Unlisted dependency" },
  unresolved: { type: "unresolved-import", severity: "error", label: "Unresolved import" },
};

export function normalizeKnip(report: unknown): HealthFinding[] {
  if (!report || typeof report !== "object" || !("issues" in report) || !Array.isArray((report as { issues: unknown }).issues)) throw new Error("Knip JSON report has an unsupported shape.");
  const findings: HealthFinding[] = [];
  for (const issue of (report as { issues: unknown[] }).issues) {
    if (!issue || typeof issue !== "object") continue;
    const record = issue as Record<string, unknown>;
    const file = typeof record.file === "string" ? record.file : undefined;
    for (const [key, mapping] of Object.entries(KNIP_TYPES)) {
      if (!Array.isArray(record[key])) continue;
      for (const entry of record[key]) {
        const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
        const name = typeof value.name === "string" ? value.name : file ?? "unknown";
        findings.push(createFinding({ provider: "Knip", category: "dead-code", type: mapping.type, severity: mapping.severity, message: `${mapping.label}: ${name}`, ...(file ? { file } : {}), ...(typeof value.line === "number" ? { line: value.line } : {}), metadata: { issueType: key, name } }));
      }
    }
  }
  return findings;
}

export function normalizeJscpd(report: unknown): HealthFinding[] {
  if (!report || typeof report !== "object" || !("duplicates" in report) || !Array.isArray((report as { duplicates: unknown }).duplicates)) throw new Error("jscpd JSON report has an unsupported shape.");
  return (report as { duplicates: unknown[] }).duplicates.map((duplicate) => {
    const item = duplicate as Record<string, unknown>;
    const first = (item.firstFile ?? {}) as Record<string, unknown>;
    const second = (item.secondFile ?? {}) as Record<string, unknown>;
    const firstName = typeof first.name === "string" ? first.name : "unknown";
    const secondName = typeof second.name === "string" ? second.name : "unknown";
    const lines = typeof item.lines === "number" ? item.lines : 0;
    return createFinding({ provider: "jscpd", category: "duplication", type: "duplication", severity: "warning", message: `Duplicated block: ${lines} lines between ${firstName} and ${secondName}`, file: firstName, ...(typeof first.start === "number" ? { line: first.start } : {}), metadata: { files: [firstName, secondName], lines, firstFile: first, secondFile: second } });
  });
}
