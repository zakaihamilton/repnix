import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BaselineFile, HealthRun } from "../core/types.js";
import { HEALTH_CATEGORIES } from "../core/health-category.js";

const entrySchema = z
  .object({
    fingerprint: z.string().min(1),
    provider: z.string().min(1),
    category: z.enum(HEALTH_CATEGORIES),
    type: z.string().min(1),
    scope: z.string().optional(),
    file: z.string().optional(),
    line: z.number().int().positive().optional(),
  })
  .strict();

const baselineSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string(),
    entries: z.array(entrySchema),
  })
  .strict();

export async function readBaseline(root: string, file: string): Promise<BaselineFile> {
  const baselinePath = path.resolve(root, file);
  try {
    return baselineSchema.parse(JSON.parse(await readFile(baselinePath, "utf8"))) as BaselineFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Configured RepNix baseline does not exist: ${file}. Run 'repnix check --write-baseline' after reviewing current findings.`,
      );
    }
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new Error(
        `Invalid RepNix baseline at ${file}: ${error instanceof z.ZodError ? z.prettifyError(error) : error.message}`,
      );
    }
    throw error;
  }
}

export function baselineFromRun(run: HealthRun): BaselineFile {
  const entries = run.results.flatMap((result) =>
    result.findings.map((finding) => ({
      fingerprint: finding.fingerprint,
      provider: finding.provider,
      category: finding.category,
      type: finding.type,
      ...(finding.scope ? { scope: finding.scope } : {}),
      ...(finding.file ? { file: finding.file } : {}),
      ...(finding.line ? { line: finding.line } : {}),
    })),
  );
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), entries };
}

export async function writeBaseline(root: string, file: string, run: HealthRun): Promise<void> {
  if (run.summary.errors > 0)
    throw new Error("Cannot write a baseline while one or more providers failed to complete.");
  const baselinePath = path.resolve(root, file);
  if (path.relative(root, baselinePath).startsWith(".."))
    throw new Error("Baseline path must stay inside the repository.");
  await writeFile(baselinePath, `${JSON.stringify(baselineFromRun(run), null, 2)}\n`, "utf8");
}

export async function enableBaselineConfig(root: string, file: string): Promise<void> {
  const configPath = path.join(root, "repnix.config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  config.schemaVersion = 1;
  config.baseline = { path: file, failOn: "new" };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
