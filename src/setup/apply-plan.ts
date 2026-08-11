import type { InstallPlan, RepositoryContext } from "../core/types.js";
import { createDiagnosticLogger, type DiagnosticLogger } from "../cli/options.js";
import { runCommand } from "../runners/command-runner.js";
import { validateChanges, writeChanges } from "./file-plan.js";

export async function applyInstallPlan(
  context: RepositoryContext,
  plan: InstallPlan,
  diagnostics: DiagnosticLogger | boolean = false,
): Promise<void> {
  const logger = typeof diagnostics === "boolean" ? createDiagnosticLogger({ verbose: diagnostics }) : diagnostics;
  await validateChanges(context.root, plan.files);
  await writeChanges(context.root, plan.files);
  for (const command of plan.commands) {
    const result = await runCommand(command.command, command.args, { cwd: context.root, logger });
    if (result.spawnError || result.exitCode !== 0) {
      throw new Error(
        `Files were updated, but package installation failed: ${result.spawnError ?? (result.stderr.trim() || `exit ${result.exitCode}`)}`,
      );
    }
  }
}
