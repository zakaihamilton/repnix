import React, { useEffect, useMemo, useRef, useState } from "react";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Box, Newline, Text, render, useApp, useInput, useStdout } from "ink";
import type { DiagnosticLogger, DiagnosticOptions } from "../cli/options.js";
import { resolveDiagnosticLogger } from "../cli/options.js";
import { auditRepository } from "../cli/audit.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import type { HealthFinding, HealthRun, InstallPlan, RepositoryDiagnostic } from "../core/types.js";
import { runCommand, type CommandResult } from "../runners/command-runner.js";
import { applyInstallPlan } from "../setup/apply-plan.js";
import { buildInstallPlan } from "../setup/install-plan.js";
import { renderFileDiff } from "../setup/file-plan.js";
import { createSetupTuiModel, selectionItems, setupTuiReducer, type SetupTuiModel } from "./setup-state.js";
import { auditContentLineCount, auditPageSummary, auditRecommendationSummary, auditSetupOptions, auditStatusPresentation, manualContentLineCount, manualRecommendationLines, manualRecommendationSteps, manualRecommendationViewport, selectedSetupOptions, setupCheckDetails } from "./setup-helpers.js";
import { createSetupTuiTheme, diffLineColor, normalizeTuiDiffLine, selectionIndicator, selectionRowPresentation, setupPaneLayout, setupStepIndex, tuiLayoutMetrics, clampTuiScroll } from "./setup-theme.js";
import { Footer, Header, Panel, progressMessage } from "./setup-components.js";
import { ApplyView, AuditView, CheckDetailsView, ConfirmView, DetailsView, ManualRecommendationsView, ReviewView, SelectView, auditUsesSingleColumn, AUDIT_LABEL_COLUMN_WIDTH, AUDIT_TWO_COLUMN_MIN_WIDTH, setupCheckActions, setupCheckCommand, setupCheckOutputLines, setupCheckRows } from "./setup-views.js";

export interface SetupTuiDependencies {
  audit: typeof auditRepository;
  buildPlan: typeof buildInstallPlan;
  applyPlan: typeof applyInstallPlan;
  runCheck: (root: string, logger: DiagnosticLogger, timeoutMs?: number, onProgress?: (message: string) => void) => Promise<CommandResult>;
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

async function runSetupCheck(root: string, logger: DiagnosticLogger, timeoutMs?: number, onProgress?: (message: string) => void): Promise<CommandResult> {
  let pendingDiagnostics = "";
  const onOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
    if (stream !== "stderr") return;
    pendingDiagnostics += chunk.toString();
    const lines = pendingDiagnostics.split("\n");
    pendingDiagnostics = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { event?: string; message?: string };
        if (event.event === "health.provider.start" || event.event === "health.provider.finish") onProgress?.(event.message ?? "Check progress updated");
      } catch {
        // Diagnostics are optional; the final JSON report remains authoritative.
      }
    }
  };
  const commandOptions = { cwd: root, logger, onOutput, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
  const localCommand = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "repnix.cmd" : "repnix");
  const args = ["check", "--format", "json", "--log-format", "json", "--log-level", "info"];
  const localResult = await runCommand(localCommand, args, commandOptions);
  return localResult.spawnError ? runCommand("repnix", args, commandOptions) : localResult;
}

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

function parseSetupHealthRun(output: string): HealthRun | undefined {
  try {
    const parsed: unknown = JSON.parse(output);
    return parsed && typeof parsed === "object" && "results" in parsed && Array.isArray((parsed as { results?: unknown }).results)
      ? parsed as HealthRun
      : undefined;
  } catch {
    return undefined;
  }
}

