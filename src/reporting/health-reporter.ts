import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import { categoryDescription, categoryLabel } from "../core/health-category.js";
import { redactSensitiveText } from "../core/redaction.js";
import type { HealthFinding, HealthRun } from "../core/types.js";
import { builtinProvider, builtinProviderByName } from "../providers/registry.js";
import { groupedCheckResults } from "../tui/check-results-model.js";
import { addWrapped, rule, terminalWidth, visibleLength } from "./terminal-format.js";

function providerDescription(idOrName: string): string | undefined {
  return builtinProvider(idOrName)?.description ?? builtinProviderByName(idOrName)?.description;
}

function healthStatus(status: string): string {
  if (status === "pass") return pc.green("PASS");
  if (status === "error") return pc.red("ERROR");
  if (status === "skipped") return pc.dim("SKIP");
  return pc.yellow("WARN");
}

function healthResultLabel(status: string, findings: number): string {
  if (status === "pass") return "passed";
  if (status === "error") return "setup needed";
  if (status === "skipped") return "not run";
  return `${findings} finding${findings === 1 ? "" : "s"}`;
}

function findingLocation(finding: HealthFinding): string {
  if (!finding.file) return "";
  return `${finding.file}${finding.line ? `:${finding.line}` : ""}`;
}

/** Render the summary table and next-step guidance for a health check run. */
export function renderHealth(run: HealthRun): string {
  const width = terminalWidth();
  const lines = [pc.bold("Repository health check"), ""];
  addWrapped(lines, "RepNix ran the health checks that are configured and active in this repository.", width);
  lines.push("");
  const statusColumn = "STATUS";
  const categoryColumn = "CHECK";
  const resultColumn = "RESULT";
  const categoryWidth = 24;
  const resultWidth = 14;
  lines.push(
    pc.dim(
      `${statusColumn.padEnd(8)} ${categoryColumn.padEnd(categoryWidth)} ${resultColumn.padEnd(resultWidth)} PROVIDER`,
    ),
  );
  for (const group of groupedCheckResults(run)) {
    const providers = group.results.map((result) => result.name).join(", ");
    const prefix = `${group.status.padEnd(8)} ${group.label.padEnd(categoryWidth)} ${healthResultLabel(group.status, group.findings).padEnd(resultWidth)} `;
    addWrapped(
      lines,
      providers,
      width,
      `${healthStatus(group.status)}${prefix.slice(group.status.length)}`,
      " ".repeat(visibleLength(prefix)),
    );
  }
  lines.push("");
  if (run.summary.errors > 0) {
    addWrapped(
      lines,
      `${run.summary.errors} check${run.summary.errors === 1 ? "" : "s"} could not finish. This is a configuration or tool problem, not necessarily a problem in your code.`,
      width,
    );
    lines.push("", `Next: run ${pc.bold("repnix check --details")} to see what happened.`);
  } else if (run.results.length === 0 || run.results.every((result) => result.status === "skipped")) {
    addWrapped(
      lines,
      "No applicable health checks ran for this command. This does not mean the category is covered.",
      width,
    );
    lines.push("", `Next: run ${pc.bold("repnix audit")} to see which checks apply to this repository.`);
  } else if (run.summary.findings > 0) {
    if (run.summary.exitCode === 0) {
      if (run.summary.existingFindings > 0 && run.summary.newFindings === 0) {
        addWrapped(
          lines,
          `${run.summary.existingFindings} existing finding${run.summary.existingFindings === 1 ? " is" : "s are"} tracked by the baseline. No new findings need attention.`,
          width,
        );
      } else {
        addWrapped(
          lines,
          `${run.summary.findings} finding${run.summary.findings === 1 ? "" : "s"} were reported, but none meet the configured severity threshold.`,
          width,
        );
      }
    } else {
      const baseline =
        run.summary.existingFindings > 0
          ? ` ${run.summary.existingFindings} existing finding${run.summary.existingFindings === 1 ? " is" : "s are"} tracked by the baseline.`
          : "";
      addWrapped(
        lines,
        `${run.summary.newFindings} new finding${run.summary.newFindings === 1 ? "" : "s"} need attention at the configured severity threshold.${baseline}`,
        width,
      );
    }
    lines.push("", `Next: run ${pc.bold("repnix check --details")} to see what each finding means and where to start.`);
  } else {
    lines.push(pc.green("All configured checks passed. No action is needed right now."));
  }
  return lines.join("\n");
}

