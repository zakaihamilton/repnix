import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { CATEGORY_LABELS } from "../core/health-category.js";
import type { HealthFinding, HealthRun } from "../core/types.js";
import type { AuditModel, CoverageStatus } from "../recommendations/recommendation-engine.js";

function terminalWidth(): number | undefined {
  return process.stdout.isTTY && process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : undefined;
}

function visibleLength(value: string): number {
  return stripVTControlCharacters(value).length;
}

function rule(width: number | undefined): string {
  return "─".repeat(Math.min(48, width ?? 48));
}

export function wrapTerminalText(
  text: string,
  width: number | undefined,
  prefix = "",
  continuationPrefix = prefix,
): string[] {
  if (!width || width <= 0) return [`${prefix}${text}`];

  return text.split("\n").flatMap((sourceLine) => {
    if (!sourceLine.trim()) return [prefix];

    const words = sourceLine.trim().split(/\s+/);
    const lines: string[] = [];
    let linePrefix = prefix;
    let line = linePrefix;

    for (const word of words) {
      const separator = line === linePrefix ? "" : " ";
      const available = width - visibleLength(line) - separator.length;
      if (word.length <= available) {
        line += `${separator}${word}`;
        continue;
      }

      if (line !== linePrefix) lines.push(line);
      linePrefix = continuationPrefix;
      line = linePrefix;
      let remaining = word;
      const chunkWidth = Math.max(width - visibleLength(linePrefix), 1);
      while (remaining.length > chunkWidth) {
        lines.push(`${linePrefix}${remaining.slice(0, chunkWidth)}`);
        remaining = remaining.slice(chunkWidth);
      }
      line += remaining;
    }

    lines.push(line);
    return lines;
  });
}

function addWrapped(
  lines: string[],
  text: string,
  width: number | undefined,
  prefix = "",
  continuationPrefix = prefix,
): void {
  lines.push(...wrapTerminalText(text, width, prefix, continuationPrefix));
}

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
  const width = terminalWidth();
  const lines = [pc.bold("Repository"), ""];
  lines.push(
    ...context.kinds.map((kind) => kind.replaceAll("-", " ")),
    ...context.frameworks,
    ...context.languages,
  );
  addWrapped(
    lines,
    context.packageManager ? `${context.packageManager} (${context.packageManagerEvidence ?? "detected"})` : "Package manager unresolved",
    width,
    "",
    "  ",
  );
  lines.push(
    context.hasCI ? "GitHub Actions" : "No CI detected",
    "",
    pc.bold("Repository Guardrails"),
    rule(width),
  );
  for (const entry of model.coverage) {
    const detail =
      entry.status === "not-applicable" || entry.status === "off"
        ? ""
        : entry.providers.length
          ? entry.providers.join(", ")
          : entry.reason ?? "Missing";
    const prefix = `${CATEGORY_LABELS[entry.category].padEnd(27)} ${mark(entry.status)}`;
    if (detail) {
      addWrapped(lines, detail, width, `${prefix} `, `${" ".repeat(visibleLength(prefix))} `);
    } else {
      lines.push(prefix);
    }
  }
  if (context.diagnostics.length) {
    lines.push("", pc.bold("Diagnostics"), rule(width));
    for (const diagnostic of context.diagnostics) {
      addWrapped(
        lines,
        diagnostic.message,
        width,
        `${diagnostic.severity === "error" ? pc.red("!") : pc.yellow("!")} `,
        "  ",
      );
    }
  }
  if (model.recommendations.length) {
    for (const priority of ["baseline", "optional", "advanced"] as const) {
      const recommendations = model.recommendations.filter((recommendation) => recommendation.priority === priority);
      if (!recommendations.length) continue;
      const heading = priority === "baseline" ? "Recommended baseline" : priority === "optional" ? "Optional" : "Advanced";
      lines.push("", pc.bold(heading), rule(width));
      for (const recommendation of recommendations) {
        const setup = recommendation.actionable ? "" : pc.dim(" (manual configuration)");
        lines.push(`+ ${pc.bold(recommendation.name)}${setup}`);
        addWrapped(lines, recommendation.reason, width, "  ");
        lines.push("");
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
  const width = terminalWidth();
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
    const prefix = `${CATEGORY_LABELS[category].padEnd(22)} ${statusMark(status, findings)}  `;
    addWrapped(
      lines,
      providers,
      width,
      prefix,
      " ".repeat(visibleLength(prefix)),
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
  const width = terminalWidth();
  const lines: string[] = [];
  const groups = new Map<string, HealthFinding[]>();
  for (const result of run.results) {
    for (const finding of result.findings) {
      groups.set(finding.category, [...(groups.get(finding.category) ?? []), finding]);
    }
    if (result.status === "error" && result.message) {
      lines.push(pc.bold(CATEGORY_LABELS[result.category]), rule(width));
      addWrapped(lines, result.message, width, "", "  ");
      lines.push("");
    }
  }
  for (const [category, findings] of groups) {
    lines.push(pc.bold(CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]), rule(width));
    for (const finding of findings) {
      const location = findingLocation(finding);
      if (location) lines.push(pc.cyan(location));
      addWrapped(lines, finding.message, width, "", "  ");
      lines.push(pc.dim(`Source: ${finding.provider}`), "");
    }
  }
  if (!lines.length) lines.push(pc.green("No health findings."));
  return lines.join("\n").trimEnd();
}
