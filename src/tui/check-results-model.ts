import { categoryLabel } from "../core/health-category.js";
import type { HealthResult, HealthRun } from "../core/types.js";
import { wrapTerminalText } from "../reporting/terminal-format.js";

export function setupCheckOutputLines(output: string, width: number): string[] {
  const normalized = output.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  return normalized ? wrapTerminalText(normalized, Math.max(width - 6, 20)) : ["The check produced no output."];
}

export interface SetupCheckRow {
  category: string;
  status: HealthResult["status"];
  result: string;
  providers: string;
}

export interface SetupCheckAction {
  kind: "setup" | "fix" | "review";
  title: string;
  detail?: string;
  command: string;
}

export const CHECK_STATUS_RANK = { skipped: 0, pass: 1, warn: 2, fail: 3, error: 4 } as const;

export function parseHealthRun(output: string): HealthRun | null {
  try {
    const parsed: unknown = JSON.parse(output);
    return parsed &&
      typeof parsed === "object" &&
      "results" in parsed &&
      Array.isArray((parsed as { results?: unknown }).results)
      ? (parsed as HealthRun)
      : null;
  } catch {
    return null;
  }
}

export interface GroupedCheckResult {
  category: string;
  label: string;
  results: HealthResult[];
  status: HealthResult["status"];
  findings: number;
}

/** Group health check results by category and compute aggregate status and finding counts. */
export function groupedCheckResults(run: HealthRun): GroupedCheckResult[] {
  const categories = new Map<string, HealthResult[]>();
  for (const result of run.results) {
    categories.set(result.category, [...(categories.get(result.category) ?? []), result]);
  }
  return [...categories.entries()].map(([category, results]) => ({
    category,
    label: run.repository.categories?.find((item) => item.id === category)?.label ?? categoryLabel(category),
    results,
    status: results.reduce(
      (current, item) => (CHECK_STATUS_RANK[item.status] > CHECK_STATUS_RANK[current] ? item.status : current),
      "skipped" as HealthResult["status"],
    ),
    findings: results.reduce((total, item) => total + item.findings.length, 0),
  }));
}

export function setupCheckRows(output: string): SetupCheckRow[] {
  const run = parseHealthRun(output);
  if (!run) return [];
  return groupedCheckResults(run).map((group) => ({
    category: group.label,
    status: group.status,
    result:
      group.status === "pass"
        ? "Passed"
        : group.status === "error"
          ? "Setup needed"
          : group.status === "skipped"
            ? "Not run"
            : `${group.findings} finding${group.findings === 1 ? "" : "s"}`,
    providers: group.results.map((item) => item.name).join(", "),
  }));
}

export function setupCheckCommand(run: HealthRun, result: HealthResult): string {
  const manager = run.repository.packageManager ?? "npm";
  if (result.provider.startsWith("script:")) return `${manager} run ${result.provider.slice("script:".length)}`;
  const healthScripts: Record<string, string> = {
    c8: "health:coverage",
    knip: "health:dead-code",
    jscpd: "health:duplication",
    "dependency-cruiser": "health:architecture",
    "license-checker": "health:licenses",
    markdownlint: "health:documentation",
  };
  const script = healthScripts[result.provider];
  return script ? `${manager} run ${script}` : `repnix check ${result.category} --details`;
}

function conciseCheckError(result: HealthResult): string {
  if (/output exceeded/i.test(result.message ?? ""))
    return `${result.name} produced too much output to display. Run the documentation check directly to inspect it.`;
  if (/ENOENT|local executable is unavailable/i.test(result.message ?? ""))
    return `${result.name} is unavailable. Install dependencies, then run this check again.`;
  return `${result.name} needs attention. Run repnix check ${result.category} --details for the cause.`;
}

export function setupCheckActions(output: string): SetupCheckAction[] {
  const run = parseHealthRun(output);
  if (!run) return [];
  return groupedCheckResults(run)
    .filter((group) => group.status === "error" || group.status === "fail" || group.status === "warn")
    .sort(
      (left, right) =>
        CHECK_STATUS_RANK[right.status] - CHECK_STATUS_RANK[left.status] || right.findings - left.findings,
    )
    .map((group) => {
      const primary = group.results.find((result) => result.status === group.status) ?? group.results[0]!;
      if (group.status === "error") {
        return {
          kind: "setup",
          title: `Set up ${group.label}`,
          detail: conciseCheckError(primary),
          command: setupCheckCommand(run, primary),
        };
      }
      const count = `${group.findings} finding${group.findings === 1 ? "" : "s"}`;
      return {
        kind: group.status === "fail" ? "fix" : "review",
        title: `${group.status === "fail" ? "Fix" : "Review"} ${group.label} (${count})`,
        command: setupCheckCommand(run, primary),
      };
    });
}

