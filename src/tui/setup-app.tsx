import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Newline, Text, render, useApp, useInput, useStdout } from "ink";
import { PROVIDER_DESCRIPTIONS } from "../core/health-category.js";
import type { DiagnosticLogger, DiagnosticOptions } from "../cli/options.js";
import { resolveDiagnosticLogger } from "../cli/options.js";
import { auditRepository } from "../cli/audit.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import type { InstallPlan, InstallProgress } from "../core/types.js";
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

const colors = {
  accent: "cyan",
  accent2: "magenta",
  success: "green",
  warning: "yellow",
  error: "red",
  muted: "gray",
} as const;

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

function Panel({ title, children, flexGrow = 1, flexShrink, width }: { title: string; children: React.ReactNode; flexGrow?: number; flexShrink?: number; width?: string | number }): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor={colors.muted} flexDirection="column" paddingX={1} flexGrow={flexGrow} flexShrink={flexShrink} width={width}>
      <Text bold color={colors.accent}>{` ${title} `}</Text>
      {children}
    </Box>
  );
}

function Header({ model, repositoryName, packageManager }: { model: SetupTuiModel; repositoryName: string; packageManager: string | null }): React.ReactElement {
  const steps = ["Select checks", "Review changes", "Apply safely"];
  const active = model.screen === "loading" || model.screen === "empty" || model.screen === "select" || model.screen === "planning" ? 0 : model.screen === "review" || model.screen === "details" || model.screen === "confirm" ? 1 : 2;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box justifyContent="space-between">
        <Text bold color={colors.accent2}>RepNix <Text color={colors.muted}>/ Setup</Text></Text>
        <Text color={colors.muted}>{repositoryName} · {packageManager ?? "package manager unresolved"}</Text>
      </Box>
      <Box marginTop={1}>
        {steps.map((step, index) => (
          <Box key={step} marginRight={2}>
            <Text color={index === active ? colors.accent : colors.muted} bold={index === active}>
              {index < active ? "✓ " : index === active ? "● " : "○ "}{step}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Footer({ model }: { model: SetupTuiModel }): React.ReactElement {
  const keys = model.screen === "select"
    ? "↑↓/jk move   Space toggle   Enter review   q quit"
    : model.screen === "review"
      ? "↑↓ choose file   Enter/d details   a apply   Esc back   q quit"
    : model.screen === "details"
        ? "↑↓ scroll   Esc back   q quit"
        : model.screen === "confirm"
          ? "Enter apply   Esc back   q quit"
        : model.screen === "success" || model.screen === "error"
          ? "Enter/q exit"
          : "Please wait…";
  return (
    <Box borderStyle="single" borderColor={colors.muted} paddingX={1} marginTop={1}>
      <Text color={colors.muted}>{keys}</Text>
    </Box>
  );
}

function providerFor(items: SetupSelectionItem[], model: SetupTuiModel): SetupSelectionItem | undefined {
  return items[model.cursor];
}

function SelectView({ audit, model }: { audit: AuditModel; model: SetupTuiModel }): React.ReactElement {
  const items = selectionItems(audit.recommendations, audit.context.hasCI);
  const selected = providerFor(items, model);
  const recommendation = selected?.kind === "provider" ? audit.recommendations.find((item) => item.provider === selected.provider) : undefined;
  return (
    <Box flexDirection="row" gap={1} flexGrow={1}>
      <Panel title="Recommended checks" width={34} flexGrow={0} flexShrink={0}>
        {items.map((item, index) => {
          const checked = item.kind === "ci" ? model.includeCi : model.selectedProviders.includes(item.provider);
          const active = index === model.cursor;
          const itemRecommendation = item.kind === "provider" ? audit.recommendations.find((entry) => entry.provider === item.provider) : undefined;
          const label = `${active ? "❯ " : "  "}${checked ? "[x]" : "[ ]"} ${item.name}${itemRecommendation ? `  · ${itemRecommendation.priority}` : ""}`;
          return (
            <Text key={item.kind === "ci" ? item.name : item.provider} inverse={active} {...(active ? { color: colors.accent } : {})}>
              {label}
            </Text>
          );
        })}
        {items.length === 0 ? <Text color={colors.success}>No setup changes are recommended.</Text> : null}
      </Panel>
      <Panel title={recommendation ? recommendation.name : selected?.name ?? "Setup overview"}>
        {recommendation ? (
          <>
            <Text color={colors.accent}>{PROVIDER_DESCRIPTIONS[recommendation.name] ?? "Repository health check"}</Text>
            <Newline />
            <Text>{recommendation.reason}</Text>
            {!recommendation.actionable ? <><Newline /><Text color={colors.warning}>Manual configuration required before this check can run.</Text></> : null}
          </>
        ) : selected?.kind === "ci" ? (
          <Text>{audit.context.hasCI ? "Add the unified repository health check to the most obvious GitHub Actions job." : "No GitHub Actions workflow was detected."}</Text>
        ) : (
          <Text color={colors.muted}>Select a check to see why it is recommended and what it will add.</Text>
        )}
      </Panel>
    </Box>
  );
}

function planStats(plan: InstallPlan): string {
  const parts = [] as string[];
  if (plan.packages.length) parts.push(`${plan.packages.length} package${plan.packages.length === 1 ? "" : "s"}`);
  if (plan.files.length) parts.push(`${plan.files.length} file${plan.files.length === 1 ? "" : "s"}`);
  if (plan.warnings.length) parts.push(`${plan.warnings.length} warning${plan.warnings.length === 1 ? "" : "s"}`);
  if (plan.conflicts.length) parts.push(`${plan.conflicts.length} preserved conflict${plan.conflicts.length === 1 ? "" : "s"}`);
  return parts.join(" · ") || "No changes";
}

function ReviewNotes({ plan }: { plan: InstallPlan }): React.ReactElement {
  if (!plan.warnings.length && !plan.conflicts.length) {
    return <Text color={colors.success}>No warnings or conflicts.</Text>;
  }
  return (
    <Box flexDirection="column">
      {plan.warnings.map((warning, index) => <Text key={`warning-${index}`} color={colors.warning}>! Warning: {warning}</Text>)}
      {plan.conflicts.map((conflict, index) => <Text key={`conflict-${index}`} color={colors.warning}>! Preserved: {conflict}</Text>)}
    </Box>
  );
}

function ReviewView({ plan, model }: { plan: InstallPlan; model: SetupTuiModel }): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  return (
    <Box flexDirection="row" gap={1} flexGrow={1}>
      <Panel title="Planned changes" width={34} flexGrow={0} flexShrink={0}>
        <Text color={colors.accent}>{planStats(plan)}</Text>
        <Newline />
        <Text bold>Packages</Text>
        {plan.packages.length ? plan.packages.map((item) => <Text key={item.name}>  + {item.name}{item.version ? `@${item.version}` : ""}</Text>) : <Text color={colors.muted}>  none</Text>}
        <Newline />
        <Text bold>Files</Text>
        {plan.files.length ? plan.files.map((item, index) => <Text key={item.path} inverse={index === model.reviewCursor}>{index === model.reviewCursor ? "❯ " : "  "}{item.kind === "create" ? "A" : "M"} {item.path}</Text>) : <Text color={colors.muted}>  none</Text>}
        {plan.warnings.length ? <><Newline /><Text color={colors.warning}>Warnings: {plan.warnings.length}</Text></> : null}
        {plan.conflicts.length ? <Text color={colors.warning}>Conflicts preserved: {plan.conflicts.length}</Text> : null}
      </Panel>
      <Panel title={file ? `Detail · ${file.path}` : "Review summary"}>
        {file ? (
          <>
            <Text color={colors.muted}>{file.reason}</Text>
            <Newline />
            <Text color={colors.accent}>Press Enter or d to inspect this file.</Text>
          </>
        ) : (
          <Text color={colors.muted}>No file changes are planned. Press Enter to continue.</Text>
        )}
        {plan.commands.length ? <><Newline /><Text bold>Command</Text>{plan.commands.map((command) => <Text key={command.command}>{`  $ ${command.command} ${command.args.join(" ")}`}</Text>)}</> : null}
        <Newline />
        <Text bold>Review notes</Text>
        <ReviewNotes plan={plan} />
      </Panel>
    </Box>
  );
}

function DetailsView({ plan, model, width, height }: { plan: InstallPlan; model: SetupTuiModel; width: number; height: number }): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  if (!file) return <Panel title="Details"><Text color={colors.muted}>There are no file details to show.</Text></Panel>;
  const diff = renderFileDiff(file, Math.max(width - 8, 32)).split("\n");
  const visibleHeight = Math.max(height - 14, 4);
  const visible = diff.slice(model.detailScroll, model.detailScroll + visibleHeight);
  return (
    <Panel title={`File detail · ${file.path}`}>
      <Text color={colors.muted}>{file.reason}</Text>
      <Newline />
      {visible.map((line, index) => <Text key={`${index}-${line}`}>{line}</Text>)}
      {model.detailScroll + visible.length < diff.length ? <Text color={colors.muted}>↓ more</Text> : null}
    </Panel>
  );
}

function ConfirmView({ plan }: { plan: InstallPlan }): React.ReactElement {
  return (
    <Panel title="Confirm setup">
      <Text color={colors.warning} bold>Apply these reviewed changes?</Text>
      <Newline />
      <Text>{planStats(plan)}</Text>
      <Newline />
      <Text bold>Review notes</Text>
      <ReviewNotes plan={plan} />
      <Newline />
      <Text color={colors.muted}>Press Enter to apply, or Esc to return to the review.</Text>
    </Panel>
  );
}

export function SetupApp({ options, logger, dependencies = {}, result }: SetupTuiProps): React.ReactElement {
  const deps = { ...defaultDependencies, ...dependencies };
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [audit, setAudit] = useState<AuditModel>();
  const [plan, setPlan] = useState<InstallPlan>();
  const [model, setModel] = useState<SetupTuiModel>({ screen: "loading", cursor: 0, reviewCursor: 0, detailScroll: 0, selectedProviders: [], includeCi: false });
  const startedApply = useRef(false);

  const dispatch = (action: Parameters<typeof setupTuiReducer>[1]) => setModel((current) => setupTuiReducer(current, action));
  const items = useMemo(() => audit ? selectionItems(audit.recommendations, audit.context.hasCI) : [], [audit]);

  useEffect(() => {
    void deps.audit(process.cwd(), { ...options, logger })
      .then((nextAudit) => {
        setAudit(nextAudit);
        if (nextAudit.context.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
          dispatch({ type: "fail", message: "Repository detection reported an error. Run `repnix audit` for details." });
          return;
        }
        if (!nextAudit.recommendations.some((recommendation) => recommendation.actionable)) {
          setModel((current) => ({ ...current, screen: "empty" }));
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

  const width = stdout.columns ?? 100;
  const height = stdout.rows ?? 24;
  const detailViewport = Math.max(height - 14, 4);
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
    if (key.escape) {
      if (busy) return;
      if (model.screen === "details") dispatch({ type: "close-details" });
      else if (model.screen === "confirm") dispatch({ type: "cancel-confirm" });
      else if (model.screen === "review") dispatch({ type: "back-to-select" });
      else {
        result.code = model.screen === "error" ? 2 : 0;
        exit();
      }
      return;
    }
    if (model.screen === "loading" || model.screen === "planning" || model.screen === "applying") return;
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
      if (key.upArrow || input === "k") dispatch({ type: "move", direction: "up", itemCount: items.length });
      else if (key.downArrow || input === "j") dispatch({ type: "move", direction: "down", itemCount: items.length });
      else if (input === " ") {
        const item = providerFor(items, model);
        if (item) dispatch({ type: "toggle", item });
      }
      else if (key.return) dispatch({ type: "begin-planning" });
      return;
    }
    if (model.screen === "review") {
      if (key.upArrow || input === "k") dispatch({ type: "move-review", direction: "up", fileCount: plan?.files.length ?? 0 });
      else if (key.downArrow || input === "j") dispatch({ type: "move-review", direction: "down", fileCount: plan?.files.length ?? 0 });
      else if (key.return || input === "d") dispatch({ type: "open-details" });
      else if (input === "a") dispatch({ type: "begin-confirm" });
      return;
    }
    if (model.screen === "confirm") {
      if (key.return) dispatch({ type: "begin-applying" });
      return;
    }
    if (model.screen === "details") {
      if (key.upArrow || input === "k") dispatch({ type: "move-detail", direction: "up", lineCount: detailLineCount, viewport: detailViewport });
      else if (key.downArrow || input === "j") dispatch({ type: "move-detail", direction: "down", lineCount: detailLineCount, viewport: detailViewport });
      else if (key.escape) dispatch({ type: "close-details" });
    }
  });

  return (
    <Box flexDirection="column" width="100%" height="100%" paddingX={1}>
      <Header model={model} repositoryName={audit?.context.packageJson.name ?? "repository"} packageManager={audit?.context.packageManager ?? null} />
      {model.screen === "loading" ? <Panel title="Scanning repository"><Text color={colors.accent}>⠋ Detecting checks, project structure, and recommendations…</Text></Panel> : null}
      {model.screen === "empty" ? <Panel title="Nothing to add"><Text color={colors.success}>✓ Your active checks already cover the gaps RepNix found.</Text></Panel> : null}
      {model.screen === "select" && audit ? <SelectView audit={audit} model={model} /> : null}
      {model.screen === "planning" ? <Panel title="Preparing review"><Text color={colors.accent}>⠋ Building a safe setup plan…</Text></Panel> : null}
      {model.screen === "review" && plan ? <ReviewView plan={plan} model={model} /> : null}
      {model.screen === "details" && plan ? <DetailsView plan={plan} model={model} width={width} height={height} /> : null}
      {model.screen === "confirm" && plan ? <ConfirmView plan={plan} /> : null}
      {model.screen === "applying" ? <Panel title="Applying safely"><Text color={colors.accent}>⠋ {model.progress ?? "Installing selected checks and writing reviewed files…"}</Text></Panel> : null}
      {model.screen === "success" ? <Panel title="Setup complete"><Text color={colors.success}>✓ Repository health setup completed successfully.</Text><Newline /><Text>Run `repnix check` to verify the new checks.</Text></Panel> : null}
      {model.screen === "error" ? <Panel title="Setup stopped"><Text color={colors.error}>✗ {model.error ?? "An unexpected error occurred."}</Text><Newline /><Text color={colors.muted}>No further changes will be applied.</Text></Panel> : null}
      <Footer model={model} />
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
