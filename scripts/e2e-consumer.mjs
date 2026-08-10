import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import {
  assert,
  packProject,
  projectRoot,
  removeTemporary,
  run,
  snapshotFiles,
  temporaryDirectory,
} from "./test-utils.mjs";

const manager = process.argv[2];
assert(["npm", "pnpm", "yarn", "bun"].includes(manager), "Usage: node scripts/e2e-consumer.mjs <npm|pnpm|yarn|bun>");
assert(process.platform !== "win32", "The interactive consumer test requires the Unix script utility.");

const temporary = await temporaryDirectory(`repnix-${manager}-e2e-`);
const consumer = path.join(temporary, "consumer");

const installArgs = {
  npm: ["install", "--no-audit", "--no-fund", "--save-dev"],
  pnpm: ["add", "-D"],
  yarn: ["add", "-D"],
  bun: ["add", "-d"],
};

async function runInteractiveSetup(bin, expectNoChanges = false) {
  const useExpect = process.platform === "darwin" && process.env.REPNIX_E2E_PTY !== "python";
  const expectProgram = expectNoChanges
    ? `set timeout 600\nlog_user 1\nspawn $env(REPNIX_E2E_BIN) setup\nexpect "Select providers"\nsend "\\r"\nexpect eof\ncatch wait result\nexit [lindex $result 3]`
    : `set timeout 600\nlog_user 1\nspawn $env(REPNIX_E2E_BIN) setup\nexpect "Select providers"\nsend "\\r"\nexpect "Apply changes?"\nsend "\\033\\[D\\r"\nexpect eof\ncatch wait result\nexit [lindex $result 3]`;
  const interactiveCommand = useExpect ? "expect" : "python3";
  const interactiveArgs = useExpect
    ? ["-c", expectProgram]
    : [path.join(projectRoot, "scripts", "drive-setup.py"), bin, expectNoChanges ? "--no-changes" : "--apply"];
  const output = await new Promise((resolve, reject) => {
    const child = spawn(interactiveCommand, interactiveArgs, {
      cwd: consumer,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", TERM: "xterm", REPNIX_E2E_BIN: bin },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let combined = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Interactive setup timed out.\n${combined}`));
    }, 600_000);
    const consume = (chunk) => {
      combined += chunk.toString();
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Interactive setup exited ${String(code)}.\n${combined}`));
      else resolve(combined);
    });
  });
  return output;
}

try {
  await mkdir(path.join(consumer, "src"), { recursive: true });
  await mkdir(path.join(consumer, "test"), { recursive: true });
  await writeFile(path.join(consumer, "package.json"), `${JSON.stringify({
    name: `repnix-${manager}-consumer`,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: { test: "node --test" },
  }, null, 2)}\n`);
  await writeFile(path.join(consumer, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true },
    include: ["src/**/*.ts"],
  }, null, 2)}\n`);
  const duplicatedBody = `export function summarize(values: number[]): number {\n  const positive = values.filter((value) => value > 0);\n  const doubled = positive.map((value) => value * 2);\n  const limited = doubled.slice(0, 100);\n  const sorted = limited.sort((left, right) => left - right);\n  const unique = [...new Set(sorted)];\n  const total = unique.reduce((sum, value) => sum + value, 0);\n  const count = unique.length;\n  const average = count === 0 ? 0 : total / count;\n  return Math.round(average);\n}\n`;
  await writeFile(path.join(consumer, "src", "first.ts"), duplicatedBody);
  await writeFile(path.join(consumer, "src", "second.ts"), duplicatedBody.replace("summarize", "calculate"));
  await writeFile(path.join(consumer, "test", "smoke.test.js"), `import assert from "node:assert/strict";\nimport test from "node:test";\ntest("consumer", () => assert.equal(2 + 2, 4));\n`);

  const tarball = await packProject(temporary);
  await run(manager, [...installArgs[manager], tarball, "typescript"], { cwd: consumer, timeoutMs: 600_000 });
  const bin = path.join(consumer, "node_modules", ".bin", "repnix");

  const audit = await run(bin, ["audit"], { cwd: consumer });
  assert(audit.stdout.includes("Knip"), "Audit did not recommend Knip.");
  assert(audit.stdout.includes("jscpd"), "Audit did not recommend jscpd.");

  const setupOutput = await runInteractiveSetup(bin);
  assert(setupOutput.includes("Repository health setup complete"), "Interactive setup did not complete.");

  const manifest = JSON.parse(await readFile(path.join(consumer, "package.json"), "utf8"));
  assert(manifest.scripts?.health === "repnix check", "Setup did not add the health script.");
  assert(manifest.scripts?.["health:dead-code"] === "knip", "Setup did not add the Knip script.");
  assert(manifest.scripts?.["health:duplication"] === "jscpd src", "Setup did not add the jscpd script.");
  assert(manifest.devDependencies?.knip, "Setup did not install Knip.");
  assert(manifest.devDependencies?.jscpd, "Setup did not install jscpd.");
  await readFile(path.join(consumer, ".jscpd.json"), "utf8");

  const check = await run(bin, ["check", "--json"], { cwd: consumer, allowExitCodes: [0, 1], timeoutMs: 600_000 });
  const report = JSON.parse(check.stdout);
  assert(report.schemaVersion === 1, "check --json did not emit schema version 1.");
  assert(report.summary?.errors === 0, `Health check contained execution errors: ${check.stdout}`);
  assert(report.results?.some((result) => result.provider === "knip"), "Health check did not run Knip.");
  assert(report.results?.some((result) => result.provider === "jscpd"), "Health check did not run jscpd.");

  const explanation = await run(bin, ["explain"], { cwd: consumer, allowExitCodes: [0, 1], timeoutMs: 600_000 });
  assert(explanation.stdout.includes("Knip") || explanation.stdout.includes("jscpd"), "Explain omitted provider attribution.");

  const trackedFiles = ["package.json", ".jscpd.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];
  const beforeSecondSetup = await snapshotFiles(consumer, trackedFiles);
  const secondSetupOutput = await runInteractiveSetup(bin, true);
  assert(secondSetupOutput.includes("No setup changes are recommended"), "Second setup was not a no-op.");
  const afterSecondSetup = await snapshotFiles(consumer, trackedFiles);
  assert(JSON.stringify([...afterSecondSetup]) === JSON.stringify([...beforeSecondSetup]), "Second setup changed repository files.");

  process.stdout.write(`${manager} consumer acceptance test passed.\n`);
} finally {
  await removeTemporary(temporary);
}
