import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { assert, packProject, projectRoot, removeTemporary, run, temporaryDirectory } from "./test-utils.mjs";

const temporary = await temporaryDirectory("repnix-phase3-e2e-");
const consumer = path.join(temporary, "consumer");

async function runInteractiveSetup(bin) {
  const command = "python3";
  const args = [path.join(projectRoot, "scripts", "drive-setup.py"), bin, "--apply"];
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: consumer,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "xterm", REPNIX_E2E_BIN: bin },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Interactive setup timed out.\n${output}`));
    }, 600_000);
    const consume = (chunk) => { output += chunk.toString(); };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`Interactive setup exited ${String(code)}.\n${output}`));
    });
  });
}

try {
  await mkdir(path.join(consumer, "dist"), { recursive: true });
  await writeFile(path.join(consumer, "package.json"), `${JSON.stringify({
    name: "repnix-phase3-consumer",
    version: "1.0.0",
    private: false,
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    files: ["dist"],
  }, null, 2)}\n`);
  await writeFile(path.join(consumer, "dist", "index.js"), "export const answer = 42;\n");
  await writeFile(path.join(consumer, "dist", "index.d.ts"), "export declare const answer: number;\n");

  const tarball = await packProject(temporary);
  await run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", tarball], { cwd: consumer, timeoutMs: 600_000 });
  const bin = path.join(consumer, "node_modules", ".bin", `repnix${process.platform === "win32" ? ".cmd" : ""}`);

  const beforeSetup = await run(bin, ["audit"], { cwd: consumer });
  assert(beforeSetup.stdout.includes("+ Publint"), `Audit did not recommend Publint.\n${beforeSetup.stdout}`);
  assert(beforeSetup.stdout.includes("+ Are The Types Wrong?"), `Audit did not recommend ATTW.\n${beforeSetup.stdout}`);
  const setup = await runInteractiveSetup(bin);
  assert(setup.includes("Repository health setup complete"), `Interactive package-health setup did not complete.\n${setup}`);
  const manifest = JSON.parse(await readFile(path.join(consumer, "package.json"), "utf8"));
  assert(manifest.devDependencies?.publint, "Setup did not install Publint.");
  assert(manifest.devDependencies?.["@arethetypeswrong/cli"], "Setup did not install Are The Types Wrong?.");
  assert(manifest.scripts?.["health:package:publint"] === "publint", "Setup did not add the Publint script.");
  assert(manifest.scripts?.["health:package:types"] === "attw --pack .", "Setup did not add the ATTW script.");

  const audit = await run(bin, ["audit"], { cwd: consumer });
  assert(audit.stdout.includes("Package publishing          ✓ Publint, Are The Types Wrong?"), `Audit did not credit both package-health providers after setup.\n${audit.stdout}`);

  const check = await run(bin, ["check", "package-health", "--format", "json"], { cwd: consumer, allowExitCodes: [1], timeoutMs: 600_000 });
  const report = JSON.parse(check.stdout);
  assert(report.summary?.errors === 0, `Package-health execution failed: ${check.stdout}\n${check.stderr}`);
  assert(report.results?.some((result) => result.provider === "publint" && result.findings.length > 0), "Publint did not produce a normalized package finding.");
  assert(report.results?.some((result) => result.provider === "attw" && result.findings.length > 0), "Are The Types Wrong? did not produce a normalized type-resolution finding.");
  assert(report.results.every((result) => result.category === "package-health"), "Category filtering included an unrelated result.");

  const details = await run(bin, ["check", "package-health", "--details"], { cwd: consumer, allowExitCodes: [1], timeoutMs: 600_000 });
  assert(details.stdout.includes("Reported by: Publint"), "Detailed output omitted Publint attribution.");
  assert(details.stdout.includes("Reported by: Are The Types Wrong?"), "Detailed output omitted ATTW attribution.");

  process.stdout.write("Phase 3 package-health acceptance test passed.\n");
} finally {
  await removeTemporary(temporary);
}
