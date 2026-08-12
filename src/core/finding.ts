import { createHash } from "node:crypto";
import type { HealthFinding } from "./types.js";

export function createFinding(
  input: Omit<HealthFinding, "id" | "fingerprint"> & { fingerprint?: string },
): HealthFinding {
  const fingerprint = input.fingerprint ?? createHash("sha256").update([
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
  ].join("\u0000")).digest("hex").slice(0, 24);
  const identity = [
    fingerprint,
    input.message,
  ].join("\u0000");
  return {
    ...input,
    fingerprint,
    id: createHash("sha256").update(identity).digest("hex").slice(0, 16),
  };
}
