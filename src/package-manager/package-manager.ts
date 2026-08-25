import type { PackageManagerId, PlannedCommand } from "../core/types.js";

export function installDevCommand(manager: PackageManagerId, packages: string[]): PlannedCommand {
  const argsByManager: Record<PackageManagerId, string[]> = {
    npm: ["install", "--save-dev", ...packages],
    pnpm: ["add", "-D", ...packages],
    yarn: ["add", "-D", ...packages],
    bun: ["add", "-d", ...packages],
  };
  return { command: manager, args: argsByManager[manager], reason: "Install selected health providers" };
}

export function execCommand(
  manager: PackageManagerId,
  binary: string,
  args: string[],
): { command: string; args: string[] } {
  const prefixes: Record<PackageManagerId, string[]> = {
    npm: ["exec", "--", binary],
    pnpm: ["exec", binary],
    yarn: ["exec", binary],
    bun: ["x", binary],
  };
  return { command: manager, args: [...prefixes[manager], ...args] };
}

export function runScriptCommand(manager: PackageManagerId, script: string): { command: string; args: string[] } {
  return { command: manager, args: ["run", script] };
}
