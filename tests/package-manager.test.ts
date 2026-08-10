import { describe, expect, it } from "vitest";
import { execCommand, installDevCommand, runScriptCommand } from "../src/package-manager/package-manager.js";

describe("package manager commands", () => {
  it.each([
    ["npm", ["install", "--save-dev", "knip"]],
    ["pnpm", ["add", "-D", "knip"]],
    ["yarn", ["add", "-D", "knip"]],
    ["bun", ["add", "-d", "knip"]],
  ] as const)("builds %s install commands", (manager, args) => {
    expect(installDevCommand(manager, ["knip"])).toMatchObject({ command: manager, args });
  });

  it("builds local exec and script commands", () => {
    expect(execCommand("npm", "knip", ["--reporter", "json"])).toEqual({ command: "npm", args: ["exec", "--", "knip", "--reporter", "json"] });
    expect(execCommand("bun", "jscpd", ["src"])).toEqual({ command: "bun", args: ["x", "jscpd", "src"] });
    expect(runScriptCommand("pnpm", "test")).toEqual({ command: "pnpm", args: ["run", "test"] });
  });
});
