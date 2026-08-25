import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config/repo-health-config.js";
import { detectAllProviders } from "../src/providers/catalog.js";
import { createBuiltinRegistry, ProviderRegistry } from "../src/providers/registry.js";
import { defineProvider } from "../src/providers/sdk.js";
import { buildAuditModel } from "../src/recommendations/recommendation-engine.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { fixturePath } from "./helpers.js";

describe("recommendation engine", () => {
  it("recommends a minimal actionable baseline and repository-specific optional coverage", async () => {
    const context = await detectRepository(fixturePath("react-eslint"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.coverage.find((entry) => entry.category === "lint")).toMatchObject({
      status: "covered",
      providers: ["ESLint"],
    });
    expect(
      model.recommendations
        .filter((item) => item.actionable && item.priority === "baseline")
        .map((item) => item.provider),
    ).toEqual(["knip", "jscpd", "c8"]);
    expect(model.recommendations.map((item) => item.provider)).toEqual([
      "knip",
      "jscpd",
      "osv-scanner",
      "eslint-boundaries",
      "c8",
      "stryker",
      "gitleaks",
      "license-checker",
    ]);
    expect(context.scopes[0]?.roles).toEqual(["node-app"]);
    expect(model.recommendations.some((item) => ["size-limit", "jsx-a11y", "lhci"].includes(item.provider))).toBe(
      false,
    );
    expect(model.recommendations.find((item) => item.provider === "eslint-boundaries")).toMatchObject({
      priority: "optional",
      actionable: false,
    });
    expect(model.recommendations.every((item) => item.reason.length > 40)).toBe(true);
  });

  it("prefers dependency-cruiser when ESLint architecture rules are unavailable", async () => {
    const context = await detectRepository(fixturePath("minimal-js"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.recommendations.find((item) => item.provider === "dependency-cruiser")).toMatchObject({
      priority: "optional",
      actionable: true,
    });
    expect(model.recommendations.some((item) => item.provider === "eslint-boundaries")).toBe(false);
  });

  it("credits Biome with both linting and formatting", async () => {
    const context = await detectRepository(fixturePath("next-biome"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.coverage.find((entry) => entry.category === "lint")?.status).toBe("covered");
    expect(model.coverage.find((entry) => entry.category === "format")?.status).toBe("covered");
  });

  it("recommends complementary package-health checks for typed npm libraries", async () => {
    const context = await detectRepository(fixturePath("npm-library"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.coverage.find((entry) => entry.category === "package-health")).toMatchObject({
      status: "missing",
      missingCapabilities: ["packagePublishing", "typesCompatibility"],
    });
    expect(
      model.recommendations.filter((item) => item.category === "package-health").map((item) => item.provider),
    ).toEqual(["publint", "attw"]);
    expect(model.recommendations.find((item) => item.provider === "attw")?.reason).toContain("package.json#types");
  });

  it("treats one of two typed-package capabilities as partial coverage", async () => {
    const context = await detectRepository(fixturePath("npm-library"));
    context.installedPackages.set("publint", "^0.3.23");
    context.installedPackageOrigins.set("publint", ["package.json"]);
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.coverage.find((entry) => entry.category === "package-health")).toMatchObject({
      status: "partial",
      providers: ["Publint"],
      missingCapabilities: ["typesCompatibility"],
    });
    expect(
      model.recommendations.filter((item) => item.category === "package-health").map((item) => item.provider),
    ).toEqual(["attw"]);
  });

  it("only automates Changesets when the Git remote default branch is known", async () => {
    const context = await detectRepository(fixturePath("npm-library"));
    const { config } = await readConfig(context.root);
    let model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.recommendations.find((item) => item.provider === "changesets")).toMatchObject({ actionable: false });

    context.gitDefaultBranch = "main";
    model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.recommendations.find((item) => item.provider === "changesets")).toMatchObject({
      actionable: true,
      priority: "optional",
    });
  });

  it("uses provider.recommend from the registry", async () => {
    const context = await detectRepository(fixturePath("minimal-js"));
    const { config } = await readConfig(context.root);
    const builtin = createBuiltinRegistry();
    const provider = defineProvider({
      id: "synthetic-recommend",
      name: "Synthetic Recommend",
      category: "synthetic-health",
      packages: [],
      configPatterns: [],
      scriptPattern: /synthetic-recommend/,
      capabilities: { syntheticCheck: true },
      recommendOrder: 5,
      recommend: () => ({
        recommended: true,
        priority: "baseline",
        actionable: true,
        reason: "Synthetic coverage is missing from this repository on purpose for the registry hook test.",
      }),
    });
    const registry = new ProviderRegistry(
      [...builtin.providers, provider],
      [
        ...builtin.categories,
        {
          id: "synthetic-health",
          label: "Synthetic health",
          description: "Test-only category",
          requiredCapabilities: ["syntheticCheck"],
          applicable: () => ({ applicable: true, scopes: ["."], evidence: ["test"] }),
        },
      ],
    );
    const model = buildAuditModel(context, await detectAllProviders(context, registry.providers), config, registry);
    expect(model.recommendations[0]).toMatchObject({
      provider: "synthetic-recommend",
      name: "Synthetic Recommend",
      category: "synthetic-health",
      priority: "baseline",
      actionable: true,
    });
    expect(model.recommendations.map((item) => item.provider)).toContain("knip");
  });
});
