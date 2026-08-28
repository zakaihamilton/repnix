import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import type { FileChange } from "../core/types.js";

export function contentHash(content: string | null): string | null {
  return content === null ? null : createHash("sha256").update(content).digest("hex");
}

/** Resolve a planned file only when it is a non-root path contained by the repository. */
export function resolveRepositoryPath(root: string, relativePath: string): string {
  const repositoryRoot = path.resolve(root);
  const target = path.resolve(repositoryRoot, relativePath);
  const relative = path.relative(repositoryRoot, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Planned file path must stay inside the repository: ${relativePath}`);
  }
  return target;
}

async function assertNoSymlinkComponents(root: string, target: string): Promise<void> {
  const relative = path.relative(path.resolve(root), target);
  let current = path.resolve(root);
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Planned file path must not traverse a symbolic link: ${relative}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function createSafeParentDirectory(root: string, target: string): Promise<void> {
  const relative = path.relative(path.resolve(root), path.dirname(target));
  let current = path.resolve(root);
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const status = await lstat(current);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new Error(`Planned file path must not traverse a symbolic link: ${relative}`);
    }
  }
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
    const target = resolveRepositoryPath(root, change.path);
    await assertNoSymlinkComponents(root, target);
    const current = await readOptional(target);
    if (contentHash(current) !== change.expectedHash) {
      throw new Error(`Planned file changed after preview: ${change.path}. Run setup again.`);
    }
  }
}

export async function writeChanges(
  root: string,
  changes: FileChange[],
  onWrite?: (change: FileChange, current: number, total: number) => void,
): Promise<void> {
  const written: FileChange[] = [];
  try {
    for (const [index, change] of changes.entries()) {
      const target = resolveRepositoryPath(root, change.path);
      await createSafeParentDirectory(root, target);
      const temporary = `${target}.repnix-${process.pid}-${Date.now()}.tmp`;
      await writeFile(temporary, change.after, "utf8");
      await rename(temporary, target);
      written.push(change);
      onWrite?.(change, index + 1, changes.length);
    }
  } catch (error) {
    try {
      await restoreChanges(root, written);
    } catch (rollbackError) {
      throw new Error(
        `Could not apply setup changes and rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        { cause: rollbackError },
      );
    }
    throw error;
  }
}

export async function restoreChanges(root: string, changes: FileChange[]): Promise<void> {
  for (const change of [...changes].reverse()) {
    const target = resolveRepositoryPath(root, change.path);
    await assertNoSymlinkComponents(root, target);
    if (change.before === null) {
      try {
        await unlink(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      continue;
    }
    await createSafeParentDirectory(root, target);
    const temporary = `${target}.repnix-rollback-${process.pid}-${Date.now()}.tmp`;
    await writeFile(temporary, change.before, "utf8");
    await rename(temporary, target);
  }
}

/** Restore a file without decoding its contents, for binary package-manager state. */
export async function restoreBinaryFile(root: string, relativePath: string, before: Buffer | null): Promise<void> {
  const target = resolveRepositoryPath(root, relativePath);
  await assertNoSymlinkComponents(root, target);
  if (before === null) {
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  await createSafeParentDirectory(root, target);
  const temporary = `${target}.repnix-rollback-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, before);
  await rename(temporary, target);
}

type DiffLine = { kind: "context" | "add" | "remove"; text: string };

const DIFF_CONTEXT_LINES = 2;
const MAX_DIFF_CELLS = 300_000;

function contentLines(content: string | null): string[] {
  if (content === null || content.trimEnd() === "") return [];
  return content.trimEnd().split("\n");
}

function replacementDiff(before: string[], after: string[]): DiffLine[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return [
    ...before.slice(0, prefix).map((text) => ({ kind: "context" as const, text })),
    ...before.slice(prefix, before.length - suffix).map((text) => ({ kind: "remove" as const, text })),
    ...after.slice(prefix, after.length - suffix).map((text) => ({ kind: "add" as const, text })),
    ...before.slice(before.length - suffix).map((text) => ({ kind: "context" as const, text })),
  ];
}

function lineDiff(before: string[], after: string[]): DiffLine[] {
  if (before.length * after.length > MAX_DIFF_CELLS) return replacementDiff(before, after);

  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex]![afterIndex] =
        before[beforeIndex] === after[afterIndex]
          ? table[beforeIndex + 1]![afterIndex + 1]! + 1
          : Math.max(table[beforeIndex + 1]![afterIndex]!, table[beforeIndex]![afterIndex + 1]!);
    }
  }

  const result: DiffLine[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (before[beforeIndex] === after[afterIndex]) {
      result.push({ kind: "context", text: before[beforeIndex]! });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (table[beforeIndex + 1]![afterIndex]! >= table[beforeIndex]![afterIndex + 1]!) {
      result.push({ kind: "remove", text: before[beforeIndex]! });
      beforeIndex += 1;
    } else {
      result.push({ kind: "add", text: after[afterIndex]! });
      afterIndex += 1;
    }
  }
  while (beforeIndex < before.length) result.push({ kind: "remove", text: before[beforeIndex++]! });
  while (afterIndex < after.length) result.push({ kind: "add", text: after[afterIndex++]! });
  return result;
}

function wrapDiffLine(line: DiffLine, width: number | undefined): string[] {
  const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  const color = line.kind === "add" ? pc.green : line.kind === "remove" ? pc.red : pc.dim;
  const firstPrefix = `  ${marker}`;
  const continuationPrefix = "    ↳ ";
  const available = width ? Math.max(width - firstPrefix.length, 1) : undefined;
  if (!available || line.text.length <= available) return [color(`${firstPrefix}${line.text}`)];

  const chunks: string[] = [];
  chunks.push(line.text.slice(0, available));
  const continuationAvailable = width ? Math.max(width - continuationPrefix.length, 1) : available;
  for (let offset = available; offset < line.text.length; offset += continuationAvailable) {
    chunks.push(line.text.slice(offset, offset + continuationAvailable));
  }
  return chunks.map((chunk, index) =>
    index === 0 ? color(`${firstPrefix}${chunk}`) : pc.dim(`${continuationPrefix}${chunk}`),
  );
}

function omittedLines(count: number): string {
  return pc.dim(`  … ${count} unchanged line${count === 1 ? "" : "s"} …`);
}

/** Render a review-sized diff. Large unchanged regions are collapsed and long lines are bounded for prompt boxes. */
export function renderFileDiff(change: FileChange, width?: number): string {
  const before = contentLines(change.before);
  const after = contentLines(change.after);
  const diff = lineDiff(before, after);
  const changed = diff.flatMap((line, index) => (line.kind === "context" ? [] : [index]));
  const additions = diff.filter((line) => line.kind === "add").length;
  const removals = diff.filter((line) => line.kind === "remove").length;
  const kind = change.kind === "create" ? "A" : "M";
  const lines = [`${kind} ${change.path} (+${additions} -${removals})`];
  if (!changed.length) return lines.join("\n");

  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(index - DIFF_CONTEXT_LINES, 0);
    const end = Math.min(index + DIFF_CONTEXT_LINES + 1, diff.length);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }

  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) lines.push(omittedLines(start - cursor));
    lines.push(pc.dim(`  @@ changes near line ${start + 1} @@`));
    for (let index = start; index < end; index += 1) lines.push(...wrapDiffLine(diff[index]!, width));
    cursor = end;
  }
  if (cursor < diff.length) lines.push(omittedLines(diff.length - cursor));
  return lines.join("\n");
}
