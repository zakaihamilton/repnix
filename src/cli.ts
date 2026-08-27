#!/usr/bin/env node
import { Command } from "commander";
import { auditCommand } from "./cli/audit.js";
import { checkCommand } from "./cli/check.js";
import { fixCommand } from "./cli/fix.js";
import { setupCommand } from "./cli/setup.js";
import { addDiagnosticOptions, type DiagnosticOptions } from "./cli/options.js";
import { VERSION } from "./core/version.js";
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, HEALTH_CATEGORIES } from "./core/health-category.js";

const program = new Command()
  .name("repnix")
  .description("Find missing checks and make software repositories safer to change")
  .version(VERSION)
  .showHelpAfterError()
  .addHelpText(
    "after",
    `\nStart here:\n  repnix audit   See what your repository already checks and what is missing.\n  repnix setup   Add recommended checks after reviewing a preview.\n  repnix check   Run active checks; add --details for remediation.\n  repnix fix     Automatically apply available fixes for active providers.\n\nAI-assisted fixes:\n  The full-screen setup check saves .repnix/health-report.md. Attach or drop that\n  file into an AI coding assistant, ask it to fix the reported issues, review its\n  changes, then run repnix check to verify them.\n\nHealth categories:\n${HEALTH_CATEGORIES.map((category) => `  ${category.padEnd(16)} ${CATEGORY_LABELS[category]} — ${CATEGORY_DESCRIPTIONS[category]}`).join("\n")}\n`,
  );

addDiagnosticOptions(
  program
    .command("audit")
    .description("Read-only overview of active checks, missing coverage, and recommendations")
    .option("--format <format>", "output format: text or json", "text")
    .option("--details", "show every applicable recommendation and its evidence"),
).action(async (options: DiagnosticOptions & { format?: "text" | "json"; details?: boolean }) => {
  process.exitCode = await auditCommand(options);
});

addDiagnosticOptions(
  program
    .command("setup")
    .description("Review and interactively add recommended checks")
    .option("--plan", "print a read-only plan for recommended baseline checks")
    .option("--apply-plan <file>", "review and apply a previously serialized setup plan")
    .option("--format <format>", "plan output format: text or json", "text"),
).action(async (options: DiagnosticOptions & { plan?: boolean; applyPlan?: string; format?: "text" | "json" }) => {
  process.exitCode = await setupCommand(options);
});

const check = program
  .command("check")
  .description("Run all active checks, or one category such as dead-code or security")
  .argument("[category]", "optional category name, for example dead-code or security")
  .option("--format <format>", "output format: summary, details, json, or sarif", "summary")
  .option("--details", "show finding remediation (shortcut for --format details)")
  .option("--jobs <count>", "maximum concurrent repository commands", (value: string) => {
    const jobs = Number(value);
    if (!Number.isInteger(jobs) || jobs < 1 || jobs > 32) throw new Error("Jobs must be an integer between 1 and 32.");
    return jobs;
  })
  .option("--write-baseline [path]", "record current findings and fail future checks only on new findings")
  .action(
    async (
      category: string | undefined,
      options: DiagnosticOptions & {
        format?: "summary" | "details" | "json" | "sarif";
        details?: boolean;
        jobs?: number;
        writeBaseline?: boolean | string;
      },
    ) => {
      if (options.details) options.format = "details";
      process.exitCode = await checkCommand(category, options);
    },
  );
addDiagnosticOptions(check);

const fix = program
  .command("fix")
  .description("Automatically apply available fixes for active providers (e.g. format, lint:fix, docs:fix)")
  .argument("[category]", "optional category name, for example format, lint, or documentation")
  .option("--no-check", "do not re-run health checks after applying fixes")
  .action(async (category: string | undefined, options: DiagnosticOptions & { check?: boolean }) => {
    process.exitCode = await fixCommand(category, options);
  });
addDiagnosticOptions(fix);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const formatArgument = process.argv.find((argument) => argument.startsWith("--log-format="));
  const formatIndex = process.argv.indexOf("--log-format");
  const structured = formatArgument === "--log-format=json" || process.argv[formatIndex + 1] === "json";
  const stackRequested = process.argv.includes("--verbose") || process.argv.includes("--log-level");
  const stack =
    stackRequested && error instanceof Error && error.stack ? error.stack.split("\n").slice(1).join("\n") : undefined;
  if (structured) {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "cli.error",
        message,
        ...(stack ? { stack } : {}),
      })}\n`,
    );
  } else {
    process.stderr.write(`repnix: ${message}\n`);
    if (stack) {
      process.stderr.write(`${stack}\n`);
    }
  }
  process.exitCode = 2;
}
