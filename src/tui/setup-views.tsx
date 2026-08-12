import React from "react";
import { Box, Newline, Text } from "ink";
import { CATEGORY_LABELS } from "../core/health-category.js";
import type { InstallPlan } from "../core/types.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import { renderFileDiff } from "../setup/file-plan.js";
import { selectionItems, type SetupSelectionItem, type SetupTuiModel } from "./setup-state.js";
import { auditContentLineCount, auditPageSummary, auditRecommendationSummary, auditSetupOptions, selectedSetupOptions } from "./setup-helpers.js";
import { clampTuiScroll, diffLineColor, foregroundColor, normalizeTuiDiffLine, selectionRowPresentation, SIDEBAR_CONTENT_WIDTH, SIDEBAR_WIDTH, textColor, type SetupPaneLayout, type SetupTuiTheme, type TuiLayoutMetrics } from "./setup-theme.js";
import { CheckDetailView, CiDetailView, ConfirmButton, Panel, planStats, ReviewNotes } from "./setup-components.js";
import { wrapTerminalText } from "../reporting/console-reporter.js";

export const AUDIT_LABEL_COLUMN_WIDTH = 25;
export const AUDIT_TWO_COLUMN_MIN_WIDTH = 120;

export function auditUsesSingleColumn(width: number): boolean { return width < AUDIT_TWO_COLUMN_MIN_WIDTH; }

function providerFor(items: SetupSelectionItem[], model: SetupTuiModel): SetupSelectionItem | undefined { return items[model.cursor]; }

function auditCoverageRow(entry: AuditModel["coverage"][number], theme: SetupTuiTheme): React.ReactElement {
  const status = entry.status === "covered" ? { symbol: "✓", color: theme.success } : entry.status === "partial" ? { symbol: "◐", color: theme.warning } : entry.status === "missing" ? { symbol: "✗", color: theme.danger } : entry.status === "off" ? { symbol: "–", color: theme.muted } : { symbol: "·", color: theme.muted };
  return <Box key={entry.category} flexDirection="row" overflow="hidden"><Box width={2} flexShrink={0}><Text color={status.color}>{status.symbol}</Text></Box><Box width={AUDIT_LABEL_COLUMN_WIDTH} flexShrink={0}><Text {...textColor(theme)} wrap="truncate-end">{CATEGORY_LABELS[entry.category]}</Text></Box>{entry.providers.length ? <Text color={status.color} wrap="truncate-end">{entry.providers.join(", ")}</Text> : null}</Box>;
}

export function AuditView({ audit, singleColumn, scroll, viewport, theme }: { audit: AuditModel; singleColumn: boolean; scroll: number; viewport: number; theme: SetupTuiTheme }): React.ReactElement {
  const page = auditPageSummary(audit);
  const summary = auditRecommendationSummary(audit.recommendations, true);
  const setupOptions = auditSetupOptions(audit);
  const relevantCoverage = audit.coverage.filter((entry) => entry.status !== "not-applicable");
  const coverageLines = singleColumn ? relevantCoverage.map((entry) => auditCoverageRow(entry, theme)) : Array.from({ length: Math.ceil(relevantCoverage.length / 2) }, (_, index) => <Box key={`coverage-row-${index}`} flexDirection="row" gap={2} overflow="hidden"><Box width="50%" flexShrink={0}>{relevantCoverage[index] ? auditCoverageRow(relevantCoverage[index]!, theme) : null}</Box><Box width="50%" flexShrink={0}>{relevantCoverage[index + Math.ceil(relevantCoverage.length / 2)] ? auditCoverageRow(relevantCoverage[index + Math.ceil(relevantCoverage.length / 2)]!, theme) : null}</Box></Box>);
  const lines: React.ReactNode[] = [
    <Text key="repository" {...textColor(theme)}>Repository: <Text color={theme.primary}>{page.repositoryName}</Text></Text>,
    <Text key="package-manager" {...textColor(theme)}>Package manager: <Text color={theme.primary}>{page.packageManager}</Text>  ·  CI: {page.ci}</Text>,
    <Text key="facts" {...textColor(theme)} wrap="truncate-end">Roles: {page.roles.join(", ") || "none detected"}  ·  Languages: {page.languages.join(", ") || "none detected"}  ·  Workspaces: {page.workspaceCount}</Text>,
    <Newline key="facts-gap" />, <Text key="coverage-heading" color={theme.secondary} bold>HEALTH COVERAGE</Text>, ...coverageLines,
    <Newline key="coverage-gap" />, <Text key="next-steps-heading" color={theme.secondary} bold>NEXT STEPS</Text>,
    <Text key="recommendations" {...textColor(theme)}>Recommendations: {summary.baseline} baseline  ·  {summary.optional} optional  ·  {summary.advanced} advanced</Text>,
    ...(setupOptions.length ? [<Text key="setup-options" {...textColor(theme)} wrap="wrap">Setup options: {setupOptions.join(" · ")}</Text>] : []),
    <Text key="prompt" color={setupOptions.length ? theme.primary : theme.success} bold>{setupOptions.length ? "Press Enter to choose checks and continue setup." : "No actionable setup changes were found. Press Enter to finish."}</Text>,
  ];
  const start = clampTuiScroll(scroll, lines.length, Math.max(viewport, 1));
  const visible = lines.slice(start, start + Math.max(viewport, 1));
  return <Panel title="Repository audit" theme={theme} borderColor={theme.info}>{visible}{start + visible.length < lines.length ? <Text color={theme.muted}>↓ more · use ↑↓ to scroll</Text> : null}</Panel>;
}

