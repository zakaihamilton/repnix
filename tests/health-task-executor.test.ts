import { describe, expect, it } from "vitest";
import { executeTaskPlan } from "../src/runners/health/task-executor.js";

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
});
