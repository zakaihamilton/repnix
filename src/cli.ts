#!/usr/bin/env node
import { Command } from "commander";
import { auditCommand } from "./cli/audit.js";
import { checkCommand } from "./cli/check.js";
import { explainCommand } from "./cli/explain.js";
import { setupCommand } from "./cli/setup.js";
import { VERSION } from "./core/version.js";

const program = new Command()
  .name("repnix")
  .description("Find and orchestrate missing JavaScript/TypeScript repository health checks")
  .version(VERSION)
  .showHelpAfterError();

program.command("audit").description("Inspect repository health guardrails without modifying files").action(async () => {
  process.exitCode = await auditCommand();
});

program.command("setup").description("Preview and interactively install recommended health providers").action(async () => {
  process.exitCode = await setupCommand();
});

program
  .command("check")
  .description("Run configured repository health checks")
  .argument("[category]", "run one health category")
  .option("--json", "emit versioned JSON to stdout")
  .option("--verbose", "stream provider output to stderr")
  .action(async (category: string | undefined, options: { json?: boolean; verbose?: boolean }) => {
    process.exitCode = await checkCommand(category, options);
  });

program.command("explain").description("Rerun checks and explain normalized findings").action(async () => {
  process.exitCode = await explainCommand();
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`repnix: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
