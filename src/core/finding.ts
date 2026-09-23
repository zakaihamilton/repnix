import { createHash } from "node:crypto";
import type { HealthFinding } from "./types.js";

export function createFinding(
  input: Omit<HealthFinding, "id" | "fingerprint"> & { fingerprint?: string },
): HealthFinding {
  const fingerprint =
    input.fingerprint ??
    createHash("sha256")
      .update(
        [
          input.provider,
          input.ruleId ?? input.type,
          input.scope ?? ".",
          input.file ?? "",
          input.line ?? "",
          input.column ?? "",
          input.type,
          typeof input.metadata?.fingerprint === "string"
            ? input.metadata.fingerprint
            : typeof input.metadata?.command === "string"
              ? input.metadata.command
              : "",
        ].join("\u0000"),
      )
      .digest("hex")
      .slice(0, 24);
  const identity = [fingerprint, input.message].join("\u0000");
  return {
    ...input,
    fingerprint,
    id: createHash("sha256").update(identity).digest("hex").slice(0, 16),
  };
}

export function withFindingScope(finding: HealthFinding, scope: string): HealthFinding {
  let file = finding.file;
  if (file && scope !== ".") {
    const normalizedFile = file.replaceAll("\\", "/").replace(/^\.\//, "");
    const normalizedScope = scope.replaceAll("\\", "/");
    if (normalizedFile !== normalizedScope && !normalizedFile.startsWith(`${normalizedScope}/`))
      file = `${normalizedScope}/${normalizedFile}`;
  }
  return createFinding({
    provider: finding.provider,
    category: finding.category,
    type: finding.type,
    severity: finding.severity,
    message: finding.message,
    ...(finding.ruleId === undefined ? {} : { ruleId: finding.ruleId }),
    ...(finding.title === undefined ? {} : { title: finding.title }),
    ...(file === undefined ? {} : { file }),
    ...(finding.line === undefined ? {} : { line: finding.line }),
    ...(finding.column === undefined ? {} : { column: finding.column }),
    scope,
    ...(finding.remediation === undefined ? {} : { remediation: finding.remediation }),
    ...(finding.documentationUrl === undefined ? {} : { documentationUrl: finding.documentationUrl }),
    ...(finding.metadata === undefined ? {} : { metadata: finding.metadata }),
  });
}
