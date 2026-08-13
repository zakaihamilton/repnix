import React from "react";
import { Box, Newline, Text } from "ink";
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS } from "../core/health-category.js";
import { builtinProvider } from "../providers/registry.js";
import type { InstallPlan, InstallProgress, RepositoryContext } from "../core/types.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import { setupCheckDetails } from "./setup-helpers.js";
import type { SetupTuiModel } from "./setup-state.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { setupStepIndex, textColor, type SetupTuiTheme } from "./setup-theme.js";

export function progressMessage(progress: InstallProgress): string {
  if (progress.phase === "validating") return `Validating ${progress.total ?? 0} reviewed file${progress.total === 1 ? "" : "s"}…`;
  if (progress.phase === "snapshotting") return `Saving rollback snapshots for ${progress.total ?? 0} file${progress.total === 1 ? "" : "s"}…`;
  if (progress.phase === "writing-files") return progress.label ? `${progress.current ?? 0}/${progress.total ?? 0} files · ${progress.label}` : "No reviewed files need writing.";
  if (progress.phase === "running-command") return `Running command ${progress.current ?? 0}/${progress.total ?? 0}: ${progress.label ?? ""}`;
  if (progress.phase === "rollback") return "Apply failed; rolling back reviewed changes…";
  return "Finishing setup…";
}

export function Panel({ title, children, theme, flexGrow = 1, flexShrink, width, borderColor, fill = true }: { title: string; children: React.ReactNode; theme: SetupTuiTheme; flexGrow?: number; flexShrink?: number; width?: string | number; borderColor?: string; fill?: boolean }): React.ReactElement {
  return <Box borderStyle="round" borderColor={borderColor ?? theme.border} flexDirection="column" paddingX={1} flexGrow={flexGrow} flexShrink={flexShrink} width={width} {...(fill ? { height: "100%" } : {})} overflow="hidden">
    <Text bold color={theme.primary}>{` ${title} `}</Text>
    <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">{children}</Box>
  </Box>;
}

export function Header({ model, repositoryName, packageManager, compact, theme }: { model: SetupTuiModel; repositoryName: string; packageManager: string | null; compact: boolean; theme: SetupTuiTheme }): React.ReactElement {
  const steps = ["Audit", "Manual guidance", "Select checks", "Review changes", "Apply safely"];
  const active = setupStepIndex(model.screen);
  return <Box flexDirection="column" marginBottom={1} flexShrink={0}>
    <Box flexDirection={compact ? "column" : "row"} justifyContent="space-between">
      <Text bold color={theme.primary}>◆ REP<Text color={theme.secondary}>NIX</Text> <Text color={theme.muted}>/ SETUP</Text></Text>
      <Text color={theme.muted} wrap="truncate-end"><Text {...textColor(theme)}>{repositoryName}</Text>  ·  {packageManager ?? "package manager unresolved"}</Text>
    </Box>
    <Box marginTop={1}>{steps.map((step, index) => <Box key={step} marginRight={2}><Text color={index < active ? theme.success : index === active ? theme.primary : theme.muted} bold={index === active}>{index < active ? "● " : index === active ? "◆ " : "○ "}{step}</Text></Box>)}</Box>
  </Box>;
}

function KeyHint({ label, children, theme }: { label: string; children: React.ReactNode; theme: SetupTuiTheme }): React.ReactElement {
  return <Text><Text color={theme.primary} backgroundColor={theme.panelRaised} bold>{` ${label} `}</Text> <Text color={theme.muted}>{children}</Text></Text>;
}

export function Footer({ model, sidebarMode, hasManualRecommendations, theme }: { model: SetupTuiModel; sidebarMode: boolean; hasManualRecommendations?: boolean; theme: SetupTuiTheme }): React.ReactElement {
  const hints: Array<[string, string]> = model.screen === "audit"
    ? [["↑↓/jk", "scroll"], ["Enter", hasManualRecommendations ? "continue to guidance" : "continue to checks"], ["q/Esc", "exit"]]
    : model.screen === "manual"
      ? [["↑↓/jk", "scroll"], ["Enter", "continue to checks"], ["Esc/Delete", "back to audit"], ["q", "quit"]]
    : model.screen === "select"
      ? [["↑↓/jk", "move"], ["Space", "toggle"], ...(sidebarMode ? [["Tab", model.sidebarCollapsed ? "show checks" : "show details"] as [string, string]] : []), ["Enter", "review"], ["Esc/Delete", "back"], ["q", "quit"]]
      : model.screen === "review"
        ? [["↑↓", "move"], ["Space", "inspect"], ...(sidebarMode ? [["Tab", model.sidebarCollapsed ? "show files" : "show details"] as [string, string]] : []), ["Enter", "confirm"], ["Esc/Delete", "back"], ["q", "quit"]]
        : model.screen === "details" || model.screen === "check-details" ? [["↑↓/jk", "scroll"], ["Esc/Delete", "back"], ["q", "quit"]]
          : model.screen === "confirm" ? [["←→", "focus"], ["Enter", "select"], ["Esc/Delete", "back"], ["q", "quit"]]
            : model.screen === "success" ? [["Enter", "run check"], ["q/Esc", "exit"]]
            : model.screen === "error" ? [["Enter/q", "exit"]] : [["…", "Please wait"]];
  return <Box borderStyle="single" borderColor={theme.borderStrong} paddingX={1} marginTop={1} flexShrink={0}><Box flexDirection="row" flexWrap="wrap">{hints.map(([label, description], index) => <Box key={label} flexDirection="row" marginRight={index < hints.length - 1 ? 2 : 0} flexShrink={0}>{index > 0 ? <Text color={theme.border}>·  </Text> : null}<KeyHint label={label} theme={theme}>{description}</KeyHint></Box>)}</Box></Box>;
}