export function SelectView({ audit, model, theme, paneLayout }: { audit: AuditModel; model: SetupTuiModel; theme: SetupTuiTheme; paneLayout: SetupPaneLayout }): React.ReactElement {
  const items = selectionItems(audit.recommendations, audit.context.hasCI);
  const selected = providerFor(items, model);
  const recommendation = selected?.kind === "provider" ? audit.recommendations.find((item) => item.provider === selected.provider) : undefined;
  const horizontal = paneLayout === "horizontal";
  const focusedSidebar = paneLayout === "focused-sidebar";
  const showSidebar = !focusedSidebar || !model.sidebarCollapsed;
  const showDetails = !focusedSidebar || model.sidebarCollapsed;
  const sidebar = <Panel title="Recommended checks" width={horizontal ? SIDEBAR_WIDTH : "100%"} flexGrow={0} flexShrink={0} fill={horizontal} theme={theme} borderColor={theme.borderStrong}>
    {items.map((item, index) => { const checked = item.kind === "ci" ? model.includeCi : model.selectedProviders.includes(item.provider); const active = index === model.cursor; const itemRecommendation = item.kind === "provider" ? audit.recommendations.find((entry) => entry.provider === item.provider) : undefined; const presentation = selectionRowPresentation(item.name, checked, active, itemRecommendation?.priority, theme, SIDEBAR_CONTENT_WIDTH); return <Text key={item.kind === "ci" ? item.name : item.provider} {...foregroundColor(presentation.color)} {...(presentation.backgroundColor ? { backgroundColor: presentation.backgroundColor } : {})} bold={presentation.bold} wrap="truncate-end">{presentation.label}</Text>; })}
    {items.length === 0 ? <Text color={theme.success}>No setup changes are recommended.</Text> : null}
  </Panel>;
  return <Box flexDirection={horizontal ? "row" : "column"} gap={horizontal ? 1 : 0} flexGrow={1} minHeight={1} overflow="hidden">{showSidebar ? sidebar : null}{showDetails ? <Panel width="100%" title={recommendation ? `${recommendation.name} · ${CATEGORY_LABELS[recommendation.category] ?? recommendation.category}` : selected?.name ?? "Setup overview"} flexGrow={1} fill={horizontal} theme={theme} borderColor={recommendation ? theme.primary : theme.border}>{recommendation ? <CheckDetailView recommendation={recommendation} context={audit.context} registry={audit.registry} theme={theme} /> : selected?.kind === "ci" ? <CiDetailView context={audit.context} theme={theme} /> : <Text color={theme.muted}>Select a check to see why it is recommended and what it will add.</Text>}</Panel> : null}</Box>;
}

