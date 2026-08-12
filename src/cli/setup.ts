import { confirm, isCancel, multiselect, note, outro } from "@clack/prompts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { builtinProvider } from "../providers/registry.js";
import { auditRepository } from "./audit.js";
import { renderAudit, wrapTerminalText } from "../reporting/console-reporter.js";
import { applyInstallPlan } from "../setup/apply-plan.js";
import { buildInstallPlan, type SetupProviderId } from "../setup/install-plan.js";
import { renderFileDiff } from "../setup/file-plan.js";
import type { InstallPlan } from "../core/types.js";
import { assertSavedPlanMatches, parseSavedInstallPlan, serializeInstallPlan } from "../setup/saved-plan.js";
import { runSetupTui, supportsTui } from "../tui/setup-app.js";
import { resolveDiagnosticLogger, type DiagnosticOptions } from "./options.js";

export interface SetupOptions extends DiagnosticOptions {
  plan?: boolean;
  applyPlan?: string;
  format?: "text" | "json";
}

function previewWidth(): number | undefined {
  if (!process.stdout.isTTY || !process.stdout.columns || process.stdout.columns <= 0) return undefined;
  // Clack adds padding and a border around notes. Leave room for both so the box never becomes wider than the terminal.
  return Math.max(process.stdout.columns - 8, 20);
}

function renderCommand(command: InstallPlan["commands"][number]): string {
  return `$ ${command.command} ${command.args.join(" ")}`;
}

export function renderSetupPreview(plan: InstallPlan): string {
  const width = previewWidth();
  const lines: string[] = [];
  if (plan.packages.length) {
    lines.push(`Packages to install (${plan.packages.length})`);
    for (const item of plan.packages) lines.push(`  + ${item.name}${item.version ? `@${item.version}` : ""}`);
  }
  if (plan.commands.length) {
    if (lines.length) lines.push("");
    lines.push("Commands");
    for (const command of plan.commands) lines.push(...wrapTerminalText(renderCommand(command), width, "  ", "  "));
  }
  if (plan.files.length) {
    if (lines.length) lines.push("");
    lines.push(`Files (${plan.files.length})`);
    for (const change of plan.files) {
      lines.push(...renderFileDiff(change, width));
      lines.push(...wrapTerminalText(`Purpose: ${change.reason}`, width, "  ", "  "));
    }
  }
  if (plan.warnings.length) {
    if (lines.length) lines.push("");
    lines.push("Warnings");
    for (const warning of plan.warnings) lines.push(...wrapTerminalText(warning, width, "  ! ", "    "));
  }
  if (plan.conflicts.length) {
    if (lines.length) lines.push("");
    lines.push("Preserved conflicts");
    for (const conflict of plan.conflicts) lines.push(...wrapTerminalText(conflict, width, "  ! ", "    "));
  }
  return lines.join("\n");
}

