import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Newline, Text, render, useApp, useInput, useStdout } from "ink";
import type { DiagnosticLogger, DiagnosticOptions } from "../cli/options.js";
import { resolveDiagnosticLogger } from "../cli/options.js";
import { auditRepository } from "../cli/audit.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import type { InstallPlan } from "../core/types.js";
import { applyInstallPlan } from "../setup/apply-plan.js";
import { buildInstallPlan } from "../setup/install-plan.js";
import { renderFileDiff } from "../setup/file-plan.js";
import { createSetupTuiModel, selectionItems, setupTuiReducer, type SetupTuiModel } from "./setup-state.js";
import { auditContentLineCount, auditPageSummary, auditRecommendationSummary, auditSetupOptions, auditStatusPresentation, manualContentLineCount, manualRecommendationLines, manualRecommendationSteps, manualRecommendationViewport, selectedSetupOptions, setupCheckDetails, type AuditPageSummary, type SetupCheckDetails } from "./setup-helpers.js";
import { createSetupTuiTheme, diffLineColor, normalizeTuiDiffLine, selectionIndicator, selectionRowPresentation, setupPaneLayout, setupStepIndex, tuiLayoutMetrics, clampTuiScroll, type ColorOutput, type SetupPaneLayout, type SetupTuiTheme, type ThemeEnvironment, type TuiLayoutMetrics } from "./setup-theme.js";
import { Footer, Header, Panel, progressMessage } from "./setup-components.js";
import { AuditView, ConfirmView, DetailsView, ManualRecommendationsView, ReviewView, SelectView, auditUsesSingleColumn, AUDIT_LABEL_COLUMN_WIDTH, AUDIT_TWO_COLUMN_MIN_WIDTH } from "./setup-views.js";

export interface SetupTuiDependencies {
  audit: typeof auditRepository;
  buildPlan: typeof buildInstallPlan;
  applyPlan: typeof applyInstallPlan;
}

export interface SetupTuiProps {
  options: DiagnosticOptions;
  logger: DiagnosticLogger;
  dependencies?: Partial<SetupTuiDependencies>;
  result: { code: number };
}

const defaultDependencies: SetupTuiDependencies = { audit: auditRepository, buildPlan: buildInstallPlan, applyPlan: applyInstallPlan };

