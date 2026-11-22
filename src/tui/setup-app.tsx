import { Box, Newline, render, Text, useApp, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auditRepository } from "../cli/audit.js";
import type { DiagnosticLogger, DiagnosticOptions } from "../cli/options.js";
import { resolveDiagnosticLogger } from "../cli/options.js";
import type { InstallPlan, RepositoryDiagnostic } from "../core/types.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import {
  renderSetupCheckSummary,
  renderSetupHealthReport,
  saveSetupCheckReports,
} from "../reporting/setup-check-report.js";
import type { CommandResult } from "../runners/command-runner.js";
import { applyInstallPlan } from "../setup/apply-plan.js";
import { renderFileDiff } from "../setup/file-plan.js";
import { buildInstallPlan } from "../setup/install-plan.js";
import { runSetupCheck, setupCheckResultOutput } from "./run-setup-check.js";
import { Footer, Header, Panel, progressMessage } from "./setup-components.js";
import {
  auditContentLineCount,
  auditPageSummary,
  auditRecommendationSummary,
  auditSetupOptions,
  auditStatusPresentation,
  manualContentLineCount,
  manualRecommendationLines,
  manualRecommendationSteps,
  manualRecommendationViewport,
  selectedSetupOptions,
  setupCheckDetails,
} from "./setup-helpers.js";
import { createSetupTuiModel, type SetupTuiModel, selectionItems, setupTuiReducer } from "./setup-state.js";
import {
  COMPACT_LAYOUT_HEIGHT,
  COMPACT_LAYOUT_WIDTH,
  clampTuiScroll,
  createSetupTuiTheme,
  diffLineColor,
  HORIZONTAL_PANE_MIN_WIDTH,
  normalizeTuiDiffLine,
  selectionIndicator,
  selectionRowPresentation,
  setupPaneLayout,
  setupStepIndex,
  tuiLayoutMetrics,
} from "./setup-theme.js";
import {
  ApplyView,
  AUDIT_LABEL_COLUMN_WIDTH,
  AUDIT_TWO_COLUMN_MIN_WIDTH,
  AuditView,
  auditUsesSingleColumn,
  CheckDetailsView,
  ConfirmView,
  checkDetailViewport,
  DetailsView,
  ManualRecommendationsView,
  ReviewView,
  SelectView,
  setupCheckDetailItems,
} from "./setup-views.js";
import { useSetupInput } from "./useSetupInput.js";

export interface SetupTuiDependencies {
  audit: typeof auditRepository;
  buildPlan: typeof buildInstallPlan;
  applyPlan: typeof applyInstallPlan;
  runCheck: (
    root: string,
    logger: DiagnosticLogger,
    timeoutMs?: number,
    onProgress?: (message: string) => void,
  ) => Promise<CommandResult>;
}

export interface SetupTuiProps {
  options: DiagnosticOptions;
  logger: DiagnosticLogger;
  dependencies?: Partial<SetupTuiDependencies>;
  result: { code: number };
}

export function setupDetectionErrorMessage(diagnostics: RepositoryDiagnostic[]): string {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (!errors.length) return "Repository detection reported an error.";

  const instructions = errors.map((diagnostic) => {
    switch (diagnostic.code) {
      case "ambiguous-package-manager":
        return "How to fix: choose the intended package manager, add its packageManager entry to package.json, and remove any stale lockfiles. Then rerun `repnix setup`.";
      case "unsupported-package-manager":
        return "How to fix: set package.json#packageManager to npm, pnpm, yarn, or bun (optionally with a version), then rerun `repnix setup`.";
      default:
        return "How to fix: resolve this repository detection issue, then rerun `repnix setup`.";
    }
  });

  return [...errors.map((diagnostic) => diagnostic.message), "", ...new Set(instructions)].join("\n");
}

const defaultDependencies: SetupTuiDependencies = {
  audit: auditRepository,
  buildPlan: buildInstallPlan,
  applyPlan: applyInstallPlan,
  runCheck: runSetupCheck,
};