async function setupWithPrompts(options: SetupOptions = {}): Promise<number> {
  const logger = resolveDiagnosticLogger(options);
  const audit = await auditRepository(process.cwd(), { ...options, logger });
  process.stdout.write(`${renderAudit(audit)}\n\n`);
  if (audit.context.diagnostics.some((item) => item.severity === "error")) return 2;
  const setupRecommendations = audit.recommendations.filter((recommendation) => recommendation.actionable);
  if (!setupRecommendations.length) {
    outro("No setup changes are recommended. Your active checks already cover the gaps RepNix found.");
    return 0;
  }
  note(
    "Baseline checks are selected because they cover common gaps for most projects. Optional checks need project-specific rules or budgets, so review their explanation before selecting them.",
    "How to choose checks",
  );
  const selected = await multiselect({
    message: "Choose the checks to add (Space selects, Enter confirms)",
    options: setupRecommendations.map((recommendation) => ({
      value: recommendation.provider,
      label: `${recommendation.name} — ${builtinProvider(recommendation.provider)?.description ?? recommendation.reason}`,
    })),
    initialValues: setupRecommendations.filter((recommendation) => recommendation.priority === "baseline").map((recommendation) => recommendation.provider),
    required: false,
  });
  if (isCancel(selected)) return 0;
  const includeCi = audit.context.hasCI
    ? await confirm({ message: "Add repository health to an obvious GitHub Actions job?", initialValue: false })
    : false;
  if (isCancel(includeCi)) return 0;
  const plan = await buildInstallPlan(audit.context, selected as SetupProviderId[], includeCi, audit.registry);
  if (!plan.commands.length && !plan.files.length && !plan.warnings.length && !plan.conflicts.length) {
    outro("No setup changes are needed for the checks you selected.");
    return 0;
  }
  note(
    "Review this preview carefully. RepNix may install development packages, add package scripts, create configuration files, and optionally add a GitHub Actions step. Existing conflicting files and scripts are shown instead of overwritten.",
    "What will change",
  );
  const preview = renderSetupPreview(plan);
  note(preview || "No changes", "Planned changes");
  const apply = await confirm({ message: "Apply these reviewed changes?", initialValue: false });
  if (isCancel(apply) || !apply) return 0;
  await applyInstallPlan(audit.context, plan, logger, options.timeout === undefined ? undefined : options.timeout * 1000);
  const after = await auditRepository(process.cwd(), { ...options, logger });
  const beforeCovered = audit.coverage.filter((entry) => entry.status === "covered").length;
  const gained = Math.max(after.coverage.filter((entry) => entry.status === "covered").length - beforeCovered, 0);
  outro(pc.green(`Repository health setup complete${gained ? ` with ${gained} newly covered categor${gained === 1 ? "y" : "ies"}` : ""}. Run \`repnix check\` to verify the checks; add a category and \`--details\` only when troubleshooting.`));
  return 0;
}

async function createDefaultPlan(options: SetupOptions): Promise<{ audit: Awaited<ReturnType<typeof auditRepository>>; plan: InstallPlan; selected: SetupProviderId[] }> {
  const audit = await auditRepository(process.cwd(), options);
  const selected = audit.recommendations
    .filter((recommendation) => recommendation.actionable && recommendation.priority === "baseline")
    .map((recommendation) => recommendation.provider as SetupProviderId);
  return { audit, plan: await buildInstallPlan(audit.context, selected, false), selected };
}

export async function setupCommand(options: SetupOptions = {}): Promise<number> {
  if (options.format && !["text", "json"].includes(options.format)) throw new Error(`Unknown setup format '${options.format}'. Use text or json.`);
  if (options.plan && options.applyPlan) throw new Error("Use either --plan or --apply-plan, not both.");
  if (options.plan) {
    const { audit, plan, selected } = await createDefaultPlan(options);
    const saved = serializeInstallPlan(plan, { providers: selected, includeCi: false });
    process.stdout.write(options.format === "json" ? `${JSON.stringify(saved, null, 2)}\n` : `${renderSetupPreview(plan) || "No setup changes are needed."}\n`);
    return audit.context.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 2 : 0;
  }
  if (options.applyPlan) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Applying a saved setup plan requires an interactive terminal for confirmation.");
    const raw: unknown = JSON.parse(await readFile(path.resolve(options.applyPlan), "utf8"));
    const saved = parseSavedInstallPlan(raw);
    const audit = await auditRepository(process.cwd(), options);
    if (saved.selection.providers.some((provider) => !audit.registry?.get(provider))) {
      throw new Error("Saved setup plan selects a provider that is not available in this repository. Generate a new plan before applying it.");
    }
    const plan = await buildInstallPlan(audit.context, saved.selection.providers, saved.selection.includeCi, audit.registry);
    assertSavedPlanMatches(saved, plan);
    note(renderSetupPreview(plan), "Saved setup plan");
    const apply = await confirm({ message: "Apply this saved and revalidated setup plan?", initialValue: false });
    if (isCancel(apply) || !apply) return 0;
    await applyInstallPlan(audit.context, plan, resolveDiagnosticLogger(options), options.timeout === undefined ? undefined : options.timeout * 1000);
    outro(pc.green("Repository health setup complete. Run `repnix check` to verify the checks; add a category and `--details` only when troubleshooting."));
    return 0;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("repnix setup is interactive. Use `repnix setup --plan --format json` for a read-only non-interactive plan.\n");
    return 2;
  }
  return supportsTui() ? runSetupTui(options) : setupWithPrompts(options);
}