export function SetupApp({ options, logger, dependencies = {}, result }: SetupTuiProps): React.ReactElement {
  const deps = { ...defaultDependencies, ...dependencies };
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [audit, setAudit] = useState<AuditModel>();
  const [plan, setPlan] = useState<InstallPlan>();
  const [model, setModel] = useState<SetupTuiModel>({ screen: "loading", cursor: 0, auditScroll: 0, manualScroll: 0, reviewCursor: 0, detailScroll: 0, confirmFocus: "cancel", selectedProviders: [], includeCi: false, sidebarCollapsed: false });
  const [dimensions, setDimensions] = useState({ width: stdout.columns ?? 100, height: stdout.rows ?? 24 });
  const startedApply = useRef(false);
  const theme = useMemo(() => createSetupTuiTheme(stdout), [stdout]);
  const dispatch = (action: Parameters<typeof setupTuiReducer>[1]) => setModel((current) => setupTuiReducer(current, action));
  const items = useMemo(() => audit ? selectionItems(audit.recommendations, audit.context.hasCI) : [], [audit]);

  useEffect(() => {
    const handleResize = () => setDimensions({ width: stdout.columns ?? 100, height: stdout.rows ?? 24 });
    stdout.on("resize", handleResize);
    handleResize();
    return () => { stdout.off("resize", handleResize); };
  }, [stdout]);

  useEffect(() => {
    void deps.audit(process.cwd(), { ...options, logger }).then((nextAudit) => {
      setAudit(nextAudit);
      if (nextAudit.context.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        dispatch({ type: "fail", message: "Repository detection reported an error. Run `repnix audit` for details." });
        return;
      }
      setModel(createSetupTuiModel(nextAudit.recommendations));
    }).catch((error: unknown) => dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }));
  }, []);

  useEffect(() => {
    if (model.screen !== "planning" || !audit) return;
    void deps.buildPlan(audit.context, model.selectedProviders, model.includeCi, audit.registry).then((nextPlan) => {
      setPlan(nextPlan);
      dispatch({ type: "planning-complete" });
    }).catch((error: unknown) => dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }));
  }, [model.screen]);

  useEffect(() => {
    if (model.screen !== "applying" || !audit || !plan || startedApply.current) return;
    startedApply.current = true;
    void deps.applyPlan(audit.context, plan, logger, options.timeout === undefined ? undefined : options.timeout * 1000, (progress) => dispatch({ type: "progress", message: progressMessage(progress) })).then(async () => {
      const after = await deps.audit(process.cwd(), { ...options, logger });
      const beforeCovered = audit.coverage.filter((entry) => entry.status === "covered").length;
      const gained = Math.max(after.coverage.filter((entry) => entry.status === "covered").length - beforeCovered, 0);
      dispatch({ type: "progress", message: gained ? `${gained} additional categor${gained === 1 ? "y is" : "ies are"} now covered.` : "Setup changes were verified." });
      dispatch({ type: "complete" });
    }).catch((error: unknown) => dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }));
  }, [model.screen]);

  const { width, height } = dimensions;
  const paneLayout = setupPaneLayout(width, height);
  const compact = paneLayout !== "horizontal";
  const sidebarMode = paneLayout === "focused-sidebar";
  const auditSingleColumn = auditUsesSingleColumn(width);
  const layout = tuiLayoutMetrics(height, compact);
  const auditLineCount = audit ? auditContentLineCount(audit, auditSingleColumn, width) : 0;
  const manualLineCount = audit ? manualContentLineCount(audit, width) : 0;
  const detailFile = plan?.files[model.reviewCursor];
  const detailLineCount = detailFile ? renderFileDiff(detailFile, Math.max(width - 8, 32)).split("\n").length : 0;
  const busy = model.screen === "loading" || model.screen === "planning" || model.screen === "applying";
  const leave = () => { result.code = model.screen === "error" ? 2 : 0; exit(); };

  useInput((input, key) => {
    if (input === "\u0003" || (key.ctrl && input === "c")) { if (!busy) leave(); return; }
    if (input === "q") { if (!busy) leave(); return; }
    if (key.escape || key.backspace || key.delete) {
      if (busy) return;
      if (model.screen === "details") dispatch({ type: "close-details" });
      else if (model.screen === "manual") dispatch({ type: "back-to-audit" });
      else if (model.screen === "confirm") dispatch({ type: "cancel-confirm" });
      else if (model.screen === "review") dispatch({ type: "back-to-select" });
      else if (model.screen === "select") dispatch({ type: "back-to-audit" });
      else leave();
      return;
    }
    if (model.screen === "loading" || model.screen === "planning" || model.screen === "applying") return;
    if (key.tab) { if (sidebarMode && (model.screen === "select" || model.screen === "review")) dispatch({ type: "toggle-sidebar" }); return; }
    if (model.screen === "audit") {
      if (key.upArrow || input === "k") dispatch({ type: "move-audit", direction: "up", lineCount: auditLineCount, viewport: layout.detailViewport });
      else if (key.downArrow || input === "j") dispatch({ type: "move-audit", direction: "down", lineCount: auditLineCount, viewport: layout.detailViewport });
      else if (key.return) dispatch({ type: audit?.recommendations.some((recommendation) => !recommendation.actionable) ? "begin-manual" : audit?.recommendations.some((recommendation) => recommendation.actionable) ? "begin-selection" : "show-empty" });
      return;
    }
    if (model.screen === "manual") {
      if (key.upArrow || input === "k") dispatch({ type: "move-manual", direction: "up", lineCount: manualLineCount, viewport: manualRecommendationViewport(layout.detailViewport) });
      else if (key.downArrow || input === "j") dispatch({ type: "move-manual", direction: "down", lineCount: manualLineCount, viewport: manualRecommendationViewport(layout.detailViewport) });
      else if (key.return) dispatch({ type: audit?.recommendations.some((recommendation) => recommendation.actionable) ? "begin-selection" : "show-empty" });
      return;
    }
    if (model.screen === "success" || model.screen === "empty" || model.screen === "error") { result.code = model.screen === "error" ? 2 : 0; exit(); return; }
    if (model.screen === "select") {
      const sidebarFocused = sidebarMode ? !model.sidebarCollapsed : true;
      if (sidebarFocused && (key.upArrow || input === "k")) dispatch({ type: "move", direction: "up", itemCount: items.length });
      else if (sidebarFocused && (key.downArrow || input === "j")) dispatch({ type: "move", direction: "down", itemCount: items.length });
      else if (sidebarFocused && input === " ") { const item = items[model.cursor]; if (item) dispatch({ type: "toggle", item }); }
      else if (key.return) dispatch({ type: "begin-planning" });
      return;
    }
    if (model.screen === "review") {
      const sidebarFocused = sidebarMode ? !model.sidebarCollapsed : true;
      if (sidebarFocused && (key.upArrow || input === "k")) dispatch({ type: "move-review", direction: "up", fileCount: plan?.files.length ?? 0 });
      else if (sidebarFocused && (key.downArrow || input === "j")) dispatch({ type: "move-review", direction: "down", fileCount: plan?.files.length ?? 0 });
      else if (sidebarFocused && input === " " && plan?.files.length) dispatch({ type: "open-details" });
      else if (key.return) dispatch({ type: "begin-confirm" });
      return;
    }
    if (model.screen === "confirm") {
      if (key.rightArrow) dispatch({ type: "move-confirm", direction: "right" });
      else if (key.leftArrow) dispatch({ type: "move-confirm", direction: "left" });
      else if (key.return) dispatch({ type: model.confirmFocus === "apply" ? "begin-applying" : "cancel-confirm" });
      return;
    }
    if (model.screen === "details") {
      if (key.upArrow || input === "k") dispatch({ type: "move-detail", direction: "up", lineCount: detailLineCount, viewport: layout.detailViewport });
      else if (key.downArrow || input === "j") dispatch({ type: "move-detail", direction: "down", lineCount: detailLineCount, viewport: layout.detailViewport });
    }
  });

  return <Box flexDirection="column" width="100%" height={height} paddingX={1} overflow="hidden">
    <Header model={model} repositoryName={audit?.context.packageJson.name ?? "repository"} packageManager={audit?.context.packageManager ?? null} compact={compact} theme={theme} />
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={1} overflow="hidden">
      {model.screen === "loading" ? <Panel title="Scanning repository" theme={theme} borderColor={theme.info}><Text color={theme.info}>◌ Detecting checks, project structure, and recommendations…</Text></Panel> : null}
      {model.screen === "audit" && audit ? <AuditView audit={audit} singleColumn={auditSingleColumn} scroll={model.auditScroll} viewport={layout.detailViewport} theme={theme} /> : null}
      {model.screen === "manual" && audit ? <ManualRecommendationsView audit={audit} scroll={model.manualScroll} viewport={layout.detailViewport} width={width} theme={theme} /> : null}
      {model.screen === "empty" ? <Panel title="Nothing to add" theme={theme} borderColor={theme.success}><Text color={theme.success}>● Your active checks already cover the gaps RepNix found.</Text></Panel> : null}
      {model.screen === "select" && audit ? <SelectView audit={audit} model={model} paneLayout={paneLayout} theme={theme} /> : null}
      {model.screen === "planning" ? <Panel title="Preparing review" theme={theme} borderColor={theme.info}><Text color={theme.info}>◌ Building a safe setup plan…</Text></Panel> : null}
      {model.screen === "review" && plan ? <ReviewView plan={plan} model={model} paneLayout={paneLayout} theme={theme} /> : null}
      {model.screen === "details" && plan ? <DetailsView plan={plan} model={model} width={width} layout={layout} theme={theme} /> : null}
      {model.screen === "confirm" && audit && plan ? <ConfirmView audit={audit} plan={plan} model={model} compact={compact} theme={theme} /> : null}
      {model.screen === "applying" ? <Panel title="Applying safely" theme={theme} borderColor={theme.warning}><Text color={theme.warning}>◌ {model.progress ?? "Installing selected checks and writing reviewed files…"}</Text></Panel> : null}
      {model.screen === "success" ? <Panel title="Setup complete" theme={theme} borderColor={theme.success}><Text color={theme.success}>● Repository health setup completed successfully.</Text><Newline /><Text>{model.progress}</Text><Text>Run `repnix check --details` to review findings.</Text></Panel> : null}
      {model.screen === "error" ? <Panel title="Setup stopped" theme={theme} borderColor={theme.danger}><Text color={theme.danger}>◆ {model.error ?? "An unexpected error occurred."}</Text><Newline /><Text color={theme.muted}>No further changes will be applied.</Text></Panel> : null}
    </Box>
    <Footer model={model} sidebarMode={sidebarMode} hasManualRecommendations={Boolean(audit?.recommendations.some((recommendation) => !recommendation.actionable))} theme={theme} />
  </Box>;
}

