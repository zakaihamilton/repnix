import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, PROVIDER_DESCRIPTIONS, PROVIDER_NEXT_STEPS } from "../core/health-category.js";
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
  const lines = [pc.bold("Repository health audit"), ""];
  addWrapped(lines, "RepNix looks at the checks already protecting this repository, then points out useful gaps. This audit is read-only.", width);
  lines.push("");
  lines.push(pc.bold("Detected project"), "");
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
  addWrapped(lines, "These symbols show whether a kind of protection is active in your project:", width);
  addWrapped(lines, "✓ covered   ◐ partly covered   ✗ missing   – off = disabled   – n/a = not relevant", width, "  ");
  lines.push("");
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
      const heading = priority === "baseline"
        ? "Recommended baseline — start here"
        : priority === "optional"
          ? "Optional — useful when your project needs it"
          : "Advanced — add when you have a specific goal";
      lines.push("", pc.bold(heading), rule(width));
      for (const recommendation of recommendations) {
        const setup = recommendation.actionable ? "" : pc.dim(" (manual configuration)");
        lines.push(`+ ${pc.bold(recommendation.name)}${setup}`);
        const description = PROVIDER_DESCRIPTIONS[recommendation.name];
        if (description) addWrapped(lines, `What it checks: ${description}`, width, "  ");
        addWrapped(lines, recommendation.reason, width, "  ");
        if (!recommendation.actionable) {
          addWrapped(lines, PROVIDER_NEXT_STEPS[recommendation.name] ?? "Next step: review the provider configuration before installing this check.", width, "  ");
        }
        lines.push("");
      }
    }
  } else {
    lines.push("");
    addWrapped(lines, "No new checks are recommended. Your active coverage matches what RepNix expects for this repository.", width, pc.green(""), "  ");
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
  const lines = [pc.bold("Repository health check"), ""];
  addWrapped(lines, "RepNix ran the health checks that are configured and active in this repository.", width);
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
  lines.push("");
  if (run.summary.errors > 0) {
    addWrapped(lines, `${run.summary.errors} check${run.summary.errors === 1 ? "" : "s"} could not finish. This is a configuration or tool problem, not necessarily a problem in your code.`, width);
    lines.push("", `Next: run ${pc.bold("repnix explain")} to see what happened.`);
  } else if (run.results.length === 0 || run.results.every((result) => result.status === "skipped")) {
    addWrapped(lines, "No applicable health checks ran for this command. This does not mean the category is covered.", width);
    lines.push("", `Next: run ${pc.bold("repnix audit")} to see which checks apply to this repository.`);
  } else if (run.summary.findings > 0) {
    if (run.summary.exitCode === 0) {
      addWrapped(lines, `${run.summary.findings} finding${run.summary.findings === 1 ? "" : "s"} were reported, but none meet the configured severity threshold.`, width);
    } else {
      addWrapped(lines, `${run.summary.findings} finding${run.summary.findings === 1 ? "" : "s"} need attention at the configured severity threshold.`, width);
    }
    lines.push("", `Next: run ${pc.bold("repnix explain")} to see what each finding means and where to start.`);
  } else {
    lines.push(pc.green("All configured checks passed. No action is needed right now."));
  }
  return lines.join("\n");
}

function findingLocation(finding: HealthFinding): string {
  if (!finding.file) return "";
  return `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
}

export function renderExplain(run: HealthRun): string {
  const width = terminalWidth();
  const lines: string[] = [pc.bold("Understanding repository health findings"), ""];
  addWrapped(lines, "A finding is a specific issue reported by a health check. A check error means the tool could not complete, so fix the setup or tool problem first.", width);
  lines.push("");
  const groups = new Map<string, HealthFinding[]>();
  for (const result of run.results) {
    for (const finding of result.findings) {
      groups.set(finding.category, [...(groups.get(finding.category) ?? []), finding]);
    }
    if (result.status === "error" && result.message) {
      lines.push(pc.bold(CATEGORY_LABELS[result.category]), rule(width));
      addWrapped(lines, CATEGORY_DESCRIPTIONS[result.category], width);
      lines.push("");
      addWrapped(lines, "What happened: this check could not run to completion.", width);
      addWrapped(lines, result.message, width, "  ", "  ");
      addWrapped(lines, "Next step: check the provider installation and configuration, then run the command again.", width);
      lines.push("");
    }
  }
  for (const [category, findings] of groups) {
    lines.push(pc.bold(CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]), rule(width));
    addWrapped(lines, CATEGORY_DESCRIPTIONS[category as keyof typeof CATEGORY_LABELS], width);
    lines.push("");
    for (const finding of findings) {
      const location = findingLocation(finding);
      const severity = finding.severity === "error"
        ? "error — fix before merging"
        : finding.severity === "warning"
          ? "warning — review soon"
          : "info — worth knowing";
      lines.push(pc.bold(`Severity: ${severity}`));
      addWrapped(lines, "What this means:", width);
      addWrapped(lines, finding.message, width, "  ", "  ");
      if (location) addWrapped(lines, `Where to look: ${pc.cyan(location)}`, width);
      addWrapped(lines, `Reported by: ${finding.provider}${PROVIDER_DESCRIPTIONS[finding.provider] ? ` — ${PROVIDER_DESCRIPTIONS[finding.provider]}` : ""}`, width);
      lines.push("");
    }
  }
  if (!run.summary.findings && !run.summary.errors) {
    lines.push(pc.green("No health findings. All configured checks passed."));
  }
  return lines.join("\n").trimEnd();
}
