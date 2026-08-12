import { access } from "node:fs/promises";
import path from "node:path";
import type { DiagnosticLogger } from "../../cli/options.js";
import type { RepositoryContext } from "../../core/types.js";
import { runCommand } from "../command-runner.js";
import { HEALTH_OFFLINE_ENV, outputExcerpt } from "./task-executor.js";

export function parseJsonOutput(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim()) as unknown;
  } catch {
    for (const line of stdout.trim().split("\n").reverse()) {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        // Keep looking for a machine-readable line.
      }
    }
    throw new Error("Provider did not emit valid JSON.");
  }
}

export interface PackedPackage {
  tarball?: string;
  durationMs: number;
  error?: string;
}

export async function packLocalPackage(context: RepositoryContext, temporary: string, logger: DiagnosticLogger, timeoutMs?: number): Promise<PackedPackage> {
  const result = await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary, "."], {
    cwd: context.root,
    logger,
    env: { ...HEALTH_OFFLINE_ENV, npm_config_cache: path.join(temporary, "npm-cache"), npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false" },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  if (result.spawnError || result.exitCode !== 0) return { durationMs: result.durationMs, error: `The package could not be packed locally with lifecycle scripts disabled. ${result.spawnError ?? outputExcerpt(result)}`.trim() };
  try {
    const report = parseJsonOutput(result.stdout);
    if (!Array.isArray(report) || !report[0] || typeof report[0] !== "object") throw new Error("npm pack returned an unsupported report.");
    const filename = (report[0] as Record<string, unknown>).filename;
    if (typeof filename !== "string" || path.basename(filename) !== filename) throw new Error("npm pack returned an unsafe tarball name.");
    const tarball = path.join(temporary, filename);
    await access(tarball);
    return { tarball, durationMs: result.durationMs };
  } catch (error) {
    return { durationMs: result.durationMs, error: error instanceof Error ? error.message : String(error) };
  }
}
