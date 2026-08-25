import pc from "picocolors";
import { auditRepository } from "./audit.js";
import { assertValidCategory, resolveDiagnosticLogger, type DiagnosticOptions } from "./options.js";
import { runCommand } from "../runners/command-runner.js";
import { execCommand, runScriptCommand } from "../package-manager/package-manager.js";
import { CATEGORY_LABELS, HEALTH_CATEGORIES, type HealthCategory } from "../core/health-category.js";

export interface FixOptions extends DiagnosticOptions {
  category?: string;
}

interface FixTask {
  name: string;
  category: HealthCategory;
  description: string;
  command: string;
  args: string[];
}

export function resolveFixTasks(
  audit: Awaited<ReturnType<typeof auditRepository>>,
  targetCategory?: string,
): FixTask[] {
  const { context, detections } = audit;
  const tasks: FixTask[] = [];
  const pm = context.packageManager ?? "npm";

  // Check category filter
  const applies = (category: HealthCategory) => !targetCategory || targetCategory === category;

  // 1. Formatting
  if (applies("format")) {
    if (context.scripts["format"]) {
      const { command, args } = runScriptCommand(pm, "format");
      tasks.push({
        name: "format",
        category: "format",
        description: "Run repository format script",
        command,
        args,
      });
    } else if (detections.get("biome")?.activeCapabilities.formatting) {
      const { command, args } = execCommand(pm, "biome", ["format", "--write", "."]);
      tasks.push({
        name: "biome-format",
        category: "format",
        description: "Format files with Biome",
        command,
        args,
      });
    } else if (detections.get("prettier")?.activeCapabilities.formatting) {
      const { command, args } = execCommand(pm, "prettier", ["--write", "."]);
      tasks.push({
        name: "prettier-format",
        category: "format",
        description: "Format files with Prettier",
        command,
        args,
      });
    }
  }

  // 2. Linting
  if (applies("lint")) {
    if (context.scripts["lint:fix"] || context.scripts["fix:lint"]) {
      const scriptName = context.scripts["lint:fix"] ? "lint:fix" : "fix:lint";
      const { command, args } = runScriptCommand(pm, scriptName);
      tasks.push({
        name: "lint-fix",
        category: "lint",
        description: `Run repository ${scriptName} script`,
        command,
        args,
      });
    } else if (detections.get("biome")?.activeCapabilities.linting) {
      const { command, args } = execCommand(pm, "biome", ["lint", "--write", "."]);
      tasks.push({
        name: "biome-lint-fix",
        category: "lint",
        description: "Auto-fix lint issues with Biome",
        command,
        args,
      });
    } else if (detections.get("eslint")?.activeCapabilities.linting) {
      const { command, args } = execCommand(pm, "eslint", [".", "--fix"]);
      tasks.push({
        name: "eslint-fix",
        category: "lint",
        description: "Auto-fix lint issues with ESLint",
        command,
        args,
      });
    }
  }

  // 3. Documentation
  if (applies("documentation")) {
    if (context.scripts["docs:fix"] || context.scripts["documentation:fix"]) {
      const scriptName = context.scripts["docs:fix"] ? "docs:fix" : "documentation:fix";
      const { command, args } = runScriptCommand(pm, scriptName);
      tasks.push({
        name: "docs-fix",
        category: "documentation",
        description: `Run repository ${scriptName} script`,
        command,
        args,
      });
    } else if (detections.get("markdownlint")?.activeCapabilities.documentation) {
      const { command, args } = execCommand(pm, "markdownlint-cli2", ["--fix", "**/*.md", "#node_modules"]);
      tasks.push({
        name: "markdownlint-fix",
        category: "documentation",
        description: "Auto-fix Markdown formatting with markdownlint",
        command,
        args,
      });
    }
  }

  return tasks;
}

export async function fixCommand(category: string | undefined, options: FixOptions = {}): Promise<number> {
  const logger = resolveDiagnosticLogger(options);
  const audit = await auditRepository(process.cwd(), { ...options, logger });

  const availableCategories = audit.registry?.categories.map((entry) => entry.id) ?? HEALTH_CATEGORIES;
  assertValidCategory(category, availableCategories, CATEGORY_LABELS);

  const tasks = resolveFixTasks(audit, category);

  if (tasks.length === 0) {
    if (category) {
      process.stdout.write(`No automated fix tasks available for category '${category}'.\n`);
    } else {
      process.stdout.write("No automated fix tasks configured or available for active providers.\n");
    }
    return 0;
  }

  process.stdout.write(
    pc.bold(`Running ${tasks.length} automated remediation task${tasks.length === 1 ? "" : "s"}...\n\n`),
  );

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
  return 0;
}
