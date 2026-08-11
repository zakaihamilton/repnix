import { describe, expect, it } from "vitest";
import {
  createSetupTuiModel,
  selectionItems,
  setupTuiReducer,
} from "../src/tui/setup-state.js";
import type { Recommendation } from "../src/recommendations/recommendation-engine.js";

const recommendations: Recommendation[] = [
  {
    provider: "jscpd",
    name: "jscpd",
    category: "duplication",
    recommended: true,
    priority: "baseline",
    actionable: true,
    reason: "Find repeated code.",
  },
  {
    provider: "dependency-cruiser",
    name: "dependency-cruiser",
    category: "architecture",
    recommended: true,
    priority: "optional",
    actionable: true,
    reason: "Find dependency cycles.",
  },
  {
    provider: "osv-scanner",
    name: "OSV-Scanner",
    category: "security",
    recommended: true,
    priority: "baseline",
    actionable: false,
    reason: "Needs manual preparation.",
  },
];

describe("setup TUI state", () => {
  it("selects baseline actionable providers by default and appends CI when available", () => {
    const model = createSetupTuiModel(recommendations);
    const items = selectionItems(recommendations, true);

    expect(model.selectedProviders).toEqual(["jscpd"]);
    expect(items.map((item) => item.name)).toEqual(["jscpd", "dependency-cruiser", "GitHub Actions health step"]);
    expect(model.includeCi).toBe(false);
  });

  it("toggles providers and CI independently", () => {
    const items = selectionItems(recommendations, true);
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "toggle", item: items[1]! });
    model = setupTuiReducer(model, { type: "toggle", item: items[2]! });

    expect(model.selectedProviders).toEqual(["jscpd", "dependency-cruiser"]);
    expect(model.includeCi).toBe(true);
  });

  it("keeps review and apply behind explicit transitions", () => {
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "begin-planning" });
    expect(model.screen).toBe("planning");
    model = setupTuiReducer(model, { type: "planning-complete" });
    expect(model.screen).toBe("review");
    model = setupTuiReducer(model, { type: "begin-confirm" });
    expect(model.screen).toBe("confirm");
    model = setupTuiReducer(model, { type: "cancel-confirm" });
    expect(model.screen).toBe("review");
    model = setupTuiReducer(model, { type: "begin-confirm" });
    model = setupTuiReducer(model, { type: "begin-applying" });
    expect(model.screen).toBe("applying");
  });

  it("clamps detail scrolling instead of wrapping around", () => {
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "open-details" });
    model = setupTuiReducer(model, { type: "move-detail", direction: "up", lineCount: 10, viewport: 4 });
    expect(model.detailScroll).toBe(0);
    model = setupTuiReducer(model, { type: "move-detail", direction: "down", lineCount: 10, viewport: 4 });
    expect(model.detailScroll).toBe(1);
    for (let index = 0; index < 20; index += 1) {
      model = setupTuiReducer(model, { type: "move-detail", direction: "down", lineCount: 10, viewport: 4 });
    }
    expect(model.detailScroll).toBe(6);
  });
});