export function tuiPanelContentWidth(width: number): number {
  return Math.max(width - 6, 20);
}

export function clipTuiLine(text: string, width: number): string {
  const limit = Math.max(width, 0);
  if (text.length === limit) return text;
  if (text.length < limit) return `${text}${" ".repeat(limit - text.length)}`;
  return text.slice(0, limit);
}

export function checkDetailViewport(viewport: number): number {
  return Math.max(viewport - 1, 1);
}

export function checkTableColumns(contentWidth: number): {
  status: number;
  check: number;
  result: number;
  provider: number;
} {
  const width = Math.max(contentWidth, 1);
  const status = Math.min(9, width);
  if (width >= 61) return { status: 9, check: 27, result: 17, provider: width - 53 };
  const rest = Math.max(width - status, 0);
  const check = Math.min(27, Math.floor(rest * 0.45));
  const afterCheck = Math.max(rest - check, 0);
  const result = Math.min(17, Math.floor(afterCheck * 0.55));
  return { status, check, result, provider: Math.max(afterCheck - result, 0) };
}

export type SetupCheckDetailStyle =
  "success" | "warning" | "danger" | "info" | "heading" | "muted" | "primary" | "body";

export type SetupCheckDetailItem =
  | { kind: "text"; text: string; style: SetupCheckDetailStyle; bold?: boolean }
  | { kind: "blank" }
  | { kind: "table-header" }
  | { kind: "table-row"; row: SetupCheckRow };

export function setupCheckDetailItems(
  output: string,
  width: number,
  extras: { reportPath?: string; summaryPath?: string; exitCode?: number | null } = {},
): SetupCheckDetailItem[] {
  const rows = setupCheckRows(output);
  const contentWidth = tuiPanelContentWidth(width);
  if (!rows.length) {
    const passed = extras.exitCode === 0;
    const exitLabel =
      extras.exitCode === null ? "could not start" : `finished with exit code ${extras.exitCode ?? "unknown"}`;
    return [
      {
        kind: "text",
        text: passed ? "● Check completed successfully." : `◆ Check ${exitLabel}.`,
        style: passed ? "success" : "warning",
      },
      ...setupCheckOutputLines(output, width).map((line) =>
        line ? { kind: "text" as const, text: line, style: "body" as const } : { kind: "blank" as const },
      ),
    ];
  }
  const run = parseHealthRun(output);
  const actions = setupCheckActions(output);
  const errors = run?.results.filter((result) => result.status === "error") ?? [];
  const findings = run?.results.reduce((total, result) => total + result.findings.length, 0) ?? 0;
  const summary = errors.length
    ? `${errors.length} setup issue${errors.length === 1 ? "" : "s"}${findings ? ` · ${findings} finding${findings === 1 ? "" : "s"} to review` : ""}`
    : findings
      ? `${findings} finding${findings === 1 ? "" : "s"} to review`
      : "All checks completed";
  const items: SetupCheckDetailItem[] = [
    {
      kind: "text",
      text: summary,
      style: errors.length || findings ? "warning" : "success",
      bold: true,
    },
    { kind: "blank" },
    { kind: "table-header" },
    ...rows.map((row) => ({ kind: "table-row" as const, row })),
  ];
  if (actions.length) {
    items.push(
      { kind: "blank" },
      { kind: "text", text: "NEXT STEPS · DO THESE IN ORDER", style: "heading", bold: true },
    );
    actions.slice(0, 4).forEach((action, index) => {
      items.push({
        kind: "text",
        text: `${index + 1}. ${action.title}`,
        style: action.kind === "setup" ? "danger" : action.kind === "fix" ? "warning" : "info",
        bold: true,
      });
      if (action.detail) items.push({ kind: "text", text: `   ${action.detail}`, style: "muted" });
      items.push({ kind: "text", text: `   $ ${action.command}`, style: "primary" });
    });
    items.push({ kind: "blank" }, { kind: "text", text: "Verify: $ repnix check", style: "muted" });
  }
  if (extras.summaryPath) items.push({ kind: "text", text: `Runbook saved: ${extras.summaryPath}`, style: "muted" });
  if (extras.reportPath) {
    wrapTerminalText(`AI-ready report saved: ${extras.reportPath}`, contentWidth).forEach((line) => {
      items.push({ kind: "text", text: line, style: "muted" });
    });
    wrapTerminalText(
      "Next: attach or drop this file into your AI coding assistant, then run `repnix check` after reviewing its changes.",
      contentWidth,
    ).forEach((line) => {
      items.push({ kind: "text", text: line, style: "primary" });
    });
  }
  return items;
}
