import { describe, expect, it } from "vitest";
import { isNonMutatingQualityCommand, matchesScriptPattern, scriptCommandVariants } from "../src/repository/script-detection.js";

describe("quality script detection", () => {
  it("accepts common check commands", () => {
    expect(isNonMutatingQualityCommand("eslint .")).toBe(true);
    expect(isNonMutatingQualityCommand("npm run lint && tsc --noEmit")).toBe(true);
    expect(isNonMutatingQualityCommand("node scripts/release-check.mjs")).toBe(true);
  });

  it("rejects commands that can mutate or publish a repository", () => {
    expect(isNonMutatingQualityCommand("eslint . --fix")).toBe(false);
    expect(isNonMutatingQualityCommand("npm install && eslint .")).toBe(false);
    expect(isNonMutatingQualityCommand("npm run deploy")).toBe(false);
  });

  it("normalizes shell and package-manager command wrappers", () => {
    expect(scriptCommandVariants("corepack pnpm exec eslint .")).toContain("eslint .");
    expect(matchesScriptPattern("corepack pnpm exec eslint .", /(^|\s)eslint(?:\s|$)/)).toBe(true);
  });
});
