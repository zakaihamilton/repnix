import { describe, expect, it } from "vitest";
import { createProviderAdapters } from "../src/providers/provider-adapter.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { fixturePath } from "./helpers.js";

describe("provider adapter contract", () => {
  it("exposes every external tool through the common interface", async () => {
    const context = await detectRepository(fixturePath("react-eslint"));
    const providers = createProviderAdapters();
    expect(providers.map((provider) => provider.id)).toEqual([
      "typescript",
      "eslint",
      "oxlint",
      "biome",
      "prettier",
      "oxfmt",
      "jest",
      "vitest",
      "test-script",
      "c8",
      "stryker",
      "knip",
      "jscpd",
      "osv-scanner",
      "codeql",
      "semgrep-code",
      "semgrep-supply-chain",
      "semgrep-secrets",
      "socket",
      "sonarqube-cloud",
      "dependabot",
      "jsx-a11y",
      "eslint-boundaries",
      "dependency-cruiser",
      "size-limit",
      "syncpack",
      "gitleaks",
      "license-checker",
      "markdownlint",
      "lhci",
      "changesets",
      "actionlint",
      "publint",
      "attw",
    ]);
    const eslint = providers.find((provider) => provider.id === "eslint")!;
    expect(await eslint.detect(context)).toMatchObject({ installed: true, configured: true });
    expect(await eslint.run(context)).toMatchObject({ status: "skipped", message: "Detection-only provider." });
  });
});
