import { createFinding } from "../../core/finding.js";
import type { HealthFinding } from "../../core/types.js";

const TITLES: Record<string, string> = {
  NoResolution: "Resolution failed",
  UntypedResolution: "No types",
  FalseCJS: "Masquerading as CommonJS",
  FalseESM: "Masquerading as ESM",
  CJSResolvesToESM: "CommonJS resolves to ESM",
  FallbackCondition: "Fallback export condition used",
  CJSOnlyExportsDefault: "CommonJS default export mismatch",
  FalseExportDefault: "Incorrect default export",
  MissingExportEquals: "Missing export equals",
  UnexpectedModuleSyntax: "Unexpected module syntax",
  InternalResolutionError: "Internal resolution error",
  NamedExports: "Named exports mismatch",
};

const FLAGS: Record<string, string> = {
  NoResolution: "no-resolution",
  UntypedResolution: "untyped-resolution",
  FalseCJS: "false-cjs",
  FalseESM: "false-esm",
  CJSResolvesToESM: "cjs-resolves-to-esm",
  FallbackCondition: "fallback-condition",
  CJSOnlyExportsDefault: "cjs-only-exports-default",
  NamedExports: "named-exports",
  FalseExportDefault: "false-export-default",
  MissingExportEquals: "missing-export-equals",
  UnexpectedModuleSyntax: "unexpected-module-syntax",
  InternalResolutionError: "internal-resolution-error",
};

export interface AttwNormalizationOptions {
  ignoreRules?: string[];
  profile?: "strict" | "node16" | "esm-only";
}

function label(kind: string): string {
  return TITLES[kind] ?? kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

export function normalizeAttw(report: unknown, options: AttwNormalizationOptions = {}): HealthFinding[] {
  if (!report || typeof report !== "object" || !("analysis" in report)) {
    throw new Error("Are The Types Wrong? JSON report has an unsupported shape.");
  }
  const analysis = (report as { analysis?: unknown }).analysis;
  if (!analysis || typeof analysis !== "object") {
    throw new Error("Are The Types Wrong? JSON report has an unsupported shape.");
  }
  const analysisRecord = analysis as Record<string, unknown>;
  if (!analysisRecord.types) {
    return [createFinding({
      provider: "Are The Types Wrong?",
      category: "package-health",
      type: "attw-untyped-package",
      severity: "error",
      message: "The packed package does not contain TypeScript declarations.",
      file: "package.json",
      metadata: {
        packageName: analysisRecord.packageName,
        packageVersion: analysisRecord.packageVersion,
      },
    })];
  }
  if (!Array.isArray(analysisRecord.problems)) {
    throw new Error("Are The Types Wrong? JSON report has an unsupported shape.");
  }
  const ignoredResolutions = options.profile === "esm-only"
    ? new Set(["node10", "node16-cjs"])
    : options.profile === "node16"
      ? new Set(["node10"])
      : new Set<string>();
  const ignoredRules = new Set(options.ignoreRules ?? []);
  return analysisRecord.problems.filter((problem) => {
    if (!problem || typeof problem !== "object") return true;
    const item = problem as Record<string, unknown>;
    return !(typeof item.kind === "string" && ignoredRules.has(FLAGS[item.kind] ?? "")) &&
      !(typeof item.resolutionKind === "string" && ignoredResolutions.has(item.resolutionKind));
  }).map((problem) => {
    if (!problem || typeof problem !== "object" || typeof (problem as Record<string, unknown>).kind !== "string") {
      throw new Error("Are The Types Wrong? JSON report contains a malformed problem.");
    }
    const item = problem as Record<string, unknown>;
    const kind = item.kind as string;
    const qualifiers = [
      typeof item.entrypoint === "string" ? `entry point ${item.entrypoint}` : null,
      typeof item.resolutionKind === "string" ? item.resolutionKind : null,
    ].filter(Boolean).join(", ");
    return createFinding({
      provider: "Are The Types Wrong?",
      category: "package-health",
      type: `attw-${kind.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`,
      severity: "error",
      message: `${label(kind)}${qualifiers ? ` (${qualifiers})` : ""}.`,
      file: "package.json",
      metadata: { ...item },
    });
  });
}
