import { createHash } from "node:crypto";
import type { HealthFinding } from "./types.js";

export function createFinding(
  input: Omit<HealthFinding, "id">,
): HealthFinding {
  const identity = [
    input.provider,
    input.type,
    input.file ?? "",
    input.line ?? "",
    input.message,
  ].join("\u0000");
  return {
    ...input,
    id: createHash("sha256").update(identity).digest("hex").slice(0, 16),
  };
}