function supportsTui(): boolean { return Boolean(process.stdin.isTTY && process.stdout.isTTY && (process.stdout.columns ?? 0) >= 80 && (process.stdout.rows ?? 0) >= 24 && process.env.TERM !== "dumb"); }

export async function runSetupTui(options: DiagnosticOptions = {}): Promise<number> {
  if (!supportsTui()) return 2;
  const logger = resolveDiagnosticLogger(options);
  const result = { code: 0 };
  process.stdout.write("\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l");
  try { const app = render(<SetupApp options={options} logger={logger} result={result} />, { exitOnCtrlC: false }); await app.waitUntilExit(); return result.code; }
  finally { process.stdout.write("\u001b[?25h\u001b[?1049l"); }
}

export { supportsTui, createSetupTuiTheme, diffLineColor, normalizeTuiDiffLine, selectionIndicator, selectionRowPresentation, setupPaneLayout, setupStepIndex, tuiLayoutMetrics, clampTuiScroll, auditContentLineCount, auditPageSummary, auditRecommendationSummary, auditSetupOptions, auditStatusPresentation, manualContentLineCount, manualRecommendationLines, manualRecommendationSteps, manualRecommendationViewport, selectedSetupOptions, setupCheckDetails };
export type { AuditPageSummary, SetupCheckDetails, ColorOutput, SetupPaneLayout, SetupTuiTheme, ThemeEnvironment, TuiLayoutMetrics };
export { AUDIT_LABEL_COLUMN_WIDTH, AUDIT_TWO_COLUMN_MIN_WIDTH, auditUsesSingleColumn };
export { COMPACT_LAYOUT_HEIGHT, COMPACT_LAYOUT_WIDTH, HORIZONTAL_PANE_MIN_WIDTH } from "./setup-theme.js";
