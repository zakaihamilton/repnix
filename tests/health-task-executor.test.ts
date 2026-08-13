import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../src/providers/catalog.js";
import type { RepositoryContext } from "../src/core/types.js";
import { commandResult, executeTaskPlan } from "../src/runners/health/task-executor.js";

describe("health task executor", () => {
  it("honors dependencies while using the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const started: string[] = [];
    const result = await executeTaskPlan([
      { id: "lint", async run() { started.push("lint"); active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active--; return "lint"; } },
      { id: "types", async run() { started.push("types"); active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active--; return "types"; } },
      { id: "a11y", dependsOn: "lint", async run(completed) { started.push(`a11y:${completed.get("lint")}`); return "a11y"; } },
    ], 2);

    expect(result).toEqual(["lint", "types", "a11y"]);
    expect(peak).toBe(2);
    expect(started.indexOf("a11y:lint")).toBeGreaterThan(started.indexOf("lint"));
  });

  it("preserves task-plan result order when completion order differs", async () => {
    const result = await executeTaskPlan([
      { id: "slow", async run() { await new Promise((resolve) => setTimeout(resolve, 15)); return "slow"; } },
      { id: "fast", async run() { return "fast"; } },
    ], 2);
    expect(result).toEqual(["slow", "fast"]);
  });

  it("rejects duplicate, missing, and cyclic dependencies before starting work", async () => {
    const run = async () => "done";
    await expect(executeTaskPlan([{ id: "same", run }, { id: "same", run }], 2)).rejects.toThrow("duplicate task id 'same'");
    await expect(executeTaskPlan([{ id: "child", dependsOn: "missing", run }], 2)).rejects.toThrow("depends on missing task 'missing'");
    await expect(executeTaskPlan([{ id: "a", dependsOn: "b", run }, { id: "b", dependsOn: "a", run }], 2)).rejects.toThrow("dependency cycle");
  });

  it("parses markdownlint violations instead of collapsing them into command-failure", () => {
    const markdownlint = PROVIDERS.find((provider) => provider.id === "markdownlint")!;
    const runnable = {
      provider: "markdownlint",
      name: "markdownlint",
      category: "documentation" as const,
      command: "markdownlint-cli2",
      args: markdownlint.command!.args,
    };
    const output = [
      "README.md:8:81 error MD013/line-length Line length [Expected: 80; Actual: 286]",
      "playwright-report/data/report.md:7 error MD025/single-title/single-h1 Multiple top-level headings in the same document [Context: \"Test info\"]",
    ].join("\n");
    const result = commandResult(
      runnable,
      { command: runnable.command, args: runnable.args, exitCode: 1, signal: null, stdout: "", stderr: output, durationMs: 12 },
      { root: "/repo" } as RepositoryContext,
      markdownlint.normalize,
    );

    expect(result.status).toBe("fail");
    expect(result.findings.map((finding) => finding.type)).toEqual(["markdown-style", "markdown-style"]);
    expect(result.findings[0]).toMatchObject({ ruleId: "MD013/line-length", file: "README.md", line: 8, column: 81 });
    expect(markdownlint.command?.args).toEqual(expect.arrayContaining(["**/*.md", "#node_modules", "#playwright-report"]));
  });

  it("keeps command-failure when markdownlint exits without parseable findings", () => {
    const markdownlint = PROVIDERS.find((provider) => provider.id === "markdownlint")!;
    const runnable = {
      provider: "markdownlint",
      name: "markdownlint",
      category: "documentation" as const,
      command: "markdownlint-cli2",
      args: ["**/*.md"],
    };
    const result = commandResult(
      runnable,
      { command: runnable.command, args: runnable.args, exitCode: 1, signal: null, stdout: "", stderr: "Fatal error: configuration is invalid", durationMs: 8 },
      { root: "/repo" } as RepositoryContext,
      markdownlint.normalize,
    );

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ type: "command-failure", severity: "error" });
  });
});
