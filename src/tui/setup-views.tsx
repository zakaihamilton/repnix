import React from "react";
import { Box, Newline, Text } from "ink";
import { CATEGORY_LABELS } from "../core/health-category.js";
import type { HealthResult, HealthRun, InstallPlan } from "../core/types.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import { renderFileDiff } from "../setup/file-plan.js";
import { selectionItems, type SetupSelectionItem, type SetupTuiModel } from "./setup-state.js";
import {
  auditPageSummary,
  auditRecommendationSummary,
  auditSetupOptions,
  manualRecommendationLines,
  manualRecommendationViewport,
  selectedSetupOptions,
} from "./setup-helpers.js";
import {
  clampTuiScroll,
  diffLineColor,
  foregroundColor,
  normalizeTuiDiffLine,
  selectionRowPresentation,
  SIDEBAR_CONTENT_WIDTH,
  SIDEBAR_WIDTH,
  textColor,
  type SetupPaneLayout,
  type SetupTuiTheme,
  type TuiLayoutMetrics,
} from "./setup-theme.js";
import {
  CheckDetailView,
  CiDetailView,
  ConfirmButton,
  Panel,
  planStats,
  ReviewNotes,
  ScrollHint,
} from "./setup-components.js";
import { wrapTerminalText } from "../reporting/console-reporter.js";

export const AUDIT_LABEL_COLUMN_WIDTH = 25;
export const AUDIT_TWO_COLUMN_MIN_WIDTH = 120;

export function auditUsesSingleColumn(width: number): boolean {
  return width < AUDIT_TWO_COLUMN_MIN_WIDTH;
}

function providerFor(items: SetupSelectionItem[], model: SetupTuiModel): SetupSelectionItem | undefined {
  return items[model.cursor];
}

function auditCoverageRow(entry: AuditModel["coverage"][number], theme: SetupTuiTheme): React.ReactElement {
  const status =
    entry.status === "covered"
      ? { symbol: "✓", color: theme.success }
      : entry.status === "partial"
        ? { symbol: "◐", color: theme.warning }
        : entry.status === "missing"
          ? { symbol: "✗", color: theme.danger }
          : entry.status === "off"
            ? { symbol: "–", color: theme.muted }
            : { symbol: "·", color: theme.muted };
  return (
    <Box key={entry.category} flexDirection="row" overflow="hidden">
      <Box width={2} flexShrink={0}>
        <Text color={status.color}>{status.symbol}</Text>
      </Box>
      <Box width={AUDIT_LABEL_COLUMN_WIDTH} flexShrink={0}>
        <Text {...textColor(theme)} wrap="truncate-end">
          {CATEGORY_LABELS[entry.category]}
        </Text>
      </Box>
      {entry.providers.length ? (
        <Text color={status.color} wrap="truncate-end">
          {entry.providers.join(", ")}
        </Text>
      ) : null}
    </Box>
  );
}

