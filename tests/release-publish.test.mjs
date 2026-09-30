import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for("nodejs.util.promisify.custom")]: vi.fn() }),
}));

const exec = execFile[promisify.custom];
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

beforeEach(() => {
  vi.resetModules();
  exec.mockReset();
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("release publishing", () => {
  it("skips publishing a version that already exists in the registry", async () => {
    exec.mockResolvedValueOnce({ stdout: `${JSON.stringify(version)}\n`, stderr: "" });
    await import("../.github/release-publish.mjs");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining("already published"));
  });

  it("publishes when the registry reports that the version does not exist", async () => {
    exec.mockRejectedValueOnce(Object.assign(new Error("not found"), { stderr: "npm error E404" }));
    exec.mockResolvedValueOnce({ stdout: "published\n", stderr: "" });
    await import("../.github/release-publish.mjs");
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenLastCalledWith("npm", ["publish"], expect.any(Object));
  });

  it("does not publish after a registry error or malformed response", async () => {
    exec.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(import("../.github/release-publish.mjs")).rejects.toThrow("network unavailable");
    expect(exec).toHaveBeenCalledTimes(1);

    vi.resetModules();
    exec.mockReset().mockResolvedValueOnce({ stdout: "not JSON", stderr: "" });
    await expect(import("../.github/release-publish.mjs")).rejects.toThrow(SyntaxError);
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
