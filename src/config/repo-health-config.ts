import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HEALTH_CATEGORIES } from "../core/health-category.js";

const categoryMode = z.enum(["required", "optional", "off"]);
const providerConfig = z.object({ enabled: z.boolean() }).strict();
const schema = z
  .object({
    categories: z.partialRecord(z.enum(HEALTH_CATEGORIES), categoryMode).optional(),
    severityThreshold: z.enum(["info", "warning", "error"]).default("warning"),
    providers: z
      .object({
        knip: providerConfig.optional(),
        jscpd: providerConfig.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RepnixConfig = z.infer<typeof schema>;

export interface ConfigResult {
  config: RepnixConfig;
  path: string | null;
}

export async function readConfig(root: string): Promise<ConfigResult> {
  const configPath = path.join(root, "repnix.config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return { config: schema.parse(parsed), path: configPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: schema.parse({}), path: null };
    }
    if (error instanceof SyntaxError) throw new Error(`Invalid repnix.config.json: ${error.message}`);
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid repnix.config.json: ${z.prettifyError(error)}`);
    }
    throw error;
  }
}
