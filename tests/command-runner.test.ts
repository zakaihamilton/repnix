import { describe, expect, it } from "vitest";
import { createDiagnosticLogger } from "../src/cli/options.js";
import { runCommand } from "../src/runners/command-runner.js";
import { projectRoot } from "./helpers.js";

describe("command runner", () => {
  it("terminates commands that exceed their deadline", async () => {
    const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], {
      cwd: projectRoot,
      timeoutMs: 50,
      logger: createDiagnosticLogger({ quiet: true }),
    });

    expect(result.timedOut).toBe(true);
    expect(result.spawnError).toContain("timed out");
  });
});
