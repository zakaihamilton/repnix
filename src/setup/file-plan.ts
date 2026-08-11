import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileChange } from "../core/types.js";

export function contentHash(content: string | null): string | null {
  return content === null ? null : createHash("sha256").update(content).digest("hex");
}

export async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function fileChange(
  relativePath: string,
  before: string | null,
  after: string,
  reason: string,
): FileChange | null {
  if (before === after) return null;
  return {
    path: relativePath,
    kind: before === null ? "create" : "modify",
    before,
    after,
    expectedHash: contentHash(before),
    reason,
  };
}

export async function validateChanges(root: string, changes: FileChange[]): Promise<void> {
  for (const change of changes) {
    const current = await readOptional(path.join(root, change.path));
    if (contentHash(current) !== change.expectedHash) {
      throw new Error(`Planned file changed after preview: ${change.path}. Run setup again.`);
    }
  }
}

export async function writeChanges(root: string, changes: FileChange[]): Promise<void> {
  const written: FileChange[] = [];
  try {
    for (const change of changes) {
      const target = path.join(root, change.path);
      await mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.repnix-${process.pid}-${Date.now()}.tmp`;
      await writeFile(temporary, change.after, "utf8");
      await rename(temporary, target);
      written.push(change);
    }
  } catch (error) {
    try {
      await restoreChanges(root, written);
    } catch (rollbackError) {
      throw new Error(`Could not apply setup changes and rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`, { cause: error });
    }
    throw error;
  }
}

export async function restoreChanges(root: string, changes: FileChange[]): Promise<void> {
  for (const change of [...changes].reverse()) {
    const target = path.join(root, change.path);
    if (change.before === null) {
      try {
        await unlink(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.repnix-rollback-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, change.before, "utf8");
    await rename(temporary, target);
  }
}

export function renderFileDiff(change: FileChange): string {
  const lines = [`--- ${change.before === null ? "/dev/null" : change.path}`, `+++ ${change.path}`];
  if (change.before !== null) {
    for (const line of change.before.trimEnd().split("\n")) lines.push(`- ${line}`);
  }
  for (const line of change.after.trimEnd().split("\n")) lines.push(`+ ${line}`);
  return lines.join("\n");
}