function findingLocation(finding: HealthFinding): string | undefined {
  return finding.file ? `${finding.file}${finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ""}` : ""}` : undefined;
}

function findingMetadata(finding: HealthFinding): string | undefined {
  if (!finding.metadata || Object.keys(finding.metadata).length === 0) return undefined;
  return JSON.stringify(finding.metadata, null, 2).replaceAll("```", "``\\`");
}

function appendCheckResultsTable(lines: string[], rows: ReturnType<typeof setupCheckRows>): void {
  lines.push("| Status | Check | Result | Provider |", "| --- | --- | --- | --- |");
  for (const row of rows) lines.push(`| ${checkStatusLabelForFile(row.status)} | ${markdownCell(row.category)} | ${markdownCell(row.result)} | ${markdownCell(row.providers)} |`);
}

export function renderSetupHealthReport(output: string): string {
  const run = parseSetupHealthRun(output);
  if (!run) return ["# RepNix health report", "", "The health check did not produce structured results, so RepNix could not create an AI-ready report.", "", "Run `repnix check` again and include its output when asking for help.", ""].join("\n");
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
    lines.push("", `### ${resultIndex + 1}. ${markdownCell(category)} — ${markdownCell(result.name)}`, "", `- Status: ${checkStatusLabelForFile(result.status)}`, `- Run: \`${markdownCode(command)}\``, `- Findings: ${result.findings.length}`);
    if (result.message) lines.push(`- Check message: ${markdownCell(result.message)}`);
    if (result.scope) lines.push(`- Scope: ${markdownCode(result.scope)}`);
    result.findings.forEach((finding, findingIndex) => {
      lines.push("", `#### Finding ${findingIndex + 1}: ${markdownCell(finding.title ?? finding.ruleId ?? finding.type)}`, "", `- Severity: ${finding.severity}`, `- Message: ${markdownCell(finding.message)}`);
      const location = findingLocation(finding);
      if (location) lines.push(`- Location: \`${markdownCode(location)}\``);
      if (finding.ruleId) lines.push(`- Rule: \`${markdownCode(finding.ruleId)}\``);
      if (finding.remediation) lines.push(`- Suggested remediation: ${markdownCell(finding.remediation)}`);
      if (finding.documentationUrl) lines.push(`- Documentation: ${finding.documentationUrl}`);
      if (finding.baselineState) lines.push(`- Baseline: ${finding.baselineState}`);
      const metadata = findingMetadata(finding);
      if (metadata) lines.push("", "<details>", "<summary>Tool context</summary>", "", "```json", metadata, "```", "", "</details>");
    });
  });
  lines.push("", "## Verify", "", "```sh", "repnix check", "```", "");
  return lines.join("\n");
}

