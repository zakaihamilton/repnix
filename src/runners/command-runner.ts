import { spawn } from "node:child_process";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  spawnError?: string;
}

export interface RunCommandOptions {
  cwd: string;
  verbose?: boolean;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const started = performance.now();
  const maxOutput = options.maxOutputBytes ?? 10 * 1024 * 1024;
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.stdout.on("data", (chunk: Buffer) => {
      if (options.verbose) process.stderr.write(chunk);
      if (!overflow) stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > maxOutput) {
        overflow = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (options.verbose) process.stderr.write(chunk);
      if (!overflow) stderr += chunk.toString();
      if (Buffer.byteLength(stderr) > maxOutput) {
        overflow = true;
        child.kill("SIGTERM");
      }
    });
    child.on("error", (error) => {
      resolve({
        command,
        args,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        durationMs: Math.round(performance.now() - started),
        spawnError: error.message,
      });
    });
    child.on("close", (exitCode, signal) => {
      resolve({
        command,
        args,
        exitCode,
        signal,
        stdout,
        stderr: overflow ? `${stderr}\nCommand output exceeded ${maxOutput} bytes.` : stderr,
        durationMs: Math.round(performance.now() - started),
        ...(overflow ? { spawnError: `Command output exceeded ${maxOutput} bytes` } : {}),
      });
    });
  });
}