export function AuditView({
  audit,
  singleColumn,
  scroll,
  viewport,
  theme,
}: {
  audit: AuditModel;
  singleColumn: boolean;
  scroll: number;
  viewport: number;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const page = auditPageSummary(audit);
  const summary = auditRecommendationSummary(audit.recommendations, true);
  const setupOptions = auditSetupOptions(audit);
  const relevantCoverage = audit.coverage.filter((entry) => entry.status !== "not-applicable");
  const coverageLines = singleColumn
    ? relevantCoverage.map((entry) => auditCoverageRow(entry, theme))
    : Array.from({ length: Math.ceil(relevantCoverage.length / 2) }, (_, index) => (
        <Box key={`coverage-row-${index}`} flexDirection="row" gap={2} overflow="hidden">
          <Box width="50%" flexShrink={0}>
            {relevantCoverage[index] ? auditCoverageRow(relevantCoverage[index]!, theme) : null}
          </Box>
          <Box width="50%" flexShrink={0}>
            {relevantCoverage[index + Math.ceil(relevantCoverage.length / 2)]
              ? auditCoverageRow(relevantCoverage[index + Math.ceil(relevantCoverage.length / 2)]!, theme)
              : null}
          </Box>
        </Box>
      ));
  const lines: React.ReactNode[] = [
    <Text key="repository" {...textColor(theme)}>
      Repository: <Text color={theme.primary}>{page.repositoryName}</Text>
    </Text>,
    <Text key="package-manager" {...textColor(theme)}>
      Package manager: <Text color={theme.primary}>{page.packageManager}</Text> · CI: {page.ci}
    </Text>,
    <Text key="facts" {...textColor(theme)} wrap="truncate-end">
      Roles: {page.roles.join(", ") || "none detected"} · Languages: {page.languages.join(", ") || "none detected"} ·
      Workspaces: {page.workspaceCount}
    </Text>,
    <Newline key="facts-gap" />,
    <Text key="coverage-heading" color={theme.secondary} bold>
      HEALTH COVERAGE
    </Text>,
    ...coverageLines,
    <Newline key="coverage-gap" />,
    <Text key="next-steps-heading" color={theme.secondary} bold>
      NEXT STEPS
    </Text>,
    <Text key="recommendations" {...textColor(theme)}>
      Actionable recommendations: {summary.baseline} baseline · {summary.optional} optional · {summary.advanced}{" "}
      advanced
    </Text>,
    ...(setupOptions.length
      ? [
          <Text key="setup-options" {...textColor(theme)} wrap="wrap">
            Setup options: {setupOptions.join(" · ")}
          </Text>,
        ]
      : []),
    <Text key="prompt" color={setupOptions.length ? theme.primary : theme.success} bold>
      {setupOptions.length
        ? "Press Enter to choose checks and continue setup."
        : "No actionable setup changes were found. Press Enter to finish."}
    </Text>,
  ];
  const start = clampTuiScroll(scroll, lines.length, Math.max(viewport, 1));
  const visible = lines.slice(start, start + Math.max(viewport, 1));
  return (
    <Panel title="Repository audit" theme={theme} borderColor={theme.info}>
      {visible}
      {start + visible.length < lines.length ? <Text color={theme.muted}>↓ more · use ↑↓ to scroll</Text> : null}
    </Panel>
  );
}

export function ManualRecommendationsView({
  audit,
  scroll,
  viewport,
  width,
  theme,
}: {
  audit: AuditModel;
  scroll: number;
  viewport: number;
  width: number;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const lines = manualRecommendationLines(audit, Math.max(width - 6, 20));
  const contentViewport = manualRecommendationViewport(viewport);
  const start = clampTuiScroll(scroll, lines.length, contentViewport);
  const visible = lines.slice(start, start + contentViewport);
  const hasMore = start + visible.length < lines.length;
  return (
    <Panel
      title={`Manual recommendations (${audit.recommendations.filter((recommendation) => !recommendation.actionable).length})`}
      theme={theme}
      borderColor={theme.warning}
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {visible.map((line, index) =>
          line === "" ? (
            <Newline key={`${start + index}-blank`} />
          ) : (
            <Text
              key={`${start + index}-${line}`}
              {...(line.includes("HOW TO DO IT")
                ? { color: theme.secondary, bold: true }
                : line.match(/ · (baseline|optional|advanced)$/)
                  ? { color: theme.warning, bold: true }
                  : textColor(theme))}
            >
              {line}
            </Text>
          ),
        )}
      </Box>
      <ScrollHint hasMore={hasMore} theme={theme} />
    </Panel>
  );
}

function SplitLayout({
  horizontal,
  showSidebar,
  sidebar,
  showDetails,
  details,
}: {
  horizontal: boolean;
  showSidebar: boolean;
  sidebar: React.ReactElement;
  showDetails: boolean;
  details: React.ReactElement;
}): React.ReactElement {
  return (
    <Box
      flexDirection={horizontal ? "row" : "column"}
      gap={horizontal ? 1 : 0}
      flexGrow={1}
      minHeight={1}
      overflow="hidden"
    >
      {showSidebar ? sidebar : null}
      {showDetails ? details : null}
    </Box>
  );
}

export function SelectView({
  audit,
  model,
  theme,
  paneLayout,
}: {
  audit: AuditModel;
  model: SetupTuiModel;
  theme: SetupTuiTheme;
  paneLayout: SetupPaneLayout;
}): React.ReactElement {
  const items = selectionItems(audit.recommendations, audit.context.hasCI);
  const selected = providerFor(items, model);
  const recommendation =
    selected?.kind === "provider"
      ? audit.recommendations.find((item) => item.provider === selected.provider)
      : undefined;
  const horizontal = paneLayout === "horizontal";
  const focusedSidebar = paneLayout === "focused-sidebar";
  const showSidebar = !focusedSidebar || !model.sidebarCollapsed;
  const showDetails = !focusedSidebar || model.sidebarCollapsed;
  const sidebar = (
    <Panel
      title="Recommended checks"
      width={horizontal ? SIDEBAR_WIDTH : "100%"}
      flexGrow={0}
      flexShrink={0}
      fill={horizontal}
      theme={theme}
      borderColor={theme.borderStrong}
    >
      {items.map((item, index) => {
        const checked = item.kind === "ci" ? model.includeCi : model.selectedProviders.includes(item.provider);
        const active = index === model.cursor;
        const itemRecommendation =
          item.kind === "provider"
            ? audit.recommendations.find((entry) => entry.provider === item.provider)
            : undefined;
        const presentation = selectionRowPresentation(
          item.name,
          checked,
          active,
          itemRecommendation?.priority,
          theme,
          SIDEBAR_CONTENT_WIDTH,
        );
        return (
          <Text
            key={item.kind === "ci" ? item.name : item.provider}
            {...foregroundColor(presentation.color)}
            {...(presentation.backgroundColor ? { backgroundColor: presentation.backgroundColor } : {})}
            bold={presentation.bold}
            wrap="truncate-end"
          >
            {presentation.label}
          </Text>
        );
      })}
      {items.length === 0 ? <Text color={theme.success}>No setup changes are recommended.</Text> : null}
    </Panel>
  );
  const details = (
    <Panel
      width="100%"
      title={
        recommendation
          ? `${recommendation.name} · ${CATEGORY_LABELS[recommendation.category] ?? recommendation.category}`
          : (selected?.name ?? "Setup overview")
      }
      flexGrow={1}
      fill={horizontal}
      theme={theme}
      borderColor={recommendation ? theme.primary : theme.border}
    >
      {recommendation ? (
        <CheckDetailView
          recommendation={recommendation}
          context={audit.context}
          registry={audit.registry}
          theme={theme}
        />
      ) : selected?.kind === "ci" ? (
        <CiDetailView context={audit.context} theme={theme} />
      ) : (
        <Text color={theme.muted}>Select a check to see why it is recommended and what it will add.</Text>
      )}
    </Panel>
  );
  return (
    <SplitLayout
      horizontal={horizontal}
      showSidebar={showSidebar}
      sidebar={sidebar}
      showDetails={showDetails}
      details={details}
    />
  );
}

export function ReviewView({
  plan,
  model,
  theme,
  paneLayout,
}: {
  plan: InstallPlan;
  model: SetupTuiModel;
  theme: SetupTuiTheme;
  paneLayout: SetupPaneLayout;
}): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  const horizontal = paneLayout === "horizontal";
  const focusedSidebar = paneLayout === "focused-sidebar";
  const showSidebar = !focusedSidebar || !model.sidebarCollapsed;
  const showDetails = !focusedSidebar || model.sidebarCollapsed;
  const sidebar = (
    <Panel
      title="Planned changes"
      width={horizontal ? SIDEBAR_WIDTH : "100%"}
      flexGrow={0}
      flexShrink={0}
      fill={horizontal}
      theme={theme}
      borderColor={theme.borderStrong}
    >
      <Text color={theme.primary} bold>
        {planStats(plan)}
      </Text>
      <Newline />
      <Text color={theme.secondary} bold>
        PACKAGES
      </Text>
      {plan.packages.length ? (
        plan.packages.map((item) => (
          <Text key={item.name} {...textColor(theme)}>
            {" "}
            + {item.name}
            {item.version ? `@${item.version}` : ""}
          </Text>
        ))
      ) : (
        <Text color={theme.muted}> none</Text>
      )}
      <Newline />
      <Text color={theme.secondary} bold>
        FILES
      </Text>
      {plan.files.length ? (
        plan.files.map((item, index) => (
          <Text
            key={item.path}
            {...(index === model.reviewCursor
              ? { color: theme.primary, backgroundColor: theme.active }
              : textColor(theme))}
            bold={index === model.reviewCursor}
          >{`${index === model.reviewCursor ? "▸" : " "} ${item.kind === "create" ? "A" : "M"} ${item.path}`}</Text>
        ))
      ) : (
        <Text color={theme.muted}> none</Text>
      )}
      {plan.warnings.length ? (
        <>
          <Newline />
          <Text color={theme.warning}>◆ Warnings: {plan.warnings.length}</Text>
        </>
      ) : null}
      {plan.conflicts.length ? <Text color={theme.warning}>◆ Conflicts preserved: {plan.conflicts.length}</Text> : null}
    </Panel>
  );
  const details = (
    <Panel
      width="100%"
      title={file ? `Detail · ${file.path}` : "Review summary"}
      flexGrow={1}
      fill={horizontal}
      theme={theme}
      borderColor={plan.warnings.length || plan.conflicts.length ? theme.warning : theme.border}
    >
      {file ? (
        <>
          <Text color={theme.muted}>{file.reason}</Text>
          <Newline />
          <Text color={theme.info}>Press Space to inspect this file.</Text>
        </>
      ) : (
        <Text color={theme.muted}>No file changes are planned. Press Enter to continue.</Text>
      )}
      {plan.commands.length ? (
        <>
          <Newline />
          <Text color={theme.secondary} bold>
            COMMANDS
          </Text>
          {plan.commands.map((command) => (
            <Text
              key={command.command}
              {...textColor(theme)}
            >{`  $ ${command.command} ${command.args.join(" ")}`}</Text>
          ))}
        </>
      ) : null}
      <Newline />
      <Text color={theme.secondary} bold>
        REVIEW NOTES
      </Text>
      <ReviewNotes plan={plan} theme={theme} />
    </Panel>
  );
  return (
    <SplitLayout
      horizontal={horizontal}
      showSidebar={showSidebar}
      sidebar={sidebar}
      showDetails={showDetails}
      details={details}
    />
  );
}

export function DetailsView({
  plan,
  model,
  width,
  layout,
  theme,
}: {
  plan: InstallPlan;
  model: SetupTuiModel;
  width: number;
  layout: TuiLayoutMetrics;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  if (!file)
    return (
      <Panel title="Details" theme={theme}>
        <Text color={theme.muted}>There are no file details to show.</Text>
      </Panel>
    );
  const diff = renderFileDiff(file, Math.max(width - 8, 32))
    .split("\n")
    .map(normalizeTuiDiffLine);
  const scroll = clampTuiScroll(model.detailScroll, diff.length, layout.detailViewport);
  const visible = diff.slice(scroll, scroll + layout.detailViewport);
  return (
    <Panel title={`File detail · ${file.path}`} theme={theme} borderColor={theme.info}>
      <Text color={theme.muted}>{file.reason}</Text>
      <Newline />
      {visible.map((line, index) => (
        <Text key={`${index}-${line}`} {...foregroundColor(diffLineColor(line, theme))}>
          {line}
        </Text>
      ))}
      {scroll + visible.length < diff.length ? <Text color={theme.muted}>↓ more</Text> : null}
    </Panel>
  );
}

export function ApplyView({
  plan,
  model,
  theme,
}: {
  plan: InstallPlan;
  model: SetupTuiModel;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const activity = model.progressLog ?? [model.progress ?? "Starting safe apply…"];
  return (
    <Panel title="Applying safely" theme={theme} borderColor={theme.warning}>
      <Text color={theme.warning}>◌ Changes are being revalidated and applied in the reviewed order.</Text>
      <Text color={theme.muted}>
        {planStats(plan)} · {plan.commands.length} install command{plan.commands.length === 1 ? "" : "s"}
      </Text>
      <Newline />
      <Text color={theme.secondary} bold>
        ACTIVITY
      </Text>
      {activity.map((message, index) => (
        <Text key={`${index}-${message}`} color={index === activity.length - 1 ? theme.primary : theme.muted}>
          {index === activity.length - 1 ? "▸" : "·"} {message}
        </Text>
      ))}
    </Panel>
  );
}

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

const CHECK_STATUS_RANK = { skipped: 0, pass: 1, warn: 2, fail: 3, error: 4 } as const;

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

export function setupCheckRows(output: string): SetupCheckRow[] {
  const run = parseHealthRun(output);
  if (!run) return [];
  const categories = new Map<string, HealthResult[]>();
  for (const result of run.results)
    categories.set(result.category, [...(categories.get(result.category) ?? []), result]);
  return [...categories.entries()].map(([category, results]) => {
    const status = results.reduce(
      (current, item) => (CHECK_STATUS_RANK[item.status] > CHECK_STATUS_RANK[current] ? item.status : current),
      "skipped" as HealthResult["status"],
    );
    const findings = results.reduce((total, item) => total + item.findings.length, 0);
    return {
      category:
        run.repository.categories?.find((item) => item.id === category)?.label ?? CATEGORY_LABELS[category] ?? category,
      status,
      result:
        status === "pass"
          ? "Passed"
          : status === "error"
            ? "Setup needed"
            : status === "skipped"
              ? "Not run"
              : `${findings} finding${findings === 1 ? "" : "s"}`,
      providers: results.map((item) => item.name).join(", "),
    };
  });
}

function groupedCheckResults(
  run: HealthRun,
): Array<{ category: string; results: HealthResult[]; status: HealthResult["status"]; findings: number }> {
  const categories = new Map<string, HealthResult[]>();
  for (const result of run.results)
    categories.set(result.category, [...(categories.get(result.category) ?? []), result]);
  return [...categories.entries()].map(([category, results]) => ({
    category,
    results,
    status: results.reduce(
      (current, item) => (CHECK_STATUS_RANK[item.status] > CHECK_STATUS_RANK[current] ? item.status : current),
      "skipped" as HealthResult["status"],
    ),
    findings: results.reduce((total, item) => total + item.findings.length, 0),
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
      const label =
        run.repository.categories?.find((item) => item.id === group.category)?.label ??
        CATEGORY_LABELS[group.category] ??
        group.category;
      if (group.status === "error") {
        return {
          kind: "setup",
          title: `Set up ${label}`,
          detail: conciseCheckError(primary),
          command: setupCheckCommand(run, primary),
        };
      }
      const count = `${group.findings} finding${group.findings === 1 ? "" : "s"}`;
      return {
        kind: group.status === "fail" ? "fix" : "review",
        title: `${group.status === "fail" ? "Fix" : "Review"} ${label} (${count})`,
        command: setupCheckCommand(run, primary),
      };
    });
}

function checkStatusColor(status: HealthResult["status"], theme: SetupTuiTheme): string {
  return status === "pass"
    ? theme.success
    : status === "error"
      ? theme.danger
      : status === "skipped"
        ? theme.muted
        : theme.warning;
}

function checkStatusLabel(status: HealthResult["status"]): string {
  return status === "pass" ? "PASS" : status === "error" ? "ERROR" : status === "skipped" ? "SKIP" : "WARN";
}

function conciseCheckError(result: HealthResult): string {
  if (/output exceeded/i.test(result.message ?? ""))
    return `${result.name} produced too much output to display. Run the documentation check directly to inspect it.`;
  if (/ENOENT|local executable is unavailable/i.test(result.message ?? ""))
    return `${result.name} is unavailable. Install dependencies, then run this check again.`;
  return `${result.name} needs attention. Run repnix check ${result.category} --details for the cause.`;
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
    { kind: "text", text: summary, style: errors.length || findings ? "warning" : "success", bold: true },
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
    wrapTerminalText(`AI-ready report saved: ${extras.reportPath}`, contentWidth).forEach((line) =>
      items.push({ kind: "text", text: line, style: "muted" }),
    );
    wrapTerminalText(
      "Next: attach or drop this file into your AI coding assistant, then run `repnix check` after reviewing its changes.",
      contentWidth,
    ).forEach((line) => items.push({ kind: "text", text: line, style: "primary" }));
  }
  return items;
}

function FrozenLine({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Box flexDirection="column" height={1} flexShrink={0} width="100%" overflow="hidden">
      {children}
    </Box>
  );
}

function CheckTableRow({
  columns,
  status,
  check,
  result,
  providers,
  theme,
  header = false,
  statusColor,
}: {
  columns: ReturnType<typeof checkTableColumns>;
  status: string;
  check: string;
  result: string;
  providers: string;
  theme: SetupTuiTheme;
  header?: boolean;
  statusColor?: string;
}): React.ReactElement {
  const statusTone = header ? theme.muted : statusColor;
  return (
    <Box flexDirection="row" height={1} flexShrink={0} width="100%" overflow="hidden">
      <Box width={columns.status} height={1} flexShrink={0} overflow="hidden">
        <Text {...foregroundColor(statusTone)} bold wrap="truncate">
          {clipTuiLine(status, columns.status)}
        </Text>
      </Box>
      <Box width={columns.check} height={1} flexShrink={0} overflow="hidden">
        <Text {...(header ? { color: theme.muted, bold: true } : textColor(theme))} wrap="truncate">
          {clipTuiLine(check, columns.check)}
        </Text>
      </Box>
      <Box width={columns.result} height={1} flexShrink={0} overflow="hidden">
        <Text {...foregroundColor(statusTone)} {...(header ? { bold: true } : {})} wrap="truncate">
          {clipTuiLine(result, columns.result)}
        </Text>
      </Box>
      <Box width={columns.provider} height={1} flexShrink={0} overflow="hidden">
        <Text {...(header ? { color: theme.muted, bold: true } : textColor(theme))} wrap="truncate">
          {clipTuiLine(providers, columns.provider)}
        </Text>
      </Box>
    </Box>
  );
}

function detailItemColor(style: SetupCheckDetailStyle, theme: SetupTuiTheme): string | undefined {
  if (style === "success") return theme.success;
  if (style === "warning") return theme.warning;
  if (style === "danger") return theme.danger;
  if (style === "info") return theme.info;
  if (style === "heading") return theme.secondary;
  if (style === "muted") return theme.muted;
  if (style === "primary") return theme.primary;
  return theme.text;
}

export function CheckDetailsView({
  model,
  width,
  layout,
  theme,
}: {
  model: SetupTuiModel;
  width: number;
  layout: TuiLayoutMetrics;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const extras = {
    ...(model.checkReportPath ? { reportPath: model.checkReportPath } : {}),
    ...(model.checkSummaryPath ? { summaryPath: model.checkSummaryPath } : {}),
    ...(model.checkExitCode !== undefined ? { exitCode: model.checkExitCode } : {}),
  };
  const items = setupCheckDetailItems(model.checkOutput ?? "", width, extras);
  const viewport = checkDetailViewport(layout.detailViewport);
  const scroll = clampTuiScroll(model.checkScroll ?? 0, items.length, viewport);
  const visible = items.slice(scroll, scroll + viewport);
  const hasMore = scroll + visible.length < items.length;
  const columns = checkTableColumns(tuiPanelContentWidth(width));
  const rows = setupCheckRows(model.checkOutput ?? "");
  const run = parseHealthRun(model.checkOutput ?? "");
  const errors = run?.results.filter((result) => result.status === "error") ?? [];
  const passed = model.checkExitCode === 0;
  const borderColor = rows.length
    ? errors.length
      ? theme.warning
      : theme.success
    : passed
      ? theme.success
      : theme.warning;
  return (
    <Panel
      title={rows.length ? "Check results" : "Check results · repnix check"}
      theme={theme}
      borderColor={borderColor}
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {visible.map((item, index) => {
          const key = `${scroll + index}`;
          if (item.kind === "blank") return <Box key={key} height={1} flexShrink={0} />;
          if (item.kind === "table-header")
            return (
              <CheckTableRow
                key={key}
                columns={columns}
                header
                status="STATUS"
                check="CHECK"
                result="RESULT"
                providers="PROVIDER"
                theme={theme}
              />
            );
          if (item.kind === "table-row")
            return (
              <CheckTableRow
                key={key}
                columns={columns}
                status={checkStatusLabel(item.row.status)}
                check={item.row.category}
                result={item.row.result}
                providers={item.row.providers}
                statusColor={checkStatusColor(item.row.status, theme)}
                theme={theme}
              />
            );
          return (
            <FrozenLine key={key}>
              <Text
                {...foregroundColor(detailItemColor(item.style, theme))}
                {...(item.bold ? { bold: true } : {})}
                wrap="truncate"
              >
                {clipTuiLine(item.text, tuiPanelContentWidth(width))}
              </Text>
            </FrozenLine>
          );
        })}
      </Box>
      <ScrollHint hasMore={hasMore} theme={theme} />
    </Panel>
  );
}

export function ConfirmView({
  audit,
  plan,
  model,
  theme,
}: {
  audit: AuditModel;
  plan: InstallPlan;
  model: SetupTuiModel;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const selectedOptions = selectedSetupOptions(audit, model);
  return (
    <Panel title="Confirm setup" theme={theme} borderColor={theme.warning}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        <Text color={theme.warning} bold>
          ◆ Apply these reviewed changes?
        </Text>
        <Newline />
        <Text color={theme.primary} bold>
          {planStats(plan)}
        </Text>
        <Newline />
        <Text color={theme.secondary} bold>
          SELECTED OPTIONS
        </Text>
        {selectedOptions.length ? (
          selectedOptions.map((option) => (
            <Text key={option} {...textColor(theme)}>
              {" "}
              + {option}
            </Text>
          ))
        ) : (
          <Text color={theme.muted}> No setup options selected.</Text>
        )}
        <Newline />
        <Text color={theme.secondary} bold>
          REVIEW NOTES
        </Text>
        <ReviewNotes plan={plan} theme={theme} />
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        <ConfirmButton label="CANCEL" focused={model.confirmFocus === "cancel"} theme={theme} />
        <ConfirmButton label="APPLY" focused={model.confirmFocus === "apply"} theme={theme} />
      </Box>
      <Box flexShrink={0}>
        <Text color={theme.muted}>Use the arrow keys to choose an action, then press Enter.</Text>
      </Box>
    </Panel>
  );
}
