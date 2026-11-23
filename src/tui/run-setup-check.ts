import path from "node:path";
import type { DiagnosticLogger } from "../cli/options.js";
import { type CommandResult, runCommand } from "../runners/command-runner.js";

/** Execute `repnix check` as a child process and stream provider progress diagnostics. */
export async function runSetupCheck(
  root: string,
  logger: DiagnosticLogger,
  timeoutMs?: number,
  onProgress?: (message: string) => void,
): Promise<CommandResult> {
  let pendingDiagnostics = "";
  const onOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
    if (stream !== "stderr") return;
    pendingDiagnostics += chunk.toString();
    const lines = pendingDiagnostics.split("\n");
    pendingDiagnostics = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { event?: string; message?: string };
        if (event.event === "health.provider.start" || event.event === "health.provider.finish")
          onProgress?.(event.message ?? "Check progress updated");
      } catch {
        // Diagnostics are optional; the final JSON report remains authoritative.
      }
    }
  };
  const commandOptions = {
    cwd: root,
    logger,
    onOutput,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
  const localCommand = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "repnix.cmd" : "repnix");
  const args = ["check", "--format", "json", "--log-format", "json", "--log-level", "info"];
  const localResult = await runCommand(localCommand, args, commandOptions);
  return localResult.spawnError ? runCommand("repnix", args, commandOptions) : localResult;
}

/** Extract structured stdout or a user-facing fallback error from a setup check command result. */
export function setupCheckResultOutput(
  check: Pick<CommandResult, "command" | "args" | "exitCode" | "signal" | "stdout" | "stderr" | "spawnError">,
): string {
  const stdout = check.stdout.trimEnd();
  // Keep structured stdout parseable: the check details view uses it to render
  // status rows. Stderr is a fallback for commands that fail before producing
  // the JSON report.
  if (stdout) return stdout;
  const diagnostics = [check.stderr, check.spawnError ? `Error: ${check.spawnError}` : ""]
    .map((value) => value.trimEnd())
    .filter(Boolean)
    .join("\n");
  if (diagnostics) return diagnostics;
  if (check.exitCode === 0) return "";

  const command = [check.command, ...check.args].map((part) => JSON.stringify(part)).join(" ");
  const reason = check.spawnError
    ? `could not start: ${check.spawnError}`
    : check.signal
      ? `was terminated by ${check.signal}`
      : `exited with code ${check.exitCode ?? "unknown"}`;
  return [
    "The check failed without producing output.",
    `Command: ${command}`,
    `Reason: ${reason}.`,
    "Run the command above directly for more diagnostics.",
  ].join("\n");
}
