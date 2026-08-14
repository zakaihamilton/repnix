import path from "node:path";
import { readFile } from "node:fs/promises";
import type { FileChange, InstallPlan, InstallProgress, RepositoryContext } from "../core/types.js";
import { createDiagnosticLogger, type DiagnosticLogger } from "../cli/options.js";
import { DEFAULT_COMMAND_TIMEOUT_MS, runCommand } from "../runners/command-runner.js";
import { contentHash, readOptional, restoreBinaryFile, restoreChanges, validateChanges, writeChanges } from "./file-plan.js";

const TEXT_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"];
const BINARY_LOCKFILES = ["bun.lockb"];

interface InstallStateSnapshot {
  files: FileChange[];
  binaryFiles: Array<{ path: string; before: Buffer | null }>;
}

async function readOptionalBuffer(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function snapshotInstallState(context: RepositoryContext, planned: FileChange[]): Promise<InstallStateSnapshot> {
  const plannedPaths = new Set(planned.map((change) => change.path));
  const files = [...planned];
  const binaryFiles: InstallStateSnapshot["binaryFiles"] = [];
  for (const file of TEXT_LOCKFILES) {
    if (plannedPaths.has(file)) continue;
    const before = await readOptional(path.join(context.root, file));
    files.push({
      path: file,
      kind: before === null ? "create" : "modify",
      before,
      after: before ?? "",
      expectedHash: contentHash(before),
      reason: "Rollback package-manager install state if setup fails",
    });
  }
  for (const file of BINARY_LOCKFILES) {
    if (plannedPaths.has(file)) continue;
    binaryFiles.push({ path: file, before: await readOptionalBuffer(path.join(context.root, file)) });
  }
  return { files, binaryFiles };
}

export async function applyInstallPlan(
  context: RepositoryContext,
  plan: InstallPlan,
  diagnostics: DiagnosticLogger | boolean = false,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  onProgress?: (progress: InstallProgress) => void,
): Promise<void> {
  const logger = typeof diagnostics === "boolean" ? createDiagnosticLogger({ verbose: diagnostics }) : diagnostics;
  onProgress?.({ phase: "validating", current: 0, total: plan.files.length });
  await validateChanges(context.root, plan.files);
  onProgress?.({ phase: "snapshotting", current: 0, total: plan.files.length });
  const rollbackFiles = await snapshotInstallState(context, plan.files);
  if (!plan.files.length) onProgress?.({ phase: "writing-files", current: 0, total: 0 });
  await writeChanges(context.root, plan.files, (change, current, total) => {
    onProgress?.({ phase: "writing-files", current, total, label: `${change.kind === "create" ? "Created" : "Updated"} ${change.path}` });
  });
  try {
    for (const [index, command] of plan.commands.entries()) {
      onProgress?.({ phase: "running-command", current: index + 1, total: plan.commands.length, label: `${command.command} ${command.args.join(" ")}` });
      const result = await runCommand(command.command, command.args, { cwd: context.root, logger, timeoutMs });
      if (result.spawnError || result.exitCode !== 0) {
        const output = [result.stderr, result.stdout].map((value) => value.trim()).find(Boolean);
        const invocation = [command.command, ...command.args].map((part) => JSON.stringify(part)).join(" ");
        throw new Error(result.spawnError ?? output ?? `Command ${invocation} exited with code ${result.exitCode ?? "unknown"} without producing output.`);
      }
    }
    onProgress?.({ phase: "complete" });
  } catch (error) {
    try {
      onProgress?.({ phase: "rollback" });
      await restoreChanges(context.root, rollbackFiles.files);
      for (const file of rollbackFiles.binaryFiles) {
        await restoreBinaryFile(context.root, file.path, file.before);
      }
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
