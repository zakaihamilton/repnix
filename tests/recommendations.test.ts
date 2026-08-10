import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config/repo-health-config.js";
import { detectAllProviders } from "../src/providers/catalog.js";
import { buildAuditModel } from "../src/recommendations/recommendation-engine.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { fixturePath } from "./helpers.js";

describe("recommendation engine", () => {
  it("recommends a minimal actionable baseline and repository-specific optional coverage", async () => {
    const context = await detectRepository(fixturePath("react-eslint"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.coverage.find((entry) => entry.category === "lint")).toMatchObject({ status: "covered", providers: ["ESLint"] });
    expect(model.recommendations.filter((item) => item.actionable && item.priority === "baseline").map((item) => item.provider)).toEqual(["knip", "jscpd"]);
    expect(model.recommendations.map((item) => item.provider)).toEqual(["knip", "jscpd", "osv-scanner", "eslint-boundaries", "size-limit"]);
    expect(model.recommendations.find((item) => item.provider === "eslint-boundaries")).toMatchObject({ priority: "optional", actionable: false });
    expect(model.recommendations.every((item) => item.reason.length > 40)).toBe(true);
  });

  it("prefers dependency-cruiser when ESLint architecture rules are unavailable", async () => {
    const context = await detectRepository(fixturePath("minimal-js"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.recommendations.find((item) => item.provider === "dependency-cruiser")).toMatchObject({ priority: "optional", actionable: true });
    expect(model.recommendations.some((item) => item.provider === "eslint-boundaries")).toBe(false);
  });

  it("credits Biome with both linting and formatting", async () => {
    const context = await detectRepository(fixturePath("next-biome"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, await detectAllProviders(context), config);
    expect(model.coverage.find((entry) => entry.category === "lint")?.status).toBe("covered");
    expect(model.coverage.find((entry) => entry.category === "format")?.status).toBe("covered");
  });
});