function DetailSection({ title, children, theme }: { title: string; children: React.ReactNode; theme: SetupTuiTheme }): React.ReactElement {
  return <Box flexDirection="column" marginBottom={1}><Text color={theme.secondary} bold>{title}</Text>{children}</Box>;
}

export function CheckDetailView({ recommendation, context, registry, theme }: { recommendation: AuditModel["recommendations"][number]; context: RepositoryContext; registry?: ProviderRegistry | undefined; theme: SetupTuiTheme }): React.ReactElement {
  const details = setupCheckDetails(recommendation, context, registry);
  return <><Text color={theme.info} bold>{builtinProvider(recommendation.provider)?.description ?? "Repository health check"}</Text><Text color={theme.muted}>{CATEGORY_LABELS[recommendation.category]}: {CATEGORY_DESCRIPTIONS[recommendation.category]}</Text><Newline />
    <DetailSection title="WHY THIS REPOSITORY" theme={theme}><Text {...textColor(theme)}>{recommendation.reason}</Text></DetailSection>
    <DetailSection title="WHAT IT CHECKS" theme={theme}>{details.checks.map((check) => <Text key={check} {...textColor(theme)}>  • {check}</Text>)}</DetailSection>
    <DetailSection title="SCOPE" theme={theme}><Text {...textColor(theme)}>  {details.scope}</Text></DetailSection>
    <DetailSection title="SETUP ADDS" theme={theme}>{details.setup.map((item) => <Text key={item} {...textColor(theme)}>  + {item}</Text>)}</DetailSection>
    <DetailSection title="RUNS" theme={theme}><Text color={theme.primary}>  $ {details.command}</Text></DetailSection>
    {!recommendation.actionable ? <Text color={theme.warning}>◆ Manual configuration required before this check can run.</Text> : null}
    {details.caveat ? <Text color={theme.warning}>◆ {details.caveat}</Text> : null}
  </>;
}

export function CiDetailView({ context, theme }: { context: RepositoryContext; theme: SetupTuiTheme }): React.ReactElement {
  const command = context.packageManager ? `${context.packageManager} run health` : "run health";
  return <><Text color={theme.info} bold>Add the unified repository health check to GitHub Actions.</Text><Newline />
    <DetailSection title="WHAT IT ADDS" theme={theme}><Text {...textColor(theme)}>  A Repository health step in the most obvious workflow job after dependencies are installed.</Text></DetailSection>
    <DetailSection title="RUNS" theme={theme}><Text color={theme.primary}>  $ {command}</Text></DetailSection>
    <DetailSection title="SAFETY" theme={theme}><Text {...textColor(theme)}>  Existing workflow steps are preserved. If RepNix cannot identify one unambiguous checkout and install job, it leaves the workflow unchanged and shows a manual warning in the review.</Text></DetailSection>
  </>;
}

export function planStats(plan: InstallPlan): string {
  const parts: string[] = [];
  if (plan.packages.length) parts.push(`${plan.packages.length} package${plan.packages.length === 1 ? "" : "s"}`);
  if (plan.files.length) parts.push(`${plan.files.length} file${plan.files.length === 1 ? "" : "s"}`);
  if (plan.warnings.length) parts.push(`${plan.warnings.length} warning${plan.warnings.length === 1 ? "" : "s"}`);
  if (plan.conflicts.length) parts.push(`${plan.conflicts.length} preserved conflict${plan.conflicts.length === 1 ? "" : "s"}`);
  return parts.join("  ·  ") || "No changes";
}

export function ReviewNotes({ plan, theme }: { plan: InstallPlan; theme: SetupTuiTheme }): React.ReactElement {
  if (!plan.warnings.length && !plan.conflicts.length) return <Text color={theme.success}>● No warnings or conflicts.</Text>;
  return <Box flexDirection="column">{plan.warnings.map((warning, index) => <Text key={`warning-${index}`} color={theme.warning}>◆ Warning: {warning}</Text>)}{plan.conflicts.map((conflict, index) => <Text key={`conflict-${index}`} color={theme.warning}>◆ Preserved: {conflict}</Text>)}</Box>;
}

export function ConfirmButton({ label, focused, theme }: { label: string; focused: boolean; theme: SetupTuiTheme }): React.ReactElement {
  return <Text color={focused ? theme.primary : theme.muted} backgroundColor={focused ? theme.active : theme.panelRaised} bold={focused}>{` ${label} `}</Text>;
}
