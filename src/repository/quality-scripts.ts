import type { HealthCategory } from "../core/health-category.js";
import { isNonMutatingQualityCommand, isNonMutatingTestCommand } from "./script-detection.js";

export type ScriptKind = "general" | "format" | "test";

/** Shared by coverage detection and execution so only runnable scripts receive credit. */
export const QUALITY_SCRIPT_CHECKS: Array<{ category: HealthCategory; names: string[]; kind: ScriptKind }> = [
  { category: "types", names: ["typecheck", "type-check", "check:types", "types"], kind: "general" },
  { category: "lint", names: ["lint", "check:lint", "lint:check"], kind: "general" },
  { category: "format", names: ["format:check", "check:format", "format-check"], kind: "format" },
  { category: "tests", names: ["test", "test:run", "check:test"], kind: "test" },
];

export function safeScriptFrom(scripts: Record<string, string>, names: string[], kind: ScriptKind): string | null {
  for (const name of names) {
    const command = scripts[name];
    if (!command || /--fix(?:\s|$)|--write(?:\s|$)|\bwatch\b|--watch/.test(command)) continue;
    if (kind === "test" && !isNonMutatingTestCommand(command)) continue;
    if (kind !== "test" && !isNonMutatingQualityCommand(command)) continue;
    if (kind === "format" && name === "format") continue;
    return name;
  }
  return null;
}
