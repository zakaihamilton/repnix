#!/usr/bin/env node
import { Command } from "commander";
import { auditCommand } from "./cli/audit.js";
import { checkCommand } from "./cli/check.js";
import { explainCommand } from "./cli/explain.js";
import { setupCommand } from "./cli/setup.js";
import { addDiagnosticOptions, type DiagnosticOptions } from "./cli/options.js";
import { VERSION } from "./core/version.js";

const program = new Command()
  .name("repnix")
  .description("Find and orchestrate missing JavaScript/TypeScript repository health checks")
  .version(VERSION)
  .showHelpAfterError();

addDiagnosticOptions(program.command("audit").description("Inspect repository health guardrails without modifying files")).action(async (options: DiagnosticOptions) => {
  process.exitCode = await auditCommand(options);
});

addDiagnosticOptions(program.command("setup").description("Preview and interactively install recommended health providers")).action(async (options: DiagnosticOptions) => {
  process.exitCode = await setupCommand(options);
});

const check = program
  .command("check")
  .description("Run configured repository health checks")
  .argument("[category]", "run one health category")
  .option("--json", "emit versioned JSON to stdout")
  .action(async (category: string | undefined, options: DiagnosticOptions & { json?: boolean }) => {
    process.exitCode = await checkCommand(category, options);
  });
addDiagnosticOptions(check);

addDiagnosticOptions(program.command("explain").description("Rerun checks and explain normalized findings")).action(async (options: DiagnosticOptions) => {
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
