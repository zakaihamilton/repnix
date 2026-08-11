#!/usr/bin/env node
import { Command } from "commander";
import { auditCommand } from "./cli/audit.js";
import { checkCommand } from "./cli/check.js";
import { explainCommand } from "./cli/explain.js";
import { setupCommand } from "./cli/setup.js";
import { addDiagnosticOptions, type DiagnosticOptions } from "./cli/options.js";
import { VERSION } from "./core/version.js";
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS, HEALTH_CATEGORIES } from "./core/health-category.js";

const program = new Command()
  .name("repnix")
  .description("Find missing checks and make software repositories safer to change")
  .version(VERSION)
  .showHelpAfterError()
  .addHelpText("after", `\nStart here:\n  repnix audit   See what your repository already checks and what is missing.\n  repnix setup   Add recommended checks after reviewing a preview.\n  repnix check   Run all active checks.\n  repnix explain  Read findings in plain language.\n\nHealth categories:\n${HEALTH_CATEGORIES.map((category) => `  ${category.padEnd(16)} ${CATEGORY_LABELS[category]} — ${CATEGORY_DESCRIPTIONS[category]}`).join("\n")}\n`);

addDiagnosticOptions(program.command("audit").description("Read-only overview of active checks, missing coverage, and recommendations")).action(async (options: DiagnosticOptions) => {
  process.exitCode = await auditCommand(options);
});

addDiagnosticOptions(program.command("setup").description("Review and interactively add recommended checks")).action(async (options: DiagnosticOptions) => {
  process.exitCode = await setupCommand(options);
});

const check = program
  .command("check")
  .description("Run all active checks, or one category such as dead-code or security")
  .argument("[category]", "optional category name, for example dead-code or security")
  .option("--json", "emit versioned JSON to stdout")
  .action(async (category: string | undefined, options: DiagnosticOptions & { json?: boolean }) => {
    process.exitCode = await checkCommand(category, options);
  });
addDiagnosticOptions(check);

addDiagnosticOptions(program.command("explain").description("Rerun checks and explain findings, locations, and next steps")).action(async (options: DiagnosticOptions) => {
  process.exitCode = await explainCommand(options);
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const formatArgument = process.argv.find((argument) => argument.startsWith("--log-format="));
  const formatIndex = process.argv.indexOf("--log-format");
  const structured = formatArgument === "--log-format=json" || process.argv[formatIndex + 1] === "json";
  const stackRequested = process.argv.includes("--verbose") || process.argv.includes("--log-level");
  const stack = stackRequested && error instanceof Error && error.stack ? error.stack.split("\n").slice(1).join("\n") : undefined;
  if (structured) {
    process.stderr.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "cli.error",
      message,
      ...(stack ? { stack } : {}),
    })}\n`);
  } else {
    process.stderr.write(`repnix: ${message}\n`);
    if (stack) {
      process.stderr.write(`${stack}\n`);
    }
  }
  process.exitCode = 2;
}
