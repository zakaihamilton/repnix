import { confirm, isCancel, multiselect, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { auditRepository } from "./audit.js";
import { renderAudit } from "../reporting/console-reporter.js";
import { applyInstallPlan } from "../setup/apply-plan.js";
import { buildInstallPlan, type SetupProviderId } from "../setup/install-plan.js";
import { renderFileDiff } from "../setup/file-plan.js";

export async function setupCommand(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("repnix setup is interactive and requires a TTY. Run repnix audit for a read-only report.\n");
    return 2;
  }
  const audit = await auditRepository();
  process.stdout.write(`${renderAudit(audit)}\n\n`);
  if (audit.context.diagnostics.some((item) => item.severity === "error")) return 2;
  if (!audit.recommendations.length) {
    outro("No setup changes are recommended.");
    return 0;
  }
  const selected = await multiselect({
    message: "Select baseline providers",
    options: audit.recommendations.map((recommendation) => ({
      value: recommendation.provider,
      label: recommendation.name,
      hint: recommendation.reason,
    })),
    initialValues: audit.recommendations.map((recommendation) => recommendation.provider),
    required: false,
  });
  if (isCancel(selected)) return 0;
  const includeCi = audit.context.hasCI
    ? await confirm({ message: "Add repository health to an obvious GitHub Actions job?", initialValue: false })
    : false;
  if (isCancel(includeCi)) return 0;
  const plan = await buildInstallPlan(audit.context, selected as SetupProviderId[], includeCi);
  const preview = [
    ...plan.commands.map((command) => `$ ${command.command} ${command.args.join(" ")}`),
    ...plan.files.map(renderFileDiff),
    ...plan.warnings.map((warning) => `WARNING: ${warning}`),
    ...plan.conflicts.map((conflict) => `CONFLICT: ${conflict}`),
  ].join("\n\n");
  note(preview || "No changes", "Planned changes");
  const apply = await confirm({ message: "Apply changes?", initialValue: false });
  if (isCancel(apply) || !apply) return 0;
  await applyInstallPlan(audit.context, plan);
  outro(pc.green("Repository health setup complete."));
  return 0;
}
