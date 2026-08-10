import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyFixture, projectRoot } from "./helpers.js";

const temporary: string[] = [];

async function runCli(root: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(projectRoot, "dist", "cli.js"), ...args], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
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
});
