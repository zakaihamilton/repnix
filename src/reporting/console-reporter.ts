import pc from "picocolors";
import { CATEGORY_LABELS } from "../core/health-category.js";
import type { HealthFinding, HealthRun } from "../core/types.js";
import type { AuditModel, CoverageStatus } from "../recommendations/recommendation-engine.js";

function mark(status: CoverageStatus): string {
  switch (status) {
    case "covered":
      return pc.green("✓");
    case "partial":
      return pc.yellow("◐");
    case "missing":
      return pc.red("✗");
    case "off":
      return pc.dim("– off");
    case "not-applicable":
      return pc.dim("– n/a");
  }
}

export function renderAudit(model: AuditModel): string {
  const { context } = model;
  const lines = [pc.bold("Repository"), ""];
  lines.push(
    ...context.kinds.map((kind) => kind.replaceAll("-", " ")),
    ...context.frameworks,
    ...context.languages,
    context.packageManager ? `${context.packageManager} (${context.packageManagerEvidence ?? "detected"})` : "Package manager unresolved",
    context.hasCI ? "GitHub Actions" : "No CI detected",
    "",
    pc.bold("Repository Guardrails"),
    "─".repeat(48),
  );
  for (const entry of model.coverage) {
    const detail =
      entry.status === "not-applicable" || entry.status === "off"
        ? ""
        : entry.providers.length
          ? entry.providers.join(", ")
          : entry.reason ?? "Missing";
    lines.push(`${CATEGORY_LABELS[entry.category].padEnd(27)} ${mark(entry.status)}${detail ? ` ${detail}` : ""}`);
  }
  if (context.diagnostics.length) {
    lines.push("", pc.bold("Diagnostics"), "─".repeat(48));
    for (const diagnostic of context.diagnostics) {
      lines.push(`${diagnostic.severity === "error" ? pc.red("!") : pc.yellow("!")} ${diagnostic.message}`);
    }
  }
  if (model.recommendations.length) {
    for (const priority of ["baseline", "optional", "advanced"] as const) {
      const recommendations = model.recommendations.filter((recommendation) => recommendation.priority === priority);
      if (!recommendations.length) continue;
      const heading = priority === "baseline" ? "Recommended baseline" : priority === "optional" ? "Optional" : "Advanced";
      lines.push("", pc.bold(heading), "─".repeat(48));
      for (const recommendation of recommendations) {
        const setup = recommendation.actionable ? "" : pc.dim(" (manual configuration)");
        lines.push(`+ ${pc.bold(recommendation.name)}${setup}`, `  ${recommendation.reason}`, "");
      }
    }
  } else {
    lines.push("", pc.green("No recommendations."));
  }
  return lines.join("\n").trimEnd();
}

function statusMark(status: string, findings: number): string {
  if (status === "pass") return pc.green("✓");
  if (status === "skipped") return pc.dim("–");
  if (status === "error") return pc.red("✗ error");
  return pc.yellow(`⚠ ${findings}`);
}

export function renderHealth(run: HealthRun): string {
  const lines = [pc.bold("Repository Health"), ""];
  const grouped = new Map<keyof typeof CATEGORY_LABELS, typeof run.results>();
  for (const result of run.results) {
    grouped.set(result.category, [...(grouped.get(result.category) ?? []), result]);
  }
  const statusRank = { skipped: 0, pass: 1, warn: 2, fail: 3, error: 4 } as const;
  for (const [category, results] of grouped) {
    const status = results.reduce((current, result) =>
      statusRank[result.status] > statusRank[current] ? result.status : current,
    "skipped" as keyof typeof statusRank);
    const findings = results.reduce((total, result) => total + result.findings.length, 0);
    const providers = results.map((result) => result.name).join(", ");
    lines.push(
      `${CATEGORY_LABELS[category].padEnd(22)} ${statusMark(status, findings)}  ${providers}`,
    );
  }
  lines.push("", `${run.summary.findings} finding${run.summary.findings === 1 ? "" : "s"}`);
  if (run.summary.findings > 0) lines.push("", `Run: ${pc.bold("repnix explain")}`);
  return lines.join("\n");
}

function findingLocation(finding: HealthFinding): string {
  if (!finding.file) return "";
  return `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
}

export function renderExplain(run: HealthRun): string {
  const lines: string[] = [];
  const groups = new Map<string, HealthFinding[]>();
  for (const result of run.results) {
    for (const finding of result.findings) {
      groups.set(finding.category, [...(groups.get(finding.category) ?? []), finding]);
    }
    if (result.status === "error" && result.message) {
      lines.push(pc.bold(CATEGORY_LABELS[result.category]), "─".repeat(48), result.message, "");
    }
  }
  for (const [category, findings] of groups) {
    lines.push(pc.bold(CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]), "─".repeat(48));
    for (const finding of findings) {
      const location = findingLocation(finding);
      if (location) lines.push(pc.cyan(location));
      lines.push(finding.message, pc.dim(`Source: ${finding.provider}`), "");
    }
  }
  if (!lines.length) lines.push(pc.green("No health findings."));
  return lines.join("\n").trimEnd();
}
