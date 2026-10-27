import { describe, expect, it, vi } from "vitest";
import { createDiagnosticLogger } from "../src/cli/options.js";
import { runCommand } from "../src/runners/command-runner.js";
import { projectRoot } from "./helpers.js";

describe("command runner", () => {
  it("redacts credentials split across provider output chunks", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runCommand(
        process.execPath,
        [
          "-e",
          "process.stdout.write('Bearer '); setTimeout(() => process.stdout.write(process.env.TEST_REPNIX_SECRET), 30)",
        ],
        {
          cwd: projectRoot,
          logger: createDiagnosticLogger({ verbose: true }),
          env: { TEST_REPNIX_SECRET: "secretvalue" },
        },
      );
      const output = write.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(output).toContain("Bearer [REDACTED]");
      expect(output).not.toContain("secretvalue");
    } finally {
      write.mockRestore();
    }
  });

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
