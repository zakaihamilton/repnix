import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Newline, Text, render, useApp, useInput, useStdout } from "ink";
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, PROVIDER_DESCRIPTIONS, PROVIDER_NEXT_STEPS } from "../core/health-category.js";
import type { DiagnosticLogger, DiagnosticOptions } from "../cli/options.js";
import { resolveDiagnosticLogger } from "../cli/options.js";
import { auditRepository } from "../cli/audit.js";
import type { AuditModel, CoverageStatus } from "../recommendations/recommendation-engine.js";
import type { InstallPlan, InstallProgress, RepositoryContext } from "../core/types.js";
import { applyInstallPlan } from "../setup/apply-plan.js";
import { buildInstallPlan } from "../setup/install-plan.js";
import { renderFileDiff } from "../setup/file-plan.js";
import {
  createSetupTuiModel,
  selectionItems,
  setupTuiReducer,
  type SetupSelectionItem,
  type SetupTuiModel,
} from "./setup-state.js";

export interface SetupTuiTheme {
  panelRaised: string;
  active: string;
  border: string;
  borderStrong: string;
  primary: string;
  secondary: string;
  text?: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

const truecolorTheme: SetupTuiTheme = {
  panelRaised: "#1e293b",
  active: "#134e4a",
  border: "#334155",
  borderStrong: "#64748b",
  primary: "#5eead4",
  secondary: "#a5b4fc",
  text: "#e5e7eb",
  muted: "#94a3b8",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
  info: "#60a5fa",
};

const lightTruecolorTheme: SetupTuiTheme = {
  panelRaised: "#f1f5f9",
  active: "#ccfbf1",
  border: "#94a3b8",
  borderStrong: "#64748b",
  primary: "#0f766e",
  secondary: "#475569",
  text: "#0f172a",
  muted: "#475569",
  success: "#15803d",
  warning: "#a16207",
  danger: "#b91c1c",
  info: "#2563eb",
};

const ansiDarkTheme: SetupTuiTheme = {
  panelRaised: "blue",
  active: "blue",
  border: "gray",
  borderStrong: "blackBright",
  primary: "cyan",
  secondary: "magenta",
  muted: "gray",
  success: "green",
  warning: "yellow",
  danger: "red",
  info: "blue",
};

const ansiLightTheme: SetupTuiTheme = {
  panelRaised: "blackBright",
  active: "blackBright",
  border: "gray",
  borderStrong: "blackBright",
  primary: "blue",
  secondary: "blackBright",
  muted: "blackBright",
  success: "green",
  warning: "yellow",
  danger: "red",
  info: "blue",
};

type ColorOutput = Pick<NodeJS.WriteStream, "isTTY" | "hasColors"> & { columns?: number };
interface ThemeEnvironment {
  COLORTERM?: string;
  COLORFGBG?: string;
}

function supportsTruecolor(stdout: ColorOutput, environment: ThemeEnvironment): boolean {
  return Boolean(
    stdout.isTTY &&
    (stdout.hasColors?.(16_777_216) || environment.COLORTERM === "truecolor" || environment.COLORTERM === "24bit"),
  );
}

function terminalBackground(environment: ThemeEnvironment): "light" | "dark" | undefined {
  const colorFgbg = environment.COLORFGBG?.split(";").at(-1);
  if (colorFgbg === "7" || colorFgbg === "15") return "light";
  if (colorFgbg !== undefined && ["0", "1", "2", "3", "4", "5", "6", "8"].includes(colorFgbg)) return "dark";
  return undefined;
}

export function createSetupTuiTheme(stdout: ColorOutput, environment: ThemeEnvironment = process.env): SetupTuiTheme {
  const background = terminalBackground(environment);
  const truecolor = supportsTruecolor(stdout, environment);
  if (background === "dark") return truecolor ? truecolorTheme : ansiDarkTheme;
  return truecolor ? lightTruecolorTheme : ansiLightTheme;
}

function foregroundColor(color: string | undefined): { color?: string } {
  return color === undefined ? {} : { color };
}

function textColor(theme: SetupTuiTheme): { color?: string } {
  return foregroundColor(theme.text);
}

export function selectionIndicator(checked: boolean): string {
  return checked ? "■" : "□";
}

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

export function normalizeTuiDiffLine(line: string): string {
  return line.replace(ansiEscapePattern, "");
}

export function diffLineColor(line: string, theme: SetupTuiTheme): string | undefined {
  const normalized = normalizeTuiDiffLine(line);
  if (normalized.startsWith("  +")) return theme.success;
  if (normalized.startsWith("  -")) return theme.danger;
  return theme.text;
}

export interface SelectionRowPresentation {
  label: string;
  color?: string;
  backgroundColor?: string;
  bold: boolean;
}

export function selectionRowPresentation(
  name: string,
  checked: boolean,
  active: boolean,
  priority: string | undefined,
  theme: SetupTuiTheme,
  width = 30,
): SelectionRowPresentation {
  const prefix = `${active ? "▸" : " "} ${selectionIndicator(checked)} `;
  const priorityLabel = priority ? `· ${priority}` : "";
  const priorityGap = priority
    ? " ".repeat(Math.max(1, width - prefix.length - name.length - priorityLabel.length))
    : "";
  const label = `${prefix}${name}${priorityGap}${priorityLabel}`.padEnd(width, " ");
  const base = { label: label.padEnd(width, " "), ... (active ? { color: theme.primary } : textColor(theme)), bold: active };
  return active ? { ...base, backgroundColor: theme.active } : base;
}

export interface TuiLayoutMetrics {
  bodyHeight: number;
  detailViewport: number;
}

const HEADER_ROWS = 4;
const FOOTER_ROWS = 4;
const DETAIL_PANEL_CHROME_ROWS = 6;
const SIDEBAR_WIDTH = 40;
const SIDEBAR_CONTENT_WIDTH = SIDEBAR_WIDTH - 4;
export const COMPACT_LAYOUT_WIDTH = 100;
export const COMPACT_LAYOUT_HEIGHT = 30;
export const HORIZONTAL_PANE_MIN_WIDTH = 120;
const COMPACT_LAYOUT_EXTRA_ROWS = 3;

export type SetupPaneLayout = "horizontal" | "vertical" | "focused-sidebar";

export function setupPaneLayout(width: number, height: number): SetupPaneLayout {
  if (width < COMPACT_LAYOUT_WIDTH && height < COMPACT_LAYOUT_HEIGHT) return "focused-sidebar";
  return width < HORIZONTAL_PANE_MIN_WIDTH || width < height ? "vertical" : "horizontal";
}

export function tuiLayoutMetrics(height: number, compact = false): TuiLayoutMetrics {
  const safeHeight = Math.max(height, 1);
  const bodyHeight = Math.max(safeHeight - HEADER_ROWS - FOOTER_ROWS - (compact ? COMPACT_LAYOUT_EXTRA_ROWS : 0), 1);
  return {
    bodyHeight,
    detailViewport: Math.max(bodyHeight - DETAIL_PANEL_CHROME_ROWS, 1),
  };
}

export interface SetupTuiDependencies {
  audit: typeof auditRepository;
  buildPlan: typeof buildInstallPlan;
  applyPlan: typeof applyInstallPlan;
}

function progressMessage(progress: InstallProgress): string {
  if (progress.phase === "writing-files") return `Writing ${progress.total ?? 0} reviewed file${progress.total === 1 ? "" : "s"}…`;
  if (progress.phase === "running-command") return `Running command ${progress.current ?? 0}/${progress.total ?? 0}…`;
  if (progress.phase === "rollback") return "Apply failed; rolling back reviewed changes…";
  return "Finishing setup…";
}

export interface SetupTuiProps {
  options: DiagnosticOptions;
  logger: DiagnosticLogger;
  dependencies?: Partial<SetupTuiDependencies>;
  result: { code: number };
}

const defaultDependencies: SetupTuiDependencies = {
  audit: auditRepository,
  buildPlan: buildInstallPlan,
  applyPlan: applyInstallPlan,
};

function Panel({
  title,
  children,
  theme,
  flexGrow = 1,
  flexShrink,
  width,
  borderColor,
  fill = true,
}: {
  title: string;
  children: React.ReactNode;
  theme: SetupTuiTheme;
  flexGrow?: number;
  flexShrink?: number;
  width?: string | number;
  borderColor?: string;
  fill?: boolean;
}): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor={borderColor ?? theme.border}
      flexDirection="column"
      paddingX={1}
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      width={width}
      {...(fill ? { height: "100%" } : {})}
      overflow="hidden"
    >
      <Text bold color={theme.primary}>{` ${title} `}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {children}
      </Box>
    </Box>
  );
}

