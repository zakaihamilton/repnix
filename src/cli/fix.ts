import pc from "picocolors";
import { auditRepository } from "./audit.js";
import { assertValidCategory, resolveDiagnosticLogger, type DiagnosticOptions } from "./options.js";
import { readConfig } from "../config/repo-health-config.js";
import { runCommand } from "../runners/command-runner.js";
import { execCommand, runScriptCommand } from "../package-manager/package-manager.js";
import { CATEGORY_LABELS, HEALTH_CATEGORIES, isHealthCategory, type HealthCategory } from "../core/health-category.js";
import { PROVIDERS } from "../providers/catalog.js";
import type { ProviderFix, ProviderModule } from "../providers/sdk.js";
import { renderHealth } from "../reporting/console-reporter.js";
import { runHealth } from "../runners/health-runner.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";

export interface FixOptions extends DiagnosticOptions {
  category?: string;
}

export interface FixTask {
  name: string;
  category: HealthCategory;
  description: string;
  command: string;
  args: string[];
}

function capabilityFor(category: HealthCategory): string | undefined {
  if (category === "format") return "formatting";
  if (category === "lint") return "linting";
  if (category === "documentation") return "documentation";
  return undefined;
}

function providerCanFix(provider: ProviderModule, audit: AuditModel, spec: ProviderFix): boolean {
  const detection = audit.detections.get(provider.id);
  const capability = capabilityFor(spec.category);
  if (!capability) return Object.keys(detection?.activeCapabilities ?? {}).length > 0;
  return detection?.activeCapabilities[capability] === true;
}

function specsFor(provider: ProviderModule): ProviderFix[] {
  return provider.fix ?? [];
}

export function resolveFixTasks(audit: AuditModel, targetCategory?: HealthCategory): FixTask[] {
  const { context } = audit;
  const pm = context.packageManager ?? "npm";
  const providers = audit.registry?.providers ?? PROVIDERS;
  const tasks: FixTask[] = [];
  const applies = (category: HealthCategory) => !targetCategory || targetCategory === category;
  const categories = [...new Set<HealthCategory>(["format", "lint", "documentation", ...HEALTH_CATEGORIES])];

  for (const category of categories) {
    if (!applies(category)) continue;
    const specs = providers.flatMap((provider) =>
      specsFor(provider)
        .filter((spec) => spec.category === category)
        .map((spec) => ({ provider, spec })),
    );
    if (!specs.length) continue;
    specs.sort((left, right) => (left.spec.order ?? 100) - (right.spec.order ?? 100));

    let task: FixTask | undefined;
    for (const { spec } of specs) {
      const scriptName = spec.scriptNames?.find((name) => context.scripts[name]);
      if (!scriptName) continue;
      const { command, args } = runScriptCommand(pm, scriptName);
      task = {
        name: scriptName,
        category,
        description: `Run repository ${scriptName} script`,
        command,
        args,
      };
      break;
    }
    if (!task) {
      const active = specs.filter(({ provider, spec }) => providerCanFix(provider, audit, spec));
      const spec = active[0]?.spec;
      if (!spec) continue;
      const { command, args } = execCommand(pm, spec.binary, spec.args);
      task = {
        name: spec.binary,
        category,
        description: spec.description,
        command,
        args,
      };
    }
    tasks.push(task);
  }

  return tasks;
}

export function formatFixPlan(tasks: FixTask[]): string {
  const lines = [`Applying ${tasks.length} automated fix${tasks.length === 1 ? "" : "es"}:`, ""];
  for (const task of tasks) {
    lines.push(`  ${task.description}`);
    lines.push(`    ${task.command} ${task.args.join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function fixCommand(category: string | undefined, options: FixOptions = {}): Promise<number> {
  const logger = resolveDiagnosticLogger(options);
  const audit = await auditRepository(process.cwd(), { ...options, logger });

  const availableCategories = audit.registry?.categories.map((entry) => entry.id) ?? HEALTH_CATEGORIES;
  assertValidCategory(category, availableCategories, CATEGORY_LABELS);
  const target = category && isHealthCategory(category) ? category : undefined;

  const tasks = resolveFixTasks(audit, target);

  if (tasks.length === 0) {
    if (category) {
      process.stdout.write(`No automated fix tasks available for category '${category}'.\n`);
    } else {
      process.stdout.write("No automated fix tasks configured or available for active providers.\n");
    }
    return 0;
  }

  process.stdout.write(`${pc.bold(formatFixPlan(tasks).trimEnd())}\n\n`);

  let failureCount = 0;

  for (const task of tasks) {
    process.stdout.write(
      `${pc.cyan("▶")} ${task.description} (${pc.dim(`${task.command} ${task.args.join(" ")}`)})...\n`,
    );
    const result = await runCommand(task.command, task.args, {
      cwd: audit.context.root,
      logger,
      ...(options.timeout ? { timeoutMs: options.timeout * 1000 } : {}),
    });

    if (result.exitCode === 0) {
      process.stdout.write(`  ${pc.green("✓")} Completed successfully.\n\n`);
    } else {
      failureCount += 1;
      process.stdout.write(`  ${pc.red("✗")} Failed with exit code ${result.exitCode ?? "unknown"}.\n`);
      if (result.stderr.trim()) {
        process.stderr.write(`${pc.dim(result.stderr.trim())}\n`);
      }
      process.stdout.write("\n");
    }
  }

  if (failureCount > 0) {
    process.stdout.write(pc.yellow(`Completed with ${failureCount} task failure${failureCount === 1 ? "" : "s"}.\n`));
    return 1;
  }

  process.stdout.write(pc.green("All remediation tasks completed successfully.\n"));
  const { config } = await readConfig(audit.context.root);
  process.stdout.write(`\n${pc.bold("Verifying with repnix check...")}\n`);
  const verified = await runHealth(audit, config, {
    logger,
    ...(target ? { category: target } : {}),
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
  });
  process.stdout.write(`${renderHealth(verified)}\n`);
  return verified.summary.exitCode;
}
