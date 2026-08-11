import path from "node:path";
import type { FileChange, InstallPlan, InstallProgress, RepositoryContext } from "../core/types.js";
import { createDiagnosticLogger, type DiagnosticLogger } from "../cli/options.js";
import { DEFAULT_COMMAND_TIMEOUT_MS, runCommand } from "../runners/command-runner.js";
import { contentHash, readOptional, restoreChanges, validateChanges, writeChanges } from "./file-plan.js";

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];

async function snapshotInstallState(context: RepositoryContext, planned: FileChange[]): Promise<FileChange[]> {
  const plannedPaths = new Set(planned.map((change) => change.path));
  const snapshots = [...planned];
  for (const file of LOCKFILES) {
    if (plannedPaths.has(file)) continue;
    const before = await readOptional(path.join(context.root, file));
    snapshots.push({
      path: file,
      kind: before === null ? "create" : "modify",
      before,
      after: before ?? "",
      expectedHash: contentHash(before),
      reason: "Rollback package-manager install state if setup fails",
    });
  }
  return snapshots;
}

export async function applyInstallPlan(
  context: RepositoryContext,
  plan: InstallPlan,
  diagnostics: DiagnosticLogger | boolean = false,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> {
  const logger = typeof diagnostics === "boolean" ? createDiagnosticLogger({ verbose: diagnostics }) : diagnostics;
  await validateChanges(context.root, plan.files);
  const rollbackFiles = await snapshotInstallState(context, plan.files);
  await writeChanges(context.root, plan.files);
  onProgress?.({ phase: "writing-files", current: plan.files.length, total: plan.files.length });
  try {
    for (const [index, command] of plan.commands.entries()) {
      onProgress?.({ phase: "running-command", current: index + 1, total: plan.commands.length, label: `${command.command} ${command.args.join(" ")}` });
      const result = await runCommand(command.command, command.args, { cwd: context.root, logger, timeoutMs });
      if (result.spawnError || result.exitCode !== 0) {
        throw new Error(result.spawnError ?? (result.stderr.trim() || `exit ${result.exitCode}`));
      }
    }
    onProgress?.({ phase: "complete" });
  } catch (error) {
    try {
      onProgress?.({ phase: "rollback" });
      await restoreChanges(context.root, rollbackFiles);
    } catch (rollbackError) {
      throw new Error(
        `Package installation failed and setup rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: error },
      );
    }
    throw new Error(
      `Package installation failed; planned files were rolled back: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