export function setupStepIndex(screen: SetupTuiModel["screen"]): number {
  if (screen === "loading" || screen === "audit" || screen === "empty") return 0;
  if (screen === "select" || screen === "planning") return 1;
  if (screen === "review" || screen === "details" || screen === "confirm") return 2;
  return 3;
}

function Header({ model, repositoryName, packageManager, compact, theme }: { model: SetupTuiModel; repositoryName: string; packageManager: string | null; compact: boolean; theme: SetupTuiTheme }): React.ReactElement {
  const steps = ["Audit", "Select checks", "Review changes", "Apply safely"];
  const active = setupStepIndex(model.screen);
  return (
    <Box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Box flexDirection={compact ? "column" : "row"} justifyContent="space-between">
        <Text bold color={theme.primary}>◆ REP<Text color={theme.secondary}>NIX</Text> <Text color={theme.muted}>/ SETUP</Text></Text>
        <Text color={theme.muted} wrap="truncate-end"><Text {...textColor(theme)}>{repositoryName}</Text>  ·  {packageManager ?? "package manager unresolved"}</Text>
      </Box>
      <Box marginTop={1}>
        {steps.map((step, index) => (
          <Box key={step} marginRight={2}>
            <Text color={index < active ? theme.success : index === active ? theme.primary : theme.muted} bold={index === active}>
              {index < active ? "● " : index === active ? "◆ " : "○ "}{step}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function auditStatusPresentation(status: CoverageStatus, theme: SetupTuiTheme): { symbol: string; color: string } {
  switch (status) {
    case "covered":
      return { symbol: "✓", color: theme.success };
    case "partial":
      return { symbol: "◐", color: theme.warning };
    case "missing":
      return { symbol: "✗", color: theme.danger };
    case "off":
      return { symbol: "–", color: theme.muted };
    case "not-applicable":
      return { symbol: "·", color: theme.muted };
  }
}

export function auditRecommendationSummary(
  recommendations: AuditModel["recommendations"],
  actionableOnly = false,
): { baseline: number; optional: number; advanced: number; total: number } {
  const considered = actionableOnly ? recommendations.filter((recommendation) => recommendation.actionable) : recommendations;
  const summary = { baseline: 0, optional: 0, advanced: 0, total: considered.length };
  for (const recommendation of considered) summary[recommendation.priority] += 1;
  return summary;
}

export function auditSetupOptions(audit: AuditModel): string[] {
  return [
    ...audit.recommendations.filter((recommendation) => recommendation.actionable).map((recommendation) => recommendation.name),
    ...(audit.context.hasCI ? ["GitHub Actions health step"] : []),
  ];
}

export function selectedSetupOptions(audit: AuditModel, model: SetupTuiModel): string[] {
  return [
    ...audit.recommendations
      .filter((recommendation) => recommendation.actionable && model.selectedProviders.includes(recommendation.provider as SetupTuiModel["selectedProviders"][number]))
      .map((recommendation) => recommendation.name),
    ...(model.includeCi ? ["GitHub Actions health step"] : []),
  ];
}

export interface AuditPageSummary {
  repositoryName: string;
  packageManager: string;
  languages: string[];
  frameworks: string[];
  ci: string;
  workspaceCount: number;
}

export function auditPageSummary(audit: AuditModel): AuditPageSummary {
  const context = audit.context;
  return {
    repositoryName: context.packageJson.name ?? "unnamed",
    packageManager: context.packageManager ?? "unresolved",
    languages: context.languages,
    frameworks: context.frameworks,
    ci: context.hasCI ? "GitHub Actions" : "none detected",
    workspaceCount: context.workspaceRoots?.filter((root) => root !== ".").length ?? Math.max(context.packageCount - 1, 0),
  };
}

function KeyHint({ label, children, theme }: { label: string; children: React.ReactNode; theme: SetupTuiTheme }): React.ReactElement {
  return <Text><Text color={theme.primary} backgroundColor={theme.panelRaised} bold>{` ${label} `}</Text> <Text color={theme.muted}>{children}</Text></Text>;
}

function Footer({ model, sidebarMode, theme }: { model: SetupTuiModel; sidebarMode: boolean; theme: SetupTuiTheme }): React.ReactElement {
  const hints: Array<[string, string]> = model.screen === "audit"
    ? [["↑↓/jk", "scroll"], ["Enter", "continue to checks"], ["q/Esc", "exit"]]
    : model.screen === "select"
    ? [["↑↓/jk", "move"], ["Space", "toggle"], ...(sidebarMode ? [["Tab", model.sidebarCollapsed ? "show checks" : "show details"] as [string, string]] : []), ["Enter", "review"], ["Esc/Backspace", "back"], ["q", "quit"]]
    : model.screen === "review"
      ? [["↑↓", "move"], ["Space", "inspect"], ...(sidebarMode ? [["Tab", model.sidebarCollapsed ? "show files" : "show details"] as [string, string]] : []), ["Enter", "confirm"], ["Esc/Backspace", "back"], ["q", "quit"]]
      : model.screen === "details"
        ? [["↑↓/jk", "scroll"], ["Esc/Backspace", "back"], ["q", "quit"]]
        : model.screen === "confirm"
          ? [["←→", "focus"], ["Enter", "select"], ["Esc/Backspace", "back"], ["q", "quit"]]
          : model.screen === "success" || model.screen === "error"
            ? [["Enter/q", "exit"]]
            : [["…", "Please wait"]];
  return (
    <Box borderStyle="single" borderColor={theme.borderStrong} paddingX={1} marginTop={1} flexShrink={0}>
      <Box flexDirection="row" flexWrap="wrap">
        {hints.map(([label, description], index) => (
          <Box key={label} flexDirection="row" marginRight={index < hints.length - 1 ? 2 : 0} flexShrink={0}>
            {index > 0 ? <Text color={theme.border}>·  </Text> : null}
            <KeyHint label={label} theme={theme}>{description}</KeyHint>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function providerFor(items: SetupSelectionItem[], model: SetupTuiModel): SetupSelectionItem | undefined {
  return items[model.cursor];
}

export interface SetupCheckDetails {
  checks: string[];
  scope: string;
  setup: string[];
  command: string;
  caveat?: string;
}

function packageManagerRun(context: RepositoryContext, script: string): string {
  return context.packageManager ? `${context.packageManager} run ${script}` : `run ${script}`;
}

function sourceScope(context: RepositoryContext): string {
  const fileCount = `${context.sourceFiles.length} source file${context.sourceFiles.length === 1 ? "" : "s"}`;
  if (!context.sourceRoots.length) return fileCount;
  const roots = context.sourceRoots.slice(0, 3).join(", ");
  const suffix = context.sourceRoots.length > 3 ? `, +${context.sourceRoots.length - 3} more` : "";
  return `${fileCount} under ${roots}${suffix}`;
}

function existingConfig(context: RepositoryContext, files: string[]): string | undefined {
  return files.find((file) => context.files.has(file));
}

export function setupCheckDetails(recommendation: AuditModel["recommendations"][number], context: RepositoryContext): SetupCheckDetails {
  const scope = sourceScope(context);
  switch (recommendation.provider) {
    case "knip":
      return {
        checks: ["Unused files, exports, and dependencies that are not reachable from the project entry points."],
        scope: `${scope}; package.json scripts and workspace packages are used to understand entry points.`,
        setup: ["Install Knip as a development dependency.", "Add the health:dead-code script to package.json."],
        command: packageManagerRun(context, "health:dead-code"),
      };
    case "jscpd": {
      const config = existingConfig(context, [".jscpd.json", "jscpd.json"]);
      return {
        checks: ["Repeated code blocks across the detected source roots, including copies that can drift apart over time."],
        scope,
        setup: [
          "Install jscpd as a development dependency.",
          "Add the health:duplication script to package.json.",
          config ? `Extend ${config} with safe generated/build exclusions.` : "Create .jscpd.json with safe generated/build exclusions.",
        ],
        command: packageManagerRun(context, "health:duplication"),
        ...(context.packageJson.jscpd !== undefined && !config
          ? { caveat: "A jscpd configuration embedded in package.json will be preserved; verify its exclusions manually." }
          : {}),
      };
    }
    case "dependency-cruiser": {
      const config = existingConfig(context, [
        ".dependency-cruiser.json",
        ".dependency-cruiser.js",
        ".dependency-cruiser.cjs",
        ".dependency-cruiser.mjs",
        ".dependency-cruiser.ts",
      ]);
      return {
        checks: ["Circular dependencies between modules.", "Production source importing test files through conservative starter rules."],
        scope,
        setup: [
          "Install dependency-cruiser as a development dependency.",
          "Add the health:architecture script to package.json.",
          config ? `Use the existing ${config} without overwriting it.` : "Create .dependency-cruiser.cjs with conservative starter rules.",
        ],
        command: packageManagerRun(context, "health:architecture"),
        ...(config ? { caveat: `Existing rules in ${config} are preserved and will determine the final boundaries.` } : {}),
      };
    }
    case "publint":
      return {
        checks: ["Package exports, entry points, metadata, and the files consumers receive from npm."],
        scope: `${context.packageJson.name ?? "the package"} package manifest and its publishable file layout.`,
        setup: ["Install Publint as a development dependency.", "Add the health:package:publint script to package.json."],
        command: packageManagerRun(context, "health:package:publint"),
      };
    case "attw":
      return {
        checks: ["Whether TypeScript types resolve correctly for consumers using Node and bundler-style package entry points."],
        scope: `${context.packageJson.name ?? "the package"} after it is packed, including its published type declarations.`,
        setup: ["Install Are The Types Wrong? as a development dependency.", "Add the health:package:types script to package.json."],
        command: packageManagerRun(context, "health:package:types"),
      };
    default:
      return {
        checks: [PROVIDER_DESCRIPTIONS[recommendation.name] ?? "The recommended repository health check."],
        scope,
        setup: ["Install the check as a development dependency.", "Add its health script to package.json."],
        command: packageManagerRun(context, `health:${recommendation.category}`),
        ...(PROVIDER_NEXT_STEPS[recommendation.name] ? { caveat: PROVIDER_NEXT_STEPS[recommendation.name] } : {}),
      };
  }
}

function DetailSection({ title, children, theme }: { title: string; children: React.ReactNode; theme: SetupTuiTheme }): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.secondary} bold>{title}</Text>
      {children}
    </Box>
  );
}

function CheckDetailView({ recommendation, context, theme }: { recommendation: AuditModel["recommendations"][number]; context: RepositoryContext; theme: SetupTuiTheme }): React.ReactElement {
  const details = setupCheckDetails(recommendation, context);
  return (
    <>
      <Text color={theme.info} bold>{PROVIDER_DESCRIPTIONS[recommendation.name] ?? "Repository health check"}</Text>
      <Text color={theme.muted}>{CATEGORY_LABELS[recommendation.category]}: {CATEGORY_DESCRIPTIONS[recommendation.category]}</Text>
      <Newline />
      <DetailSection title="WHY THIS REPOSITORY" theme={theme}>
        <Text {...textColor(theme)}>{recommendation.reason}</Text>
      </DetailSection>
      <DetailSection title="WHAT IT CHECKS" theme={theme}>
        {details.checks.map((check) => <Text key={check} {...textColor(theme)}>  • {check}</Text>)}
      </DetailSection>
      <DetailSection title="SCOPE" theme={theme}>
        <Text {...textColor(theme)}>  {details.scope}</Text>
      </DetailSection>
      <DetailSection title="SETUP ADDS" theme={theme}>
        {details.setup.map((item) => <Text key={item} {...textColor(theme)}>  + {item}</Text>)}
      </DetailSection>
      <DetailSection title="RUNS" theme={theme}>
        <Text color={theme.primary}>  $ {details.command}</Text>
      </DetailSection>
      {!recommendation.actionable ? <Text color={theme.warning}>◆ Manual configuration required before this check can run.</Text> : null}
      {details.caveat ? <Text color={theme.warning}>◆ {details.caveat}</Text> : null}
    </>
  );
}

function CiDetailView({ context, theme }: { context: RepositoryContext; theme: SetupTuiTheme }): React.ReactElement {
  const command = packageManagerRun(context, "health");
  return (
    <>
      <Text color={theme.info} bold>Add the unified repository health check to GitHub Actions.</Text>
      <Newline />
      <DetailSection title="WHAT IT ADDS" theme={theme}>
        <Text {...textColor(theme)}>  A Repository health step in the most obvious workflow job after dependencies are installed.</Text>
      </DetailSection>
      <DetailSection title="RUNS" theme={theme}>
        <Text color={theme.primary}>  $ {command}</Text>
      </DetailSection>
      <DetailSection title="SAFETY" theme={theme}>
        <Text {...textColor(theme)}>  Existing workflow steps are preserved. If RepNix cannot identify one unambiguous checkout and install job, it leaves the workflow unchanged and shows a manual warning in the review.</Text>
      </DetailSection>
    </>
  );
}

export const AUDIT_LABEL_COLUMN_WIDTH = 25;
export const AUDIT_TWO_COLUMN_MIN_WIDTH = 120;

export function auditUsesSingleColumn(width: number): boolean {
  return width < AUDIT_TWO_COLUMN_MIN_WIDTH;
}

export function auditContentLineCount(audit: AuditModel, singleColumn: boolean): number {
  const coverageRows = singleColumn ? audit.coverage.length : Math.ceil(audit.coverage.length / 2);
  return 9 + coverageRows + (auditSetupOptions(audit).length ? 1 : 0);
}

function auditCoverageRow(entry: AuditModel["coverage"][number], theme: SetupTuiTheme): React.ReactElement {
  const status = auditStatusPresentation(entry.status, theme);
  return (
    <Box key={entry.category} flexDirection="row" overflow="hidden">
      <Box width={2} flexShrink={0}>
        <Text color={status.color}>{status.symbol}</Text>
      </Box>
      <Box width={AUDIT_LABEL_COLUMN_WIDTH} flexShrink={0}>
        <Text {...textColor(theme)} wrap="truncate-end">{CATEGORY_LABELS[entry.category]}</Text>
      </Box>
      {entry.providers.length ? <Text color={status.color} wrap="truncate-end">{entry.providers.join(", ")}</Text> : null}
    </Box>
  );
}

function AuditView({ audit, singleColumn, scroll, viewport, theme }: { audit: AuditModel; singleColumn: boolean; scroll: number; viewport: number; theme: SetupTuiTheme }): React.ReactElement {
  const page = auditPageSummary(audit);
  const summary = auditRecommendationSummary(audit.recommendations, true);
  const setupOptions = auditSetupOptions(audit);
  const actionable = setupOptions.length > 0;
  const coverageLines = singleColumn
    ? audit.coverage.map((entry) => auditCoverageRow(entry, theme))
    : Array.from({ length: Math.ceil(audit.coverage.length / 2) }, (_, index) => (
      <Box key={`coverage-row-${index}`} flexDirection="row" gap={2} overflow="hidden">
        <Box width="50%" flexShrink={0}>{audit.coverage[index] ? auditCoverageRow(audit.coverage[index]!, theme) : null}</Box>
        <Box width="50%" flexShrink={0}>{audit.coverage[index + Math.ceil(audit.coverage.length / 2)] ? auditCoverageRow(audit.coverage[index + Math.ceil(audit.coverage.length / 2)]!, theme) : null}</Box>
      </Box>
    ));
  const lines: React.ReactNode[] = [
    <Text key="repository" {...textColor(theme)}>Repository: <Text color={theme.primary}>{page.repositoryName}</Text></Text>,
    <Text key="package-manager" {...textColor(theme)}>Package manager: <Text color={theme.primary}>{page.packageManager}</Text>  ·  CI: {page.ci}</Text>,
    <Text key="facts" {...textColor(theme)} wrap="truncate-end">Languages: {page.languages.join(", ") || "none detected"}  ·  Frameworks: {page.frameworks.join(", ") || "none detected"}  ·  Workspaces: {page.workspaceCount}</Text>,
    <Newline key="facts-gap" />,
    <Text key="coverage-heading" color={theme.secondary} bold>HEALTH COVERAGE</Text>,
    ...coverageLines,
    <Newline key="coverage-gap" />,
    <Text key="next-steps-heading" color={theme.secondary} bold>NEXT STEPS</Text>,
    <Text key="recommendations" {...textColor(theme)}>Recommendations: {summary.baseline} baseline  ·  {summary.optional} optional  ·  {summary.advanced} advanced</Text>,
    ...(setupOptions.length ? [<Text key="setup-options" {...textColor(theme)} wrap="wrap">Setup options: {setupOptions.join(" · ")}</Text>] : []),
    <Text key="prompt" color={actionable ? theme.primary : theme.success} bold>{actionable ? "Press Enter to choose checks and continue setup." : "No actionable setup changes were found. Press Enter to finish."}</Text>,
  ];
  const start = Math.min(Math.max(scroll, 0), Math.max(lines.length - 1, 0));
  const visible = lines.slice(start, start + Math.max(viewport, 1));
  return (
    <Panel title="Repository audit" theme={theme} borderColor={theme.info}>
      {visible}
      {start + visible.length < lines.length ? <Text color={theme.muted}>↓ more · use ↑↓ to scroll</Text> : null}
    </Panel>
  );
}

function SelectView({ audit, model, theme, paneLayout }: { audit: AuditModel; model: SetupTuiModel; theme: SetupTuiTheme; paneLayout: SetupPaneLayout }): React.ReactElement {
  const items = selectionItems(audit.recommendations, audit.context.hasCI);
  const selected = providerFor(items, model);
  const recommendation = selected?.kind === "provider" ? audit.recommendations.find((item) => item.provider === selected.provider) : undefined;
  const horizontal = paneLayout === "horizontal";
  const focusedSidebar = paneLayout === "focused-sidebar";
  const showSidebar = !focusedSidebar || !model.sidebarCollapsed;
  const showDetails = !focusedSidebar || model.sidebarCollapsed;
  const sidebar = (
    <Panel title="Recommended checks" width={horizontal ? SIDEBAR_WIDTH : "100%"} flexGrow={0} flexShrink={0} fill={horizontal} theme={theme} borderColor={theme.borderStrong}>
      {items.map((item, index) => {
        const checked = item.kind === "ci" ? model.includeCi : model.selectedProviders.includes(item.provider);
        const active = index === model.cursor;
        const itemRecommendation = item.kind === "provider" ? audit.recommendations.find((entry) => entry.provider === item.provider) : undefined;
        const presentation = selectionRowPresentation(item.name, checked, active, itemRecommendation?.priority, theme, SIDEBAR_CONTENT_WIDTH);
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
  return (
    <Box flexDirection={horizontal ? "row" : "column"} gap={horizontal ? 1 : 0} flexGrow={1} minHeight={1} overflow="hidden">
      {showSidebar ? sidebar : null}
      {showDetails ? <Panel width="100%" title={recommendation ? `${recommendation.name} · ${CATEGORY_LABELS[recommendation.category]}` : selected?.name ?? "Setup overview"} flexGrow={1} fill={horizontal} theme={theme} borderColor={recommendation ? theme.primary : theme.border}>
        {recommendation ? (
          <CheckDetailView recommendation={recommendation} context={audit.context} theme={theme} />
        ) : selected?.kind === "ci" ? (
          <CiDetailView context={audit.context} theme={theme} />
        ) : (
          <Text color={theme.muted}>Select a check to see why it is recommended and what it will add.</Text>
        )}
      </Panel> : null}
    </Box>
  );
}

function planStats(plan: InstallPlan): string {
  const parts = [] as string[];
  if (plan.packages.length) parts.push(`${plan.packages.length} package${plan.packages.length === 1 ? "" : "s"}`);
  if (plan.files.length) parts.push(`${plan.files.length} file${plan.files.length === 1 ? "" : "s"}`);
  if (plan.warnings.length) parts.push(`${plan.warnings.length} warning${plan.warnings.length === 1 ? "" : "s"}`);
  if (plan.conflicts.length) parts.push(`${plan.conflicts.length} preserved conflict${plan.conflicts.length === 1 ? "" : "s"}`);
  return parts.join("  ·  ") || "No changes";
}

function ReviewNotes({ plan, theme }: { plan: InstallPlan; theme: SetupTuiTheme }): React.ReactElement {
  if (!plan.warnings.length && !plan.conflicts.length) {
    return <Text color={theme.success}>● No warnings or conflicts.</Text>;
  }
  return (
    <Box flexDirection="column">
      {plan.warnings.map((warning, index) => <Text key={`warning-${index}`} color={theme.warning}>◆ Warning: {warning}</Text>)}
      {plan.conflicts.map((conflict, index) => <Text key={`conflict-${index}`} color={theme.warning}>◆ Preserved: {conflict}</Text>)}
    </Box>
  );
}

function ReviewView({ plan, model, theme, paneLayout }: { plan: InstallPlan; model: SetupTuiModel; theme: SetupTuiTheme; paneLayout: SetupPaneLayout }): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  const horizontal = paneLayout === "horizontal";
  const focusedSidebar = paneLayout === "focused-sidebar";
  const showSidebar = !focusedSidebar || !model.sidebarCollapsed;
  const showDetails = !focusedSidebar || model.sidebarCollapsed;
  const sidebar = (
    <Panel title="Planned changes" width={horizontal ? SIDEBAR_WIDTH : "100%"} flexGrow={0} flexShrink={0} fill={horizontal} theme={theme} borderColor={theme.borderStrong}>
      <Text color={theme.primary} bold>{planStats(plan)}</Text>
      <Newline />
      <Text color={theme.secondary} bold>PACKAGES</Text>
      {plan.packages.length ? plan.packages.map((item) => <Text key={item.name} {...textColor(theme)}>  + {item.name}{item.version ? `@${item.version}` : ""}</Text>) : <Text color={theme.muted}>  none</Text>}
      <Newline />
      <Text color={theme.secondary} bold>FILES</Text>
      {plan.files.length ? plan.files.map((item, index) => <Text key={item.path} {...(index === model.reviewCursor ? { color: theme.primary, backgroundColor: theme.active } : textColor(theme))} bold={index === model.reviewCursor}>{`${index === model.reviewCursor ? "▸" : " "} ${item.kind === "create" ? "A" : "M"} ${item.path}`}</Text>) : <Text color={theme.muted}>  none</Text>}
      {plan.warnings.length ? <><Newline /><Text color={theme.warning}>◆ Warnings: {plan.warnings.length}</Text></> : null}
      {plan.conflicts.length ? <Text color={theme.warning}>◆ Conflicts preserved: {plan.conflicts.length}</Text> : null}
    </Panel>
  );
  return (
    <Box flexDirection={horizontal ? "row" : "column"} gap={horizontal ? 1 : 0} flexGrow={1} minHeight={1} overflow="hidden">
      {showSidebar ? sidebar : null}
      {showDetails ? <Panel width="100%" title={file ? `Detail · ${file.path}` : "Review summary"} flexGrow={1} fill={horizontal} theme={theme} borderColor={plan.warnings.length || plan.conflicts.length ? theme.warning : theme.border}>
        {file ? (
          <>
            <Text color={theme.muted}>{file.reason}</Text>
            <Newline />
            <Text color={theme.info}>Press Space to inspect this file.</Text>
          </>
        ) : (
          <Text color={theme.muted}>No file changes are planned. Press Enter to continue.</Text>
        )}
        {plan.commands.length ? <><Newline /><Text color={theme.secondary} bold>COMMANDS</Text>{plan.commands.map((command) => <Text key={command.command} {...textColor(theme)}>{`  $ ${command.command} ${command.args.join(" ")}`}</Text>)}</> : null}
        <Newline />
        <Text color={theme.secondary} bold>REVIEW NOTES</Text>
        <ReviewNotes plan={plan} theme={theme} />
      </Panel> : null}
    </Box>
  );
}

function DetailsView({ plan, model, width, layout, theme }: { plan: InstallPlan; model: SetupTuiModel; width: number; layout: TuiLayoutMetrics; theme: SetupTuiTheme }): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  if (!file) return <Panel title="Details" theme={theme}><Text color={theme.muted}>There are no file details to show.</Text></Panel>;
  const diff = renderFileDiff(file, Math.max(width - 8, 32)).split("\n").map(normalizeTuiDiffLine);
  const visible = diff.slice(model.detailScroll, model.detailScroll + layout.detailViewport);
  return (
    <Panel title={`File detail · ${file.path}`} theme={theme} borderColor={theme.info}>
      <Text color={theme.muted}>{file.reason}</Text>
      <Newline />
      {visible.map((line, index) => <Text key={`${index}-${line}`} {...foregroundColor(diffLineColor(line, theme))}>{line}</Text>)}
      {model.detailScroll + visible.length < diff.length ? <Text color={theme.muted}>↓ more</Text> : null}
    </Panel>
  );
}

function ConfirmButton({ label, focused, theme }: { label: string; focused: boolean; theme: SetupTuiTheme }): React.ReactElement {
  return (
    <Text
      color={focused ? theme.primary : theme.muted}
      backgroundColor={focused ? theme.active : theme.panelRaised}
      bold={focused}
    >
      {` ${label} `}
    </Text>
  );
}

function ConfirmView({ audit, plan, model, compact, theme }: { audit: AuditModel; plan: InstallPlan; model: SetupTuiModel; compact: boolean; theme: SetupTuiTheme }): React.ReactElement {
  const selectedOptions = selectedSetupOptions(audit, model);
  return (
    <Panel title="Confirm setup" theme={theme} borderColor={theme.warning}>
      <Text color={theme.warning} bold>◆ Apply these reviewed changes?</Text>
      <Newline />
      <Text color={theme.primary} bold>{planStats(plan)}</Text>
      <Newline />
      <Text color={theme.secondary} bold>SELECTED OPTIONS</Text>
      {selectedOptions.length
        ? selectedOptions.map((option) => <Text key={option} {...textColor(theme)}>  + {option}</Text>)
        : <Text color={theme.muted}>  No setup options selected.</Text>}
      <Newline />
      <Text color={theme.secondary} bold>REVIEW NOTES</Text>
      <ReviewNotes plan={plan} theme={theme} />
      <Newline />
      <Box flexDirection={compact ? "column" : "row"} gap={1}>
        <ConfirmButton label="CANCEL" focused={model.confirmFocus === "cancel"} theme={theme} />
        <ConfirmButton label="APPLY" focused={model.confirmFocus === "apply"} theme={theme} />
      </Box>
      <Text color={theme.muted}>Use the arrow keys to choose an action, then press Enter.</Text>
    </Panel>
  );
}

export function SetupApp({ options, logger, dependencies = {}, result }: SetupTuiProps): React.ReactElement {
  const deps = { ...defaultDependencies, ...dependencies };
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [audit, setAudit] = useState<AuditModel>();
  const [plan, setPlan] = useState<InstallPlan>();
  const [model, setModel] = useState<SetupTuiModel>({ screen: "loading", cursor: 0, auditScroll: 0, reviewCursor: 0, detailScroll: 0, confirmFocus: "cancel", selectedProviders: [], includeCi: false, sidebarCollapsed: false });
  const [dimensions, setDimensions] = useState({ width: stdout.columns ?? 100, height: stdout.rows ?? 24 });
  const startedApply = useRef(false);
  const theme = useMemo(() => createSetupTuiTheme(stdout), [stdout]);

  const dispatch = (action: Parameters<typeof setupTuiReducer>[1]) => setModel((current) => setupTuiReducer(current, action));
  const items = useMemo(() => audit ? selectionItems(audit.recommendations, audit.context.hasCI) : [], [audit]);

  useEffect(() => {
    const handleResize = () => setDimensions({ width: stdout.columns ?? 100, height: stdout.rows ?? 24 });
    stdout.on("resize", handleResize);
    handleResize();
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  useEffect(() => {
    void deps.audit(process.cwd(), { ...options, logger })
      .then((nextAudit) => {
        setAudit(nextAudit);
        if (nextAudit.context.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          dispatch({ type: "fail", message: "Repository detection reported an error. Run `repnix audit` for details." });
          return;
        }
        setModel(createSetupTuiModel(nextAudit.recommendations));
      })
      .catch((error: unknown) => dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }));
  }, []);

  useEffect(() => {
    if (model.screen !== "planning" || !audit) return;
    void deps.buildPlan(audit.context, model.selectedProviders, model.includeCi)
      .then((nextPlan) => {
        setPlan(nextPlan);
        dispatch({ type: "planning-complete" });
      })
      .catch((error: unknown) => dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }));
  }, [model.screen]);

  useEffect(() => {
    if (model.screen !== "applying" || !audit || !plan || startedApply.current) return;
    startedApply.current = true;
    void deps.applyPlan(
      audit.context,
      plan,
      logger,
      options.timeout === undefined ? undefined : options.timeout * 1000,
      (progress) => dispatch({ type: "progress", message: progressMessage(progress) }),
    )
      .then(() => dispatch({ type: "complete" }))
      .catch((error: unknown) => dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }));
  }, [model.screen]);

  const { width, height } = dimensions;
  const paneLayout = setupPaneLayout(width, height);
  const compact = paneLayout !== "horizontal";
  const sidebarMode = paneLayout === "focused-sidebar";
  const auditSingleColumn = auditUsesSingleColumn(width);
  const layout = tuiLayoutMetrics(height, compact);
  const auditLineCount = audit ? auditContentLineCount(audit, auditSingleColumn) : 0;
  const detailFile = plan?.files[model.reviewCursor];
  const detailLineCount = detailFile ? renderFileDiff(detailFile, Math.max(width - 8, 32)).split("\n").length : 0;
  const busy = model.screen === "loading" || model.screen === "planning" || model.screen === "applying";
  const leave = () => {
    result.code = model.screen === "error" ? 2 : 0;
    exit();
  };

  useInput((input, key) => {
    if (input === "\u0003" || (key.ctrl && input === "c")) {
      if (!busy) leave();
      return;
    }
    if (input === "q") {
      if (!busy) leave();
      return;
    }
    if (key.escape || key.backspace) {
      if (busy) return;
      if (model.screen === "details") dispatch({ type: "close-details" });
      else if (model.screen === "confirm") dispatch({ type: "cancel-confirm" });
      else if (model.screen === "review") dispatch({ type: "back-to-select" });
      else if (model.screen === "select") dispatch({ type: "back-to-audit" });
      else {
        result.code = model.screen === "error" ? 2 : 0;
        exit();
      }
      return;
    }
    if (model.screen === "loading" || model.screen === "planning" || model.screen === "applying") return;
    if (key.tab) {
      if (sidebarMode && (model.screen === "select" || model.screen === "review")) dispatch({ type: "toggle-sidebar" });
      return;
    }
    if (model.screen === "audit") {
      if (key.upArrow || input === "k") {
        dispatch({ type: "move-audit", direction: "up", lineCount: auditLineCount, viewport: layout.detailViewport });
      }
      else if (key.downArrow || input === "j") {
        dispatch({ type: "move-audit", direction: "down", lineCount: auditLineCount, viewport: layout.detailViewport });
      }
      else if (key.return) {
        dispatch({ type: audit?.recommendations.some((recommendation) => recommendation.actionable) ? "begin-selection" : "show-empty" });
      }
      return;
    }
    if (model.screen === "success") {
      result.code = 0;
      exit();
      return;
    }
    if (model.screen === "empty") {
      result.code = 0;
      exit();
      return;
    }
    if (model.screen === "error") {
      result.code = 2;
      exit();
      return;
    }
    if (model.screen === "select") {
      const sidebarFocused = sidebarMode ? !model.sidebarCollapsed : true;
      if (sidebarFocused && (key.upArrow || input === "k")) dispatch({ type: "move", direction: "up", itemCount: items.length });
      else if (sidebarFocused && (key.downArrow || input === "j")) dispatch({ type: "move", direction: "down", itemCount: items.length });
      else if (sidebarFocused && input === " ") {
        const item = providerFor(items, model);
        if (item) dispatch({ type: "toggle", item });
      }
      else if (key.return) dispatch({ type: "begin-planning" });
      return;
    }
    if (model.screen === "review") {
      const sidebarFocused = sidebarMode ? !model.sidebarCollapsed : true;
      if (sidebarFocused && (key.upArrow || input === "k")) dispatch({ type: "move-review", direction: "up", fileCount: plan?.files.length ?? 0 });
      else if (sidebarFocused && (key.downArrow || input === "j")) dispatch({ type: "move-review", direction: "down", fileCount: plan?.files.length ?? 0 });
      else if (sidebarFocused && input === " ") {
        if (plan?.files.length) dispatch({ type: "open-details" });
      }
      else if (key.return) dispatch({ type: "begin-confirm" });
      return;
    }
    if (model.screen === "confirm") {
      if (key.rightArrow) dispatch({ type: "move-confirm", direction: "right" });
      else if (key.leftArrow) dispatch({ type: "move-confirm", direction: "left" });
      else if (key.return) {
        if (model.confirmFocus === "apply") dispatch({ type: "begin-applying" });
        else dispatch({ type: "cancel-confirm" });
      }
      return;
    }
    if (model.screen === "details") {
      if (key.upArrow || input === "k") dispatch({ type: "move-detail", direction: "up", lineCount: detailLineCount, viewport: layout.detailViewport });
      else if (key.downArrow || input === "j") dispatch({ type: "move-detail", direction: "down", lineCount: detailLineCount, viewport: layout.detailViewport });
      else if (key.escape) dispatch({ type: "close-details" });
    }
  });

  return (
    <Box flexDirection="column" width="100%" height={height} paddingX={1} overflow="hidden">
      <Header model={model} repositoryName={audit?.context.packageJson.name ?? "repository"} packageManager={audit?.context.packageManager ?? null} compact={compact} theme={theme} />
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={1} overflow="hidden">
        {model.screen === "loading" ? <Panel title="Scanning repository" theme={theme} borderColor={theme.info}><Text color={theme.info}>◌ Detecting checks, project structure, and recommendations…</Text></Panel> : null}
        {model.screen === "audit" && audit ? <AuditView audit={audit} singleColumn={auditSingleColumn} scroll={model.auditScroll} viewport={layout.detailViewport} theme={theme} /> : null}
        {model.screen === "empty" ? <Panel title="Nothing to add" theme={theme} borderColor={theme.success}><Text color={theme.success}>● Your active checks already cover the gaps RepNix found.</Text></Panel> : null}
        {model.screen === "select" && audit ? <SelectView audit={audit} model={model} paneLayout={paneLayout} theme={theme} /> : null}
        {model.screen === "planning" ? <Panel title="Preparing review" theme={theme} borderColor={theme.info}><Text color={theme.info}>◌ Building a safe setup plan…</Text></Panel> : null}
        {model.screen === "review" && plan ? <ReviewView plan={plan} model={model} paneLayout={paneLayout} theme={theme} /> : null}
        {model.screen === "details" && plan ? <DetailsView plan={plan} model={model} width={width} layout={layout} theme={theme} /> : null}
        {model.screen === "confirm" && audit && plan ? <ConfirmView audit={audit} plan={plan} model={model} compact={compact} theme={theme} /> : null}
        {model.screen === "applying" ? <Panel title="Applying safely" theme={theme} borderColor={theme.warning}><Text color={theme.warning}>◌ {model.progress ?? "Installing selected checks and writing reviewed files…"}</Text></Panel> : null}
        {model.screen === "success" ? <Panel title="Setup complete" theme={theme} borderColor={theme.success}><Text color={theme.success}>● Repository health setup completed successfully.</Text><Newline /><Text {...textColor(theme)}>Run `repnix check` to verify the new checks.</Text></Panel> : null}
        {model.screen === "error" ? <Panel title="Setup stopped" theme={theme} borderColor={theme.danger}><Text color={theme.danger}>◆ {model.error ?? "An unexpected error occurred."}</Text><Newline /><Text color={theme.muted}>No further changes will be applied.</Text></Panel> : null}
      </Box>
      <Footer model={model} sidebarMode={sidebarMode} theme={theme} />
    </Box>
  );
}

function supportsTui(): boolean {
  return Boolean(
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    (process.stdout.columns ?? 0) >= 80 &&
    (process.stdout.rows ?? 0) >= 24 &&
    process.env.TERM !== "dumb",
  );
}

export async function runSetupTui(options: DiagnosticOptions = {}): Promise<number> {
  if (!supportsTui()) return 2;
  const logger = resolveDiagnosticLogger(options);
  const result = { code: 0 };
  process.stdout.write("\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l");
  try {
    const app = render(<SetupApp options={options} logger={logger} result={result} />, { exitOnCtrlC: false });
    await app.waitUntilExit();
    return result.code;
  } finally {
    process.stdout.write("\u001b[?25h\u001b[?1049l");
  }
}

export { supportsTui };