export function SetupApp({ options, logger, dependencies = {}, result }: SetupTuiProps): React.ReactElement {
  const deps = { ...defaultDependencies, ...dependencies };
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [audit, setAudit] = useState<AuditModel>();
  const [plan, setPlan] = useState<InstallPlan>();
  const [model, setModel] = useState<SetupTuiModel>({
    screen: "loading",
    cursor: 0,
    auditScroll: 0,
    manualScroll: 0,
    reviewCursor: 0,
    detailScroll: 0,
    confirmFocus: "cancel",
    selectedProviders: [],
    includeCi: false,
    sidebarCollapsed: false,
  });
  const [dimensions, setDimensions] = useState({
    width: stdout.columns ?? 100,
    height: stdout.rows ?? 24,
  });
  const startedApply = useRef(false);
  const startedCheck = useRef(false);
  const theme = useMemo(() => createSetupTuiTheme(stdout), [stdout]);
  const dispatch = useCallback((action: Parameters<typeof setupTuiReducer>[1]) => {
    setModel((current) => setupTuiReducer(current, action));
  }, []);
  const items = useMemo(() => (audit ? selectionItems(audit.recommendations, audit.context.hasCI) : []), [audit]);

  useEffect(() => {
    const handleResize = () => setDimensions({ width: stdout.columns ?? 100, height: stdout.rows ?? 24 });
    stdout.on("resize", handleResize);
    handleResize();
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  useEffect(() => {
    void deps
      .audit(process.cwd(), { ...options, logger })
      .then((nextAudit) => {
        setAudit(nextAudit);
        if (nextAudit.context.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          dispatch({
            type: "fail",
            message: setupDetectionErrorMessage(nextAudit.context.diagnostics),
          });
          return;
        }
        setModel(createSetupTuiModel(nextAudit.recommendations));
      })
      .catch((error: unknown) =>
        dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }),
      );
  }, [dispatch, options, logger, deps.audit]);

  useEffect(() => {
    if (model.screen !== "planning" || !audit) return;
    void deps
      .buildPlan(audit.context, model.selectedProviders, model.includeCi, audit.registry)
      .then((nextPlan) => {
        setPlan(nextPlan);
        dispatch({ type: "planning-complete" });
      })
      .catch((error: unknown) =>
        dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }),
      );
  }, [model.screen, model.selectedProviders, audit?.context, deps.buildPlan, dispatch, audit, model.includeCi]);

  useEffect(() => {
    if (model.screen !== "checking" || !audit || startedCheck.current) return;
    startedCheck.current = true;
    void deps
      .runCheck(
        audit.context.root,
        logger,
        options.timeout === undefined ? undefined : options.timeout * 1000,
        (message) => dispatch({ type: "check-progress", message }),
      )
      .then((check) => {
        const output = setupCheckResultOutput(check);
        return saveSetupCheckReports(audit.context.root, check.stdout).then((saved) =>
          dispatch({
            type: "check-complete",
            output,
            exitCode: check.exitCode,
            ...(saved ? saved : {}),
          }),
        );
      })
      .catch((error: unknown) =>
        dispatch({
          type: "check-complete",
          output: `Error: ${error instanceof Error ? error.message : String(error)}`,
          exitCode: null,
        }),
      );
  }, [model.screen, dispatch, deps.runCheck, logger, audit?.context.root, options.timeout, audit]);

  useEffect(() => {
    if (model.screen === "success") startedCheck.current = false;
  }, [model.screen]);

  useEffect(() => {
    if (model.screen !== "applying" || !audit || !plan || startedApply.current) return;
    startedApply.current = true;
    void deps
      .applyPlan(
        audit.context,
        plan,
        logger,
        options.timeout === undefined ? undefined : options.timeout * 1000,
        (progress) => dispatch({ type: "progress", message: progressMessage(progress) }),
      )
      .then(async () => {
        const after = await deps.audit(process.cwd(), { ...options, logger });
        const beforeCovered = audit.coverage.filter((entry) => entry.status === "covered").length;
        const gained = Math.max(after.coverage.filter((entry) => entry.status === "covered").length - beforeCovered, 0);
        dispatch({
          type: "progress",
          message: gained
            ? `${gained} additional categor${gained === 1 ? "y is" : "ies are"} now covered.`
            : "Setup changes were verified.",
        });
        dispatch({ type: "complete" });
      })
      .catch((error: unknown) =>
        dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) }),
      );
  }, [model.screen, plan, dispatch, deps.applyPlan, options.timeout, audit, options, logger, deps.audit]);

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
  const checkLineCount = setupCheckDetailItems(model.checkOutput ?? "", width, {
    ...(model.checkReportPath ? { reportPath: model.checkReportPath } : {}),
    ...(model.checkSummaryPath ? { summaryPath: model.checkSummaryPath } : {}),
    ...(model.checkExitCode !== undefined ? { exitCode: model.checkExitCode } : {}),
  }).length;
  const checkViewport = checkDetailViewport(layout.detailViewport);
  const busy =
    model.screen === "loading" ||
    model.screen === "planning" ||
    model.screen === "applying" ||
    model.screen === "checking";
  const leave = () => {
    result.code = model.screen === "error" ? 2 : 0;
    exit();
  };

  useSetupInput({
    model,
    audit,
    plan,
    items,
    dispatch,
    sidebarMode,
    busy,
    auditLineCount,
    manualLineCount,
    detailLineCount,
    checkLineCount,
    detailViewport: layout.detailViewport,
    checkViewport,
    leave,
  });

  return (
    <Box flexDirection="column" width="100%" height={height} paddingX={1} overflow="hidden">
      <Header
        model={model}
        repositoryName={audit?.context.packageJson.name ?? "repository"}
        packageManager={audit?.context.packageManager ?? null}
        compact={compact}
        theme={theme}
      />
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {model.screen === "loading" ? (
          <Panel title="Scanning repository" theme={theme} borderColor={theme.info}>
            <Text color={theme.info}>◌ Detecting checks, project structure, and recommendations…</Text>
          </Panel>
        ) : null}
        {model.screen === "audit" && audit ? (
          <AuditView
            audit={audit}
            singleColumn={auditSingleColumn}
            scroll={model.auditScroll}
            viewport={layout.detailViewport}
            theme={theme}
          />
        ) : null}
        {model.screen === "manual" && audit ? (
          <ManualRecommendationsView
            audit={audit}
            scroll={model.manualScroll}
            viewport={layout.detailViewport}
            width={width}
            theme={theme}
          />
        ) : null}
        {model.screen === "empty" ? (
          <Panel title="Nothing to add" theme={theme} borderColor={theme.success}>
            <Text color={theme.success}>● Your active checks already cover the gaps RepNix found.</Text>
          </Panel>
        ) : null}
        {model.screen === "select" && audit ? (
          <SelectView audit={audit} model={model} paneLayout={paneLayout} theme={theme} />
        ) : null}
        {model.screen === "planning" ? (
          <Panel title="Preparing review" theme={theme} borderColor={theme.info}>
            <Text color={theme.info}>◌ Building a safe setup plan…</Text>
          </Panel>
        ) : null}
        {model.screen === "review" && plan ? (
          <ReviewView plan={plan} model={model} paneLayout={paneLayout} theme={theme} />
        ) : null}
        {model.screen === "details" && plan ? (
          <DetailsView plan={plan} model={model} width={width} layout={layout} theme={theme} />
        ) : null}
        {model.screen === "confirm" && audit && plan ? (
          <ConfirmView audit={audit} plan={plan} model={model} theme={theme} />
        ) : null}
        {model.screen === "applying" && plan ? <ApplyView plan={plan} model={model} theme={theme} /> : null}
        {model.screen === "checking" ? (
          <Panel title="Running check" theme={theme} borderColor={theme.info}>
            <Text color={theme.info} bold>
              ◌ Running repository health checks
            </Text>
            <Text color={theme.muted}>
              Checks may run in parallel. Completed results will appear when all checks finish.
            </Text>
            <Newline />
            <Text color={theme.secondary} bold>
              LIVE ACTIVITY
            </Text>
            {(model.checkProgress ?? ["Preparing configured checks…"]).map((message, index, entries) => (
              <Text key={`${index}-${message}`} color={index === entries.length - 1 ? theme.primary : theme.muted}>
                {index === entries.length - 1 ? "◌" : "✓"} {message}
              </Text>
            ))}
          </Panel>
        ) : null}
        {model.screen === "success" ? (
          <Panel title="Setup complete" theme={theme} borderColor={theme.success}>
            <Text color={theme.success}>● Repository health setup completed successfully.</Text>
            <Newline />
            <Text>{model.progress}</Text>
            <Text color={theme.primary} bold>
              Press Enter to run `repnix check` now.
            </Text>
            <Text color={theme.muted}>Run a category with --details later when you need more context.</Text>
          </Panel>
        ) : null}
        {model.screen === "check-details" ? (
          <CheckDetailsView model={model} width={width} layout={layout} theme={theme} />
        ) : null}
        {model.screen === "error" ? (
          <Panel title="Setup stopped" theme={theme} borderColor={theme.danger}>
            <Text color={theme.danger}>◆ {model.error ?? "An unexpected error occurred."}</Text>
            <Newline />
            <Text color={theme.muted}>No further changes will be applied.</Text>
          </Panel>
        ) : null}
      </Box>
      <Footer
        model={model}
        sidebarMode={sidebarMode}
        hasManualRecommendations={Boolean(audit?.recommendations.some((recommendation) => !recommendation.actionable))}
        theme={theme}
      />
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
    const app = render(<SetupApp options={options} logger={logger} result={result} />, {
      exitOnCtrlC: false,
    });
    await app.waitUntilExit();
    return result.code;
  } finally {
    process.stdout.write("\u001b[?25h\u001b[?1049l");
  }
}

