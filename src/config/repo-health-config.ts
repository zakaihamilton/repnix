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
        "osv-scanner": providerConfig.optional(),
        "eslint-boundaries": providerConfig.optional(),
        "dependency-cruiser": providerConfig.optional(),
        "size-limit": providerConfig.optional(),
        publint: providerConfig.optional(),
        attw: providerConfig.optional(),
        c8: providerConfig.optional(),
        stryker: providerConfig.optional(),
        "jsx-a11y": providerConfig.optional(),
        syncpack: providerConfig.optional(),
        gitleaks: providerConfig.optional(),
        "license-checker": providerConfig.optional(),
        markdownlint: providerConfig.optional(),
        lhci: providerConfig.optional(),
        changesets: providerConfig.optional(),
        actionlint: providerConfig.optional(),
      })
      .strict()
      .optional(),
    policies: z
      .object({
        licenses: z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional() }).strict().optional(),
        coverage: z.object({ lines: z.number().min(0).max(100).optional(), functions: z.number().min(0).max(100).optional(), branches: z.number().min(0).max(100).optional(), statements: z.number().min(0).max(100).optional() }).strict().optional(),
        performance: z.object({ maxLcpMs: z.number().positive().optional(), maxCls: z.number().nonnegative().optional(), maxTbtMs: z.number().positive().optional() }).strict().optional(),
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
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid repnix.config.json: ${error.message}\nConfiguration tip: use valid JSON, then run 'repnix audit' to check the file without changing it.`);
    }
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid repnix.config.json: ${z.prettifyError(error)}\nConfiguration tip: category modes are 'required', 'optional', or 'off'; severityThreshold is 'info', 'warning', or 'error'.`);
    }
    throw error;
  }
}
