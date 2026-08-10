import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config/repo-health-config.js";
import { detectAllProviders } from "../src/providers/catalog.js";
import { buildAuditModel } from "../src/recommendations/recommendation-engine.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { fixturePath } from "./helpers.js";

describe("recommendation engine", () => {
  it("recommends the minimal full-provider baseline with reasons", async () => {
    const context = await detectRepository(fixturePath("react-eslint"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, detectAllProviders(context), config);
    expect(model.coverage.find((entry) => entry.category === "lint")).toMatchObject({ status: "covered", providers: ["ESLint"] });
    expect(model.recommendations.map((item) => item.provider)).toEqual(["knip", "jscpd"]);
    expect(model.recommendations.every((item) => item.reason.length > 40)).toBe(true);
  });

  it("credits Biome with both linting and formatting", async () => {
    const context = await detectRepository(fixturePath("next-biome"));
    const { config } = await readConfig(context.root);
    const model = buildAuditModel(context, detectAllProviders(context), config);
    expect(model.coverage.find((entry) => entry.category === "lint")?.status).toBe("covered");
    expect(model.coverage.find((entry) => entry.category === "format")?.status).toBe("covered");
  });
});
