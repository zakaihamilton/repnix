import path from "node:path";
import type { FileChange, InstallPlan, RepositoryContext } from "../core/types.js";
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
): Promise<void> {
  const logger = typeof diagnostics === "boolean" ? createDiagnosticLogger({ verbose: diagnostics }) : diagnostics;
  await validateChanges(context.root, plan.files);
  const rollbackFiles = await snapshotInstallState(context, plan.files);
  await writeChanges(context.root, plan.files);
  try {
    for (const command of plan.commands) {
      const result = await runCommand(command.command, command.args, { cwd: context.root, logger, timeoutMs });
      if (result.spawnError || result.exitCode !== 0) {
        throw new Error(result.spawnError ?? (result.stderr.trim() || `exit ${result.exitCode}`));
      }
    }
  } catch (error) {
    try {
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