export {
  checkDetailViewport,
  checkTableColumns,
  clipTuiLine,
  setupCheckActions,
  setupCheckDetailItems,
  setupCheckOutputLines,
  setupCheckRows,
  tuiPanelContentWidth,
} from "./setup-views.js";
export {
  AUDIT_LABEL_COLUMN_WIDTH,
  AUDIT_TWO_COLUMN_MIN_WIDTH,
  auditContentLineCount,
  auditPageSummary,
  auditRecommendationSummary,
  auditSetupOptions,
  auditStatusPresentation,
  auditUsesSingleColumn,
  COMPACT_LAYOUT_HEIGHT,
  COMPACT_LAYOUT_WIDTH,
  clampTuiScroll,
  createSetupTuiTheme,
  diffLineColor,
  HORIZONTAL_PANE_MIN_WIDTH,
  manualContentLineCount,
  manualRecommendationLines,
  manualRecommendationSteps,
  manualRecommendationViewport,
  normalizeTuiDiffLine,
  renderSetupCheckSummary,
  renderSetupHealthReport,
  saveSetupCheckReports,
  selectedSetupOptions,
  selectionIndicator,
  selectionRowPresentation,
  setupCheckDetails,
  setupCheckResultOutput,
  setupPaneLayout,
  setupStepIndex,
  supportsTui,
  tuiLayoutMetrics,
};