export function ReviewView({ plan, model, theme, paneLayout }: { plan: InstallPlan; model: SetupTuiModel; theme: SetupTuiTheme; paneLayout: SetupPaneLayout }): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  const horizontal = paneLayout === "horizontal";
  const focusedSidebar = paneLayout === "focused-sidebar";
  const showSidebar = !focusedSidebar || !model.sidebarCollapsed;
  const showDetails = !focusedSidebar || model.sidebarCollapsed;
  const sidebar = <Panel title="Planned changes" width={horizontal ? SIDEBAR_WIDTH : "100%"} flexGrow={0} flexShrink={0} fill={horizontal} theme={theme} borderColor={theme.borderStrong}><Text color={theme.primary} bold>{planStats(plan)}</Text><Newline /><Text color={theme.secondary} bold>PACKAGES</Text>{plan.packages.length ? plan.packages.map((item) => <Text key={item.name} {...textColor(theme)}>  + {item.name}{item.version ? `@${item.version}` : ""}</Text>) : <Text color={theme.muted}>  none</Text>}<Newline /><Text color={theme.secondary} bold>FILES</Text>{plan.files.length ? plan.files.map((item, index) => <Text key={item.path} {...(index === model.reviewCursor ? { color: theme.primary, backgroundColor: theme.active } : textColor(theme))} bold={index === model.reviewCursor}>{`${index === model.reviewCursor ? "▸" : " "} ${item.kind === "create" ? "A" : "M"} ${item.path}`}</Text>) : <Text color={theme.muted}>  none</Text>}{plan.warnings.length ? <><Newline /><Text color={theme.warning}>◆ Warnings: {plan.warnings.length}</Text></> : null}{plan.conflicts.length ? <Text color={theme.warning}>◆ Conflicts preserved: {plan.conflicts.length}</Text> : null}</Panel>;
  return <Box flexDirection={horizontal ? "row" : "column"} gap={horizontal ? 1 : 0} flexGrow={1} minHeight={1} overflow="hidden">{showSidebar ? sidebar : null}{showDetails ? <Panel width="100%" title={file ? `Detail · ${file.path}` : "Review summary"} flexGrow={1} fill={horizontal} theme={theme} borderColor={plan.warnings.length || plan.conflicts.length ? theme.warning : theme.border}>{file ? <><Text color={theme.muted}>{file.reason}</Text><Newline /><Text color={theme.info}>Press Space to inspect this file.</Text></> : <Text color={theme.muted}>No file changes are planned. Press Enter to continue.</Text>}{plan.commands.length ? <><Newline /><Text color={theme.secondary} bold>COMMANDS</Text>{plan.commands.map((command) => <Text key={command.command} {...textColor(theme)}>{`  $ ${command.command} ${command.args.join(" ")}`}</Text>)}</> : null}<Newline /><Text color={theme.secondary} bold>REVIEW NOTES</Text><ReviewNotes plan={plan} theme={theme} /></Panel> : null}</Box>;
}

export function DetailsView({ plan, model, width, layout, theme }: { plan: InstallPlan; model: SetupTuiModel; width: number; layout: TuiLayoutMetrics; theme: SetupTuiTheme }): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  if (!file) return <Panel title="Details" theme={theme}><Text color={theme.muted}>There are no file details to show.</Text></Panel>;
  const diff = renderFileDiff(file, Math.max(width - 8, 32)).split("\n").map(normalizeTuiDiffLine);
  const scroll = clampTuiScroll(model.detailScroll, diff.length, layout.detailViewport);
  const visible = diff.slice(scroll, scroll + layout.detailViewport);
  return <Panel title={`File detail · ${file.path}`} theme={theme} borderColor={theme.info}><Text color={theme.muted}>{file.reason}</Text><Newline />{visible.map((line, index) => <Text key={`${index}-${line}`} {...foregroundColor(diffLineColor(line, theme))}>{line}</Text>)}{scroll + visible.length < diff.length ? <Text color={theme.muted}>↓ more</Text> : null}</Panel>;
}

export function ConfirmView({ audit, plan, model, compact, theme }: { audit: AuditModel; plan: InstallPlan; model: SetupTuiModel; compact: boolean; theme: SetupTuiTheme }): React.ReactElement {
  const selectedOptions = selectedSetupOptions(audit, model);
  return <Panel title="Confirm setup" theme={theme} borderColor={theme.warning}><Text color={theme.warning} bold>◆ Apply these reviewed changes?</Text><Newline /><Text color={theme.primary} bold>{planStats(plan)}</Text><Newline /><Text color={theme.secondary} bold>SELECTED OPTIONS</Text>{selectedOptions.length ? selectedOptions.map((option) => <Text key={option} {...textColor(theme)}>  + {option}</Text>) : <Text color={theme.muted}>  No setup options selected.</Text>}<Newline /><Text color={theme.secondary} bold>REVIEW NOTES</Text><ReviewNotes plan={plan} theme={theme} /><Newline /><Box flexDirection={compact ? "column" : "row"} gap={1}><ConfirmButton label="CANCEL" focused={model.confirmFocus === "cancel"} theme={theme} /><ConfirmButton label="APPLY" focused={model.confirmFocus === "apply"} theme={theme} /></Box><Text color={theme.muted}>Use the arrow keys to choose an action, then press Enter.</Text></Panel>;
}

export { auditContentLineCount, wrapTerminalText };