/** Render detailed health check errors and grouped findings for terminal inspection. */
export function renderHealthDetails(run: HealthRun): string {
  const width = terminalWidth();
  const lines: string[] = [pc.bold("Repository health — details"), ""];
  addWrapped(
    lines,
    "Start with check errors: they usually mean a tool needs setup, not that your code is broken. Findings are grouped so you can focus on the next action.",
    width,
  );
  lines.push("");
  const groups = new Map<string, HealthFinding[]>();
  const labelFor = (category: string) =>
    run.repository.categories?.find((entry) => entry.id === category)?.label ?? categoryLabel(category);
  const descriptionFor = (category: string) =>
    run.repository.categories?.find((entry) => entry.id === category)?.description ?? categoryDescription(category);
  for (const result of run.results) {
    for (const finding of result.findings) {
      groups.set(finding.category, [...(groups.get(finding.category) ?? []), finding]);
    }
    if (result.status === "error" && result.message) {
      lines.push(pc.bold(labelFor(result.category)), rule(width));
      addWrapped(lines, `${result.name} needs attention: ${result.message}`, width);
      addWrapped(
        lines,
        `Next: fix it, then run ${pc.bold(`repnix check ${result.category}`)} again. Use ${pc.bold("--verbose")} only if you need technical command diagnostics.`,
        width,
      );
      lines.push("");
    }
  }
  for (const [category, findings] of groups) {
    lines.push(pc.bold(labelFor(category)), rule(width));
    addWrapped(lines, descriptionFor(category), width);
    lines.push("");
    const visibleFindings = findings.slice(0, 5);
    for (const finding of visibleFindings) {
      const location = findingLocation(finding);
      const severity =
        finding.severity === "error"
          ? "error — fix before merging"
          : finding.severity === "warning"
            ? "warning — review soon"
            : "info — worth knowing";
      lines.push(pc.bold(`Severity: ${severity}`));
      addWrapped(lines, "What this means:", width);
      addWrapped(lines, finding.message, width, "  ", "  ");
      if (location) addWrapped(lines, `Where to look: ${pc.cyan(location)}`, width);
      addWrapped(
        lines,
        `Reported by: ${finding.provider}${providerDescription(finding.provider) ? ` — ${providerDescription(finding.provider)}` : ""}`,
        width,
      );
      if (finding.baselineState) addWrapped(lines, `Baseline: ${finding.baselineState}`, width);
      if (finding.remediation) addWrapped(lines, `How to fix: ${finding.remediation}`, width);
      if (finding.documentationUrl) addWrapped(lines, `Documentation: ${finding.documentationUrl}`, width);
      if (finding.type === "command-failure" && typeof finding.metadata?.output === "string") {
        addWrapped(lines, "Command output:", width);
        for (const line of redactSensitiveText(stripVTControlCharacters(finding.metadata.output)).split("\n")) {
          addWrapped(lines, line, width, "  ", "  ");
        }
      }
      lines.push("");
    }
    if (findings.length > visibleFindings.length) {
      const files = new Map<string, number>();
      for (const finding of findings) {
        if (finding.file) files.set(finding.file, (files.get(finding.file) ?? 0) + 1);
      }
      addWrapped(
        lines,
        `${findings.length - visibleFindings.length} additional finding${findings.length - visibleFindings.length === 1 ? " is" : "s are"} hidden to keep this report focused.`,
        width,
      );
      const hotspots = [...files.entries()].sort(([, left], [, right]) => right - left).slice(0, 3);
      if (hotspots.length)
        addWrapped(lines, `Most affected: ${hotspots.map(([file, count]) => `${file} (${count})`).join(", ")}.`, width);
      addWrapped(lines, `To inspect every location, run ${pc.bold(`repnix check ${category} --format json`)}.`, width);
      lines.push("");
    }
  }
  if (!run.summary.findings && !run.summary.errors) {
    lines.push(pc.green("No health findings. All configured checks passed."));
  }
  return lines.join("\n").trimEnd();
}

/**
 * Keep the historical renderer name as a compatibility entry point without
 * creating a duplicate export alias that dead-code analysis reports.
 */
export function renderExplain(run: HealthRun): string {
  return renderHealthDetails(run);
}
