import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(testsDirectory, "..");

export function fixturePath(name: string): string {
  return path.join(projectRoot, "fixtures", name);
}

export async function copyFixture(name: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `repnix-${name}-`));
  await cp(fixturePath(name), directory, { recursive: true });
  return directory;
}
