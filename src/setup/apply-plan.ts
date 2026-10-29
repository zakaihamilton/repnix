import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import type { FileChange, InstallPlan, InstallProgress, RepositoryContext } from "../core/types.js";
import { createDiagnosticLogger, type DiagnosticLogger } from "../cli/options.js";
import { DEFAULT_COMMAND_TIMEOUT_MS, runCommand } from "../runners/command-runner.js";
import {
  contentHash,
  readFileMetadata,
  type FileMetadata,
  readOptional,
  removeCreatedDirectories,
  restoreBinaryFile,
  restoreChanges,
  validateChanges,
  writeChanges,
} from "./file-plan.js";

const TEXT_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"];
const BINARY_LOCKFILES = ["bun.lockb"];
const MANAGER_LOCKFILES = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  bun: ["bun.lock", "bun.lockb"],
} as const;

interface InstallStateSnapshot {
  files: FileChange[];
  binaryFiles: Array<{ path: string; before: Buffer | null }>;
  metadata: Map<string, FileMetadata | null>;
}

async function readOptionalBuffer(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function snapshotInstallState(
  context: RepositoryContext,
  planned: FileChange[],
  hasCommands: boolean,
): Promise<InstallStateSnapshot> {
  const plannedPaths = new Set(planned.map((change) => change.path));
  const files = [...planned];
  const binaryFiles: InstallStateSnapshot["binaryFiles"] = [];
  const selectedLockfiles: readonly string[] = context.packageManager
    ? MANAGER_LOCKFILES[context.packageManager]
    : [...TEXT_LOCKFILES, ...BINARY_LOCKFILES];
  async function skipUnrelatedSymlink(file: string): Promise<boolean> {
    if (selectedLockfiles.includes(file)) return false;
    try {
      return (await lstat(path.join(context.root, file))).isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  for (const file of hasCommands ? TEXT_LOCKFILES : []) {
    if (plannedPaths.has(file)) continue;
    if (await skipUnrelatedSymlink(file)) continue;
    await readFileMetadata(context.root, file);
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
  for (const file of hasCommands ? BINARY_LOCKFILES : []) {
    if (plannedPaths.has(file)) continue;
    if (await skipUnrelatedSymlink(file)) continue;
    await readFileMetadata(context.root, file);
    binaryFiles.push({ path: file, before: await readOptionalBuffer(path.join(context.root, file)) });
  }
  const metadata = new Map<string, FileMetadata | null>();
  for (const file of [...files, ...binaryFiles]) {
    metadata.set(file.path, await readFileMetadata(context.root, file.path));
  }
  return { files, binaryFiles, metadata };
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
  const rollbackFiles = await snapshotInstallState(context, plan.files, plan.commands.length > 0);
  if (!plan.files.length) onProgress?.({ phase: "writing-files", current: 0, total: 0 });
  const createdDirectories = await writeChanges(context.root, plan.files, (change, current, total) => {
    onProgress?.({
      phase: "writing-files",
      current,
      total,
      label: `${change.kind === "create" ? "Created" : "Updated"} ${change.path}`,
    });
  });
  try {
    for (const [index, command] of plan.commands.entries()) {
      onProgress?.({
        phase: "running-command",
        current: index + 1,
        total: plan.commands.length,
        label: `${command.command} ${command.args.join(" ")}`,
      });
      const result = await runCommand(command.command, command.args, { cwd: context.root, logger, timeoutMs });
      if (result.spawnError || result.exitCode !== 0) {
        const output = [result.stderr, result.stdout].map((value) => value.trim()).find(Boolean);
        const invocation = [command.command, ...command.args].map((part) => JSON.stringify(part)).join(" ");
        throw new Error(
          result.spawnError ??
            output ??
            `Command ${invocation} exited with code ${result.exitCode ?? "unknown"} without producing output.`,
        );
      }
    }
    onProgress?.({ phase: "complete" });
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try {
      onProgress?.({ phase: "rollback" });
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    try {
      await restoreChanges(context.root, rollbackFiles.files, rollbackFiles.metadata);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    for (const file of rollbackFiles.binaryFiles) {
      try {
        await restoreBinaryFile(context.root, file.path, file.before, rollbackFiles.metadata.get(file.path));
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await removeCreatedDirectories(context.root, createdDirectories);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length) {
      throw new Error(
        `Package installation failed and setup rollback also failed: ${rollbackErrors.map(String).join("; ")}`,
        { cause: error },
      );
    }
    throw new Error(
      `Package installation failed; planned files were rolled back: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
