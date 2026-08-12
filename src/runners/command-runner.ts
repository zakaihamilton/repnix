import { spawn } from "node:child_process";
import { resolveDiagnosticLogger, type DiagnosticLogger } from "../cli/options.js";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  spawnError?: string;
  timedOut?: boolean;
}

export interface RunCommandOptions {
  cwd: string;
  verbose?: boolean;
  logger?: DiagnosticLogger;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  timeoutMs?: number;
  onOutput?: (stream: "stdout" | "stderr", chunk: Buffer) => void;
}

export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const started = performance.now();
  const maxOutput = options.maxOutputBytes ?? 10 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const displayCommand = formatCommand(command, args);
  const logger = resolveDiagnosticLogger(options.logger ?? (options.verbose === undefined ? {} : { verbose: options.verbose }));
  logger.debug("command.start", `Running ${displayCommand}`, { command: displayCommand, cwd: options.cwd });
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let overflow = false;
    let timedOut = false;
    let closed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: process.platform !== "win32",
    });
    const clearTimers = () => {
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
    };
    const terminate = (signal: NodeJS.Signals) => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process group may already have exited; fall back to the child.
        }
      }
      child.kill(signal);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      options.onOutput?.("stdout", chunk);
      logger.output("stdout", chunk, { command: displayCommand });
      if (!overflow) stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > maxOutput) {
        overflow = true;
        terminate("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      options.onOutput?.("stderr", chunk);
      logger.output("stderr", chunk, { command: displayCommand });
      if (!overflow) stderr += chunk.toString();
      if (Buffer.byteLength(stderr) > maxOutput) {
        overflow = true;
        terminate("SIGTERM");
      }
    });
    child.on("error", (error) => {
      clearTimers();
      // The health reporter turns this into a concise, actionable check error. Keep
      // the command line in debug logs so normal output does not repeat it twice.
      logger.debug("command.spawn-error", `Could not start ${displayCommand}: ${error.message}`, { command: displayCommand, cwd: options.cwd });
      resolve({
        command,
        args,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        durationMs: Math.round(performance.now() - started),
        spawnError: error.message,
        ...(timedOut ? { timedOut: true } : {}),
      });
    });
    child.on("close", (exitCode, signal) => {
      closed = true;
      clearTimers();
      logger.debug("command.finish", `Finished ${displayCommand}`, {
        command: displayCommand,
        exitCode,
        signal,
        durationMs: Math.round(performance.now() - started),
      });
      resolve({
        command,
        args,
        exitCode,
        signal,
        stdout,
        stderr: overflow ? `${stderr}\nCommand output exceeded ${maxOutput} bytes.` : stderr,
        durationMs: Math.round(performance.now() - started),
        ...(overflow ? { spawnError: `Command output exceeded ${maxOutput} bytes` } : {}),
        ...(timedOut ? { spawnError: `Command timed out after ${timeoutMs}ms`, timedOut: true } : {}),
      });
    });
    const timeout = setTimeout(() => {
      if (closed) return;
      timedOut = true;
      logger.error("command.timeout", `Command timed out after ${timeoutMs}ms: ${displayCommand}`, {
        command: displayCommand,
        cwd: options.cwd,
        timeoutMs,
      });
      terminate("SIGTERM");
      killTimer = setTimeout(() => {
        if (!closed) terminate("SIGKILL");
      }, 2000);
    }, timeoutMs);
  });
}
