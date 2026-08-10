import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function temporaryDirectory(prefix) {
  return await mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function run(command, args, options = {}) {
  const {
    allowExitCodes = [0],
    cwd = projectRoot,
    env = {},
    input,
    shell = process.platform === "win32",
    timeoutMs = 300_000,
  } = options;

  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...env },
      shell,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });

  if (!allowExitCodes.includes(result.code)) {
    throw new Error([
      `Command failed (${String(result.code)}): ${command} ${args.join(" ")}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
  return result;
}

export async function packProject(destination) {
  const result = await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination]);
  const packages = JSON.parse(result.stdout);
  if (!Array.isArray(packages) || typeof packages[0]?.filename !== "string") {
    throw new Error(`npm pack returned an unexpected result: ${result.stdout}`);
  }
  return path.join(destination, packages[0].filename);
}

export async function removeTemporary(directory) {
  if (process.env.REPNIX_KEEP_E2E === "1") {
    process.stdout.write(`Kept test project at ${directory}\n`);
    return;
  }
  await rm(directory, { recursive: true, force: true });
}

export async function snapshotFiles(root, files) {
  const snapshot = new Map();
  for (const file of files) {
    try {
      snapshot.set(file, (await readFile(path.join(root, file))).toString("base64"));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return snapshot;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
