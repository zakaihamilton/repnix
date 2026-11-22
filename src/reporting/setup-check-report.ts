import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HealthFinding } from "../core/types.js";
import { parseHealthRun, setupCheckActions, setupCheckCommand, setupCheckRows } from "../tui/check-results-model.js";

export interface SavedSetupCheckReports {
  reportPath: string;
  summaryPath: string;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function markdownCode(value: string): string {
  return value.replaceAll("`", "\\`").replaceAll("\n", " ");
}

function findingLocation(finding: HealthFinding): string | undefined {
  return finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ""}` : ""}`
    : undefined;
}

function findingMetadata(finding: HealthFinding): string | undefined {
  if (!finding.metadata || Object.keys(finding.metadata).length === 0) return undefined;
  return JSON.stringify(finding.metadata, null, 2).replaceAll("```", "``\\`");
}

function checkStatusLabelForFile(status: "pass" | "warn" | "fail" | "error" | "skipped"): string {
  return status === "pass" ? "PASS" : status === "error" ? "ERROR" : status === "skipped" ? "SKIP" : "WARN";
}

function appendCheckResultsTable(lines: string[], rows: ReturnType<typeof setupCheckRows>): void {
  lines.push("| Status | Check | Result | Provider |", "| --- | --- | --- | --- |");
  for (const row of rows)
    lines.push(
      `| ${checkStatusLabelForFile(row.status)} | ${markdownCell(row.category)} | ${markdownCell(row.result)} | ${markdownCell(row.providers)} |`,
    );
}

/** Render the full AI-ready markdown health report from `repnix check --format json` output. */
export function renderSetupHealthReport(output: string): string {
  const run = parseHealthRun(output);
  if (!run)
    return [
      "# RepNix health report",
      "",
      "The health check did not produce structured results, so RepNix could not create an AI-ready report.",
      "",
      "Run `repnix check` again and include its output when asking for help.",
      "",
    ].join("\n");
  const rows = setupCheckRows(output);
  const actions = setupCheckActions(output);
  const lines = [
    "# RepNix health report",
    "",
    "This report is designed to be attached to an AI coding assistant so it can investigate and fix the reported repository-health issues.",
    "",
    "## How to use this report",
    "",
    "From the repository root, attach or drop this file into your AI coding assistant and send the following request:",
    "",
    "> Read `.repnix/health-report.md`, inspect the referenced files, and fix the reported repository-health issues. Make the smallest safe changes, preserve intended behavior, and do not suppress or baseline findings. Run the verification commands in the report, then summarize the changes and any remaining issues.",
    "",
    "Keep the assistant working in this repository so it can inspect the referenced files and run the verification commands. Review its changes, then run `repnix check` yourself to confirm the result.",
    "",
    "## Instructions for an AI assistant",
    "",
    "1. Work only on the issues in this report, starting with setup errors and failed checks.",
    "2. Inspect the referenced files and make the smallest safe changes that resolve the findings.",
    "3. Preserve intended behaviour and do not suppress, baseline, or disable a check merely to make it pass unless explicitly asked.",
    "4. Run the listed verification commands after making changes and report anything that remains.",
    "",
    "## Repository context",
    "",
    `- Package manager: ${run.repository.packageManager ?? "unknown"}`,
    `- Repository root: ${run.repository.root ?? "unknown"}`,
    `- Generated: ${run.generatedAt ?? "unknown"}`,
    "",
    "## Check results",
    "",
  ];
  appendCheckResultsTable(lines, rows);
  lines.push("", "## Recommended fix order", "");
  if (actions.length) {
    actions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action.title}`);
      if (action.detail) lines.push(`   - Why: ${markdownCell(action.detail)}`);
      lines.push(`   - Run: \`${markdownCode(action.command)}\``);
    });
  } else {
    lines.push("All configured checks passed.");
  }
  lines.push("", "## Complete finding details");
  run.results.forEach((result, resultIndex) => {
    const category = run.repository.categories?.find((item) => item.id === result.category)?.label ?? result.category;
    const command = setupCheckCommand(run, result);
    lines.push(
      "",
      `### ${resultIndex + 1}. ${markdownCell(category)} — ${markdownCell(result.name)}`,
      "",
      `- Status: ${checkStatusLabelForFile(result.status)}`,
      `- Run: \`${markdownCode(command)}\``,
      `- Findings: ${result.findings.length}`,
    );
    if (result.message) lines.push(`- Check message: ${markdownCell(result.message)}`);
    if (result.scope) lines.push(`- Scope: ${markdownCode(result.scope)}`);
    result.findings.forEach((finding, findingIndex) => {
      lines.push(
        "",
        `#### Finding ${findingIndex + 1}: ${markdownCell(finding.title ?? finding.ruleId ?? finding.type)}`,
        "",
        `- Severity: ${finding.severity}`,
        `- Message: ${markdownCell(finding.message)}`,
      );
      const location = findingLocation(finding);
      if (location) lines.push(`- Location: \`${markdownCode(location)}\``);
      if (finding.ruleId) lines.push(`- Rule: \`${markdownCode(finding.ruleId)}\``);
      if (finding.remediation) lines.push(`- Suggested remediation: ${markdownCell(finding.remediation)}`);
      if (finding.documentationUrl) lines.push(`- Documentation: ${finding.documentationUrl}`);
      if (finding.baselineState) lines.push(`- Baseline: ${finding.baselineState}`);
      const metadata = findingMetadata(finding);
      if (metadata)
        lines.push(
          "",
          "<details>",
          "<summary>Tool context</summary>",
          "",
          "```json",
          metadata,
          "```",
          "",
          "</details>",
        );
    });
  });
  lines.push("", "## Verify", "", "```sh", "repnix check", "```", "");
  return lines.join("\n");
}

/** Render the concise setup check runbook summary markdown file. */
export function renderSetupCheckSummary(output: string): string {
  const rows = setupCheckRows(output);
  const actions = setupCheckActions(output);
  const lines = ["# Check results", "", "## Summary", ""];
  appendCheckResultsTable(lines, rows);
  lines.push("", "## Next steps", "", "Run these commands from the repository root, in order.", "");
  if (actions.length) {
    actions.forEach((action, index) => {
      lines.push(`${index + 1}. ${action.title}`);
      if (action.detail) lines.push(`   ${action.detail}`);
      lines.push("", "   ```sh", `   ${action.command}`, "   ```", "");
    });
  } else {
    lines.push("All configured checks passed.", "");
  }
  lines.push("", "## Verify", "", "```sh", "repnix check", "```", "");
  return lines.join("\n");
}

/** Persist the AI-ready report and check summary into `.repnix/` when output is valid JSON. */
export async function saveSetupCheckReports(root: string, output: string): Promise<SavedSetupCheckReports | undefined> {
  try {
    JSON.parse(output);
    const directory = path.join(root, ".repnix");
    const reportPath = ".repnix/health-report.md";
    const summaryPath = ".repnix/check-results.md";
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, reportPath), renderSetupHealthReport(output), "utf8");
    await writeFile(path.join(root, summaryPath), renderSetupCheckSummary(output), "utf8");
    return { reportPath, summaryPath };
  } catch {
    // A failed command may not produce JSON; preserve its visible error without
    // replacing a prior usable report with malformed output.
    return undefined;
  }
}