export function renderSetupCheckSummary(output: string): string {
  const rows = setupCheckRows(output);
  const actions = setupCheckActions(output);
  const lines = [
    "# Check results",
    "",
    "## Summary",
    "",
  ];
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

function checkStatusLabelForFile(status: "pass" | "warn" | "fail" | "error" | "skipped"): string {
  return status === "pass" ? "PASS" : status === "error" ? "ERROR" : status === "skipped" ? "SKIP" : "WARN";
}

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

const defaultDependencies: SetupTuiDependencies = { audit: auditRepository, buildPlan: buildInstallPlan, applyPlan: applyInstallPlan, runCheck: runSetupCheck };

export function SetupApp({ options, logger, dependencies = {}, result }: SetupTuiProps): React.ReactElement {
  const deps = { ...defaultDependencies, ...dependencies };
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [audit, setAudit] = useState<AuditModel>();
  const [plan, setPlan] = useState<InstallPlan>();
  const [model, setModel] = useState<SetupTuiModel>({ screen: "loading", cursor: 0, auditScroll: 0, manualScroll: 0, reviewCursor: 0, detailScroll: 0, confirmFocus: "cancel", selectedProviders: [], includeCi: false, sidebarCollapsed: false });
  const [dimensions, setDimensions] = useState({ width: stdout.columns ?? 100, height: stdout.rows ?? 24 });
  const startedApply = useRef(false);
  const startedCheck = useRef(false);
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
        dispatch({ type: "fail", message: setupDetectionErrorMessage(nextAudit.context.diagnostics) });
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
    if (model.screen !== "checking" || !audit || startedCheck.current) return;
    startedCheck.current = true;
    void deps.runCheck(audit.context.root, logger, options.timeout === undefined ? undefined : options.timeout * 1000, (message) => dispatch({ type: "check-progress", message })).then((check) => {
      const output = [check.stdout.trimEnd(), check.spawnError ? `Error: ${check.spawnError}` : ""].filter(Boolean).join("\n");
      return saveSetupCheckReports(audit.context.root, check.stdout).then((saved) => dispatch({ type: "check-complete", output, exitCode: check.exitCode, ...(saved ? saved : {}) }));
    }).catch((error: unknown) => dispatch({ type: "check-complete", output: `Error: ${error instanceof Error ? error.message : String(error)}`, exitCode: null }));
  }, [model.screen]);

  useEffect(() => {
    if (model.screen === "success") startedCheck.current = false;
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
  const checkLineCount = setupCheckOutputLines(model.checkOutput ?? "", width).length;
  const busy = model.screen === "loading" || model.screen === "planning" || model.screen === "applying" || model.screen === "checking";
  const leave = () => { result.code = model.screen === "error" ? 2 : 0; exit(); };

  useInput((input, key) => {
    if (input === "\u0003" || (key.ctrl && input === "c")) { if (!busy) leave(); return; }
    if (input === "q") { if (!busy) leave(); return; }
    if (key.escape || key.backspace || key.delete) {
      if (busy) return;
      if (model.screen === "details") dispatch({ type: "close-details" });
      else if (model.screen === "check-details") dispatch({ type: "back-to-success" });
      else if (model.screen === "manual") dispatch({ type: "back-to-audit" });
      else if (model.screen === "confirm") dispatch({ type: "cancel-confirm" });
      else if (model.screen === "review") dispatch({ type: "back-to-select" });
      else if (model.screen === "select") dispatch({ type: "back-to-audit" });
      else leave();
      return;
    }
    if (model.screen === "loading" || model.screen === "planning" || model.screen === "applying" || model.screen === "checking") return;
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
    if (model.screen === "success") { dispatch({ type: "begin-check" }); return; }
    if (model.screen === "empty" || model.screen === "error") { result.code = model.screen === "error" ? 2 : 0; exit(); return; }
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
    if (model.screen === "check-details") {
      if (key.upArrow || input === "k") dispatch({ type: "move-check", direction: "up", lineCount: checkLineCount, viewport: layout.detailViewport });
      else if (key.downArrow || input === "j") dispatch({ type: "move-check", direction: "down", lineCount: checkLineCount, viewport: layout.detailViewport });
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
      {model.screen === "confirm" && audit && plan ? <ConfirmView audit={audit} plan={plan} model={model} theme={theme} /> : null}
      {model.screen === "applying" && plan ? <ApplyView plan={plan} model={model} theme={theme} /> : null}
      {model.screen === "checking" ? <Panel title="Running check" theme={theme} borderColor={theme.info}><Text color={theme.info} bold>◌ Running repository health checks</Text><Text color={theme.muted}>Checks may run in parallel. Completed results will appear when all checks finish.</Text><Newline /><Text color={theme.secondary} bold>LIVE ACTIVITY</Text>{(model.checkProgress ?? ["Preparing configured checks…"]).map((message, index, entries) => <Text key={`${index}-${message}`} color={index === entries.length - 1 ? theme.primary : theme.muted}>{index === entries.length - 1 ? "◌" : "✓"} {message}</Text>)}</Panel> : null}
      {model.screen === "success" ? <Panel title="Setup complete" theme={theme} borderColor={theme.success}><Text color={theme.success}>● Repository health setup completed successfully.</Text><Newline /><Text>{model.progress}</Text><Text color={theme.primary} bold>Press Enter to run `repnix check` now.</Text><Text color={theme.muted}>Run a category with --details later when you need more context.</Text></Panel> : null}
      {model.screen === "check-details" ? <CheckDetailsView model={model} width={width} layout={layout} theme={theme} /> : null}
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
export { AUDIT_LABEL_COLUMN_WIDTH, AUDIT_TWO_COLUMN_MIN_WIDTH, auditUsesSingleColumn };
export { setupCheckActions, setupCheckOutputLines, setupCheckRows } from "./setup-views.js";
export { COMPACT_LAYOUT_HEIGHT, COMPACT_LAYOUT_WIDTH, HORIZONTAL_PANE_MIN_WIDTH } from "./setup-theme.js";
