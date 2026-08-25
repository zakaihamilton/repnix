import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { HealthCategory } from "../core/health-category.js";
import type { RepositoryContext, RepositoryRole } from "../core/types.js";

const categoryMode = z.enum(["required", "optional", "off"]);
const categoryConfig = z.object({ mode: categoryMode }).strict();
const repositoryRole = z.enum(["cli", "library", "web-app", "node-app", "tooling"]);
const categories = z.record(z.string(), categoryConfig);
const schema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    scopes: z
      .record(
        z.string(),
        z.object({ roles: z.array(repositoryRole).min(1).optional(), categories: categories.optional() }).strict(),
      )
      .optional(),
    categories: categories.optional(),
    severityThreshold: z.enum(["info", "warning", "error"]).default("warning"),
    execution: z
      .object({ jobs: z.number().int().min(1).max(32).default(2), timeoutSeconds: z.number().positive().default(300) })
      .strict()
      .default({ jobs: 2, timeoutSeconds: 300 }),
    baseline: z
      .object({
        path: z.string().min(1).default(".repnix-baseline.json"),
        failOn: z.enum(["new", "all"]).default("new"),
      })
      .strict()
      .optional(),
    policies: z
      .object({
        licenses: z
          .object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional() })
          .strict()
          .optional(),
        coverage: z
          .object({
            lines: z.number().min(0).max(100).optional(),
            functions: z.number().min(0).max(100).optional(),
            branches: z.number().min(0).max(100).optional(),
            statements: z.number().min(0).max(100).optional(),
          })
          .strict()
          .optional(),
        performance: z
          .object({
            maxLcpMs: z.number().positive().optional(),
            maxCls: z.number().nonnegative().optional(),
            maxTbtMs: z.number().positive().optional(),
          })
          .strict()
          .optional(),
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

export function categoryModeFor(
  config: RepnixConfig,
  category: HealthCategory,
  scope?: string,
): "required" | "optional" | "off" | undefined {
  return (
    (scope === undefined ? undefined : config.scopes?.[scope]?.categories?.[category]?.mode) ??
    config.categories?.[category]?.mode
  );
}

export function applyScopeOverrides(context: RepositoryContext, config: RepnixConfig): RepositoryContext {
  if (!config.scopes) return context;
  return {
    ...context,
    scopes: context.scopes.map((scope) => {
      const roles = config.scopes?.[scope.path]?.roles;
      if (!roles) return scope;
      return {
        ...scope,
        roles: roles as RepositoryRole[],
        roleEvidence: roles.map((role) => ({
          role: role as RepositoryRole,
          confidence: "configured" as const,
          signals: ["repnix.config.json scope override"],
        })),
      };
    }),
  };
}

export function validateConfigCategories(config: RepnixConfig, availableCategories: Iterable<string>): void {
  const available = new Set(availableCategories);
  const configured = [
    ...Object.keys(config.categories ?? {}),
    ...Object.values(config.scopes ?? {}).flatMap((scope) => Object.keys(scope.categories ?? {})),
  ];
  const unknown = configured.find((category) => !available.has(category));
  if (unknown)
    throw new Error(`Unknown health category '${unknown}'. Available categories: ${[...available].join(", ")}`);
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
      throw new Error(
        `Invalid repnix.config.json: ${error.message}\nConfiguration tip: use valid JSON, then run 'repnix audit' to check the file without changing it.`,
      );
    }
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid repnix.config.json: ${z.prettifyError(error)}\nConfiguration tip: category entries use { "mode": "required" | "optional" | "off" }; severityThreshold is 'info', 'warning', or 'error'.`,
      );
    }
    throw error;
  }
}
