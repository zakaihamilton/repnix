import { createFinding } from "../../core/finding.js";
import type { FindingSeverity, HealthFinding } from "../../core/types.js";

function severityFor(vulnerability: Record<string, unknown>): FindingSeverity {
  const database = vulnerability.database_specific;
  const label = database && typeof database === "object" && "severity" in database
    ? String((database as Record<string, unknown>).severity).toUpperCase()
    : "";
  if (label === "CRITICAL" || label === "HIGH") return "error";
  if (label === "LOW") return "info";
  return "warning";
}

function fixedVersions(vulnerability: Record<string, unknown>): string[] {
  const versions = new Set<string>();
  const affected = Array.isArray(vulnerability.affected) ? vulnerability.affected : [];
  for (const item of affected) {
    if (!item || typeof item !== "object") continue;
    const ranges = Array.isArray((item as Record<string, unknown>).ranges) ? (item as Record<string, unknown>).ranges as unknown[] : [];
    for (const range of ranges) {
      if (!range || typeof range !== "object") continue;
      const events = Array.isArray((range as Record<string, unknown>).events) ? (range as Record<string, unknown>).events as unknown[] : [];
      for (const event of events) {
        if (event && typeof event === "object" && typeof (event as Record<string, unknown>).fixed === "string") {
          versions.add((event as Record<string, unknown>).fixed as string);
        }
      }
    }
  }
  return [...versions];
}

export function normalizeOsv(report: unknown): HealthFinding[] {
  if (!report || typeof report !== "object" || !Array.isArray((report as Record<string, unknown>).results)) {
    throw new Error("OSV-Scanner JSON report has an unsupported shape.");
  }
  const findings: HealthFinding[] = [];
  const seen = new Set<string>();
  for (const result of (report as { results: unknown[] }).results) {
    if (!result || typeof result !== "object") continue;
    const resultRecord = result as Record<string, unknown>;
    const source = resultRecord.source && typeof resultRecord.source === "object" ? resultRecord.source as Record<string, unknown> : {};
    const file = typeof source.path === "string" ? source.path : undefined;
    const packages = Array.isArray(resultRecord.packages) ? resultRecord.packages : [];
    for (const entry of packages) {
      if (!entry || typeof entry !== "object") continue;
      const entryRecord = entry as Record<string, unknown>;
      const packageData = entryRecord.package && typeof entryRecord.package === "object" ? entryRecord.package as Record<string, unknown> : {};
      const name = typeof packageData.name === "string" ? packageData.name : "unknown package";
      const version = typeof packageData.version === "string" ? packageData.version : "unknown version";
      const vulnerabilities = Array.isArray(entryRecord.vulnerabilities) ? entryRecord.vulnerabilities : [];
      for (const vulnerability of vulnerabilities) {
        if (!vulnerability || typeof vulnerability !== "object") continue;
        const record = vulnerability as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : "unknown advisory";
        const key = `${name}\0${version}\0${id}\0${file ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const fixed = fixedVersions(record);
        findings.push(createFinding({
          provider: "OSV-Scanner",
          category: "security",
          type: "vulnerability",
          severity: severityFor(record),
          message: `${id} affects ${name}@${version}${fixed.length ? `; fixed in ${fixed.join(", ")}` : ""}`,
          ...(file ? { file } : {}),
          metadata: {
            advisory: id,
            package: name,
            version,
            ecosystem: packageData.ecosystem,
            aliases: record.aliases,
            fixedVersions: fixed,
          },
        }));
      }
    }
  }
  return findings;
}
