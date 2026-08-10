import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyFixture, projectRoot } from "./helpers.js";

const temporary: string[] = [];

async function runCli(root: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(projectRoot, "dist", "cli.js"), ...args], { cwd: root, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function fakeBinary(root: string, name: string, source: string): Promise<string> {
  const directory = path.join(root, "node_modules", ".bin");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await writeFile(file, `#!/usr/bin/env node\n${source}\n`);
  await chmod(file, 0o755);
  return file;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI", () => {
  it("emits JSON-only health output and a successful exit code", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const result = await runCli(root, ["check", "--json"]);
    const report = JSON.parse(result.stdout) as { schemaVersion: number; summary: { exitCode: number }; results: Array<{ category: string }> };
    expect(report.schemaVersion).toBe(1);
    expect(report.summary.exitCode).toBe(0);
    expect(result.code).toBe(0);
    expect(report.results).toContainEqual(expect.objectContaining({ category: "tests" }));
    expect(result.stderr).toBe("");
  });

  it("audits without mutating the fixture", async () => {
    const root = await copyFixture("react-eslint");
    temporary.push(root);
    const result = await runCli(root, ["audit"]);
    expect(result.stdout).toContain("Recommended baseline");
    expect(result.stdout).toContain("Knip");
    expect(result.stdout).toContain("jscpd");
  });

  it("uses exit 1 for valid health findings", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { scripts: Record<string, string> };
    manifest.scripts.test = "node -e \"process.exit(1)\"";
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = await runCli(root, ["check", "--json"]);
    const report = JSON.parse(result.stdout) as { summary: { exitCode: number; findings: number } };
    expect(result.code).toBe(1);
    expect(report.summary).toMatchObject({ exitCode: 1, findings: 1 });
  });

  it("uses exit 2 when required coverage is unavailable", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    await writeFile(path.join(root, "repnix.config.json"), JSON.stringify({ categories: { security: "required" } }));
    const result = await runCli(root, ["check", "--json"]);
    const report = JSON.parse(result.stdout) as { summary: { exitCode: number; errors: number } };
    expect(result.code).toBe(2);
    expect(report.summary).toMatchObject({ exitCode: 2, errors: 1 });
  });

  it("runs OSV-Scanner offline and accepts nonzero exits with valid findings", async () => {
    const root = await copyFixture("minimal-js");
    temporary.push(root);
    const binary = await fakeBinary(root, "osv-scanner", `process.stdout.write(JSON.stringify({ results: [{ source: { path: "package-lock.json" }, packages: [{ package: { name: "demo", version: "1.0.0", ecosystem: "npm" }, vulnerabilities: [{ id: "GHSA-demo", database_specific: { severity: "HIGH" } }] }] }] })); process.exitCode = 1;`);
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    const result = await runCli(root, ["check", "security", "--json"], { PATH: `${path.dirname(binary)}${path.delimiter}${process.env.PATH ?? ""}` });
    const report = JSON.parse(result.stdout) as { summary: { exitCode: number; errors: number }; results: Array<{ provider: string; findings: unknown[] }> };
    expect(result.code).toBe(1);
    expect(report.summary).toMatchObject({ exitCode: 1, errors: 0 });
    expect(report.results).toContainEqual(expect.objectContaining({ provider: "osv-scanner", findings: [expect.objectContaining({ type: "vulnerability" })] }));
  });

  it("runs configured dependency-cruiser and Size Limit providers", async () => {
    const root = await copyFixture("react-eslint");
    temporary.push(root);
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { devDependencies: Record<string, string>; [key: string]: unknown };
    manifest.devDependencies["dependency-cruiser"] = "^17.0.0";
    manifest.devDependencies["size-limit"] = "^12.0.0";
    manifest["size-limit"] = [{ path: "dist/app.js", limit: "10 kB" }];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(root, ".dependency-cruiser.cjs"), `module.exports = { forbidden: [{ name: "no-source-to-test", severity: "error", from: {}, to: {} }] };\n`);
    await fakeBinary(root, "depcruise", `process.stdout.write(JSON.stringify({ summary: { violations: [{ from: "src/App.tsx", to: "test/helper.ts", rule: { name: "no-source-to-test", severity: "error" } }] } }));`);
    await fakeBinary(root, "size-limit", `process.stderr.write("Size limit has exceeded the configured limit"); process.exitCode = 1;`);

    const architecture = await runCli(root, ["check", "architecture", "--json"]);
    const architectureReport = JSON.parse(architecture.stdout) as { summary: { exitCode: number }; results: Array<{ provider: string }> };
    expect(architectureReport.summary.exitCode).toBe(1);
    expect(architectureReport.results).toContainEqual(expect.objectContaining({ provider: "dependency-cruiser" }));

    const bundle = await runCli(root, ["check", "bundle", "--json"]);
    const bundleReport = JSON.parse(bundle.stdout) as { summary: { exitCode: number }; results: Array<{ provider: string }> };
    expect(bundleReport.summary.exitCode).toBe(1);
    expect(bundleReport.results).toContainEqual(expect.objectContaining({ provider: "size-limit" }));
  });
});
