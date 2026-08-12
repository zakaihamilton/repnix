import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AUDIT_LABEL_COLUMN_WIDTH, AUDIT_TWO_COLUMN_MIN_WIDTH, COMPACT_LAYOUT_HEIGHT, COMPACT_LAYOUT_WIDTH, HORIZONTAL_PANE_MIN_WIDTH, auditContentLineCount, auditPageSummary, auditRecommendationSummary, auditSetupOptions, auditStatusPresentation, auditUsesSingleColumn, clampTuiScroll, createSetupTuiTheme, diffLineColor, manualContentLineCount, manualRecommendationLines, manualRecommendationSteps, manualRecommendationViewport, normalizeTuiDiffLine, saveSetupCheckReport, selectedSetupOptions, selectionIndicator, selectionRowPresentation, setupCheckActions, setupCheckDetails, setupCheckOutputLines, setupCheckRows, setupPaneLayout, setupStepIndex, tuiLayoutMetrics } from "../src/tui/setup-app.js";
import { createSetupTuiModel, selectionItems, setupTuiReducer } from "../src/tui/setup-state.js";
import type { AuditModel, Recommendation } from "../src/recommendations/recommendation-engine.js";
import type { RepositoryContext } from "../src/core/types.js";

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

const context: RepositoryContext = {
  root: "/repo",
  packageManager: "pnpm",
  frameworks: [],
  languages: ["TypeScript"],
  kinds: ["typescript"],
  isMonorepo: false,
  packageCount: 1,
  hasCI: true,
  ciProvider: "github-actions",
  packageJson: { name: "example" },
  manifests: [],
  installedPackages: new Map(),
  installedPackageOrigins: new Map(),
  scripts: {},
  files: new Set(["src/index.ts"]),
  sourceFiles: ["src/index.ts", "src/other.ts"],
  sourceRoots: ["src"],
  scopes: [{ path: ".", manifestPath: "package.json", packageJson: { name: "example" }, roles: ["node-app"], roleEvidence: [{ role: "node-app", confidence: "medium", signals: ["test"] }], frameworks: [], languages: ["TypeScript"], sourceFiles: ["src/index.ts", "src/other.ts"], sourceRoots: ["src"] }],
  diagnostics: [],
};

describe("setup TUI presentation", () => {
  it("uses filled square selection indicators", () => {
    expect(selectionIndicator(true)).toBe("■");
    expect(selectionIndicator(false)).toBe("□");
  });

  it("normalizes ANSI-colored diff lines before applying TUI colors", () => {
    const theme = createSetupTuiTheme({ isTTY: false, hasColors: () => false });
    expect(normalizeTuiDiffLine("\u001b[32m+ added line\u001b[39m")).toBe("+ added line");
    expect(normalizeTuiDiffLine("  context line")).toBe("  context line");
    expect(diffLineColor("\u001b[32m  + added line\u001b[39m", theme)).toBe(theme.success);
    expect(diffLineColor("\u001b[31m  - removed line\u001b[39m", theme)).toBe(theme.danger);
    expect(diffLineColor("  context line", theme)).toBe(theme.text);
  });

  it("gives active rows an accent treatment and inactive rows readable text", () => {
    const theme = createSetupTuiTheme({ isTTY: false, hasColors: () => false });
    const active = selectionRowPresentation("Vitest", true, true, "baseline", theme);
    const inactive = selectionRowPresentation("Vitest", false, false, undefined, theme);

    expect(active.label).toMatch(/^▸ ■ Vitest\s+· baseline\s*$/);
    expect(active.label).toHaveLength(30);
    expect(active.color).toBe(theme.primary);
    expect(active.backgroundColor).toBe(theme.active);
    expect(active.bold).toBe(true);
    expect(inactive.label).toMatch(/^\s{2}□ Vitest/);
    expect(inactive.color).toBe(theme.text);
    expect(inactive.backgroundColor).toBeUndefined();
    expect(inactive.bold).toBe(false);

    const longRow = selectionRowPresentation("dependency-cruiser", false, true, "optional", theme, 36);
    expect(longRow.label).toHaveLength(36);
    expect(longRow.label).not.toContain("\n");

    const baseline = selectionRowPresentation("jscpd", false, false, "baseline", theme, 36);
    expect(baseline.label.endsWith("· baseline")).toBe(true);
    expect(longRow.label.endsWith("· optional")).toBe(true);
    expect(baseline.label.indexOf("· baseline")).toBe(longRow.label.indexOf("· optional"));
  });

  it("selects rich colors only when truecolor is available", () => {
    const ansi = createSetupTuiTheme({ isTTY: false, hasColors: () => true });
    const truecolor = createSetupTuiTheme({ isTTY: true, hasColors: () => true }, { COLORFGBG: "15;0" });
    const light = createSetupTuiTheme({ isTTY: true, hasColors: () => true }, { COLORFGBG: "0;15" });

    expect(ansi.primary).toBe("blue");
    expect(ansi.text).toBeUndefined();
    expect(truecolor.primary).toBe("#5eead4");
    expect(light.primary).toBe("#0f766e");
  });

  it("reserves header and footer space for the flexible body", () => {
    expect(tuiLayoutMetrics(24)).toEqual({ bodyHeight: 16, detailViewport: 10 });
    expect(tuiLayoutMetrics(40)).toEqual({ bodyHeight: 32, detailViewport: 26 });
    expect(tuiLayoutMetrics(1)).toEqual({ bodyHeight: 1, detailViewport: 1 });
  });

  it("summarizes the audit page facts, coverage states, and recommendation priorities", () => {
    const audit: AuditModel = {
      context: {
        ...context,
        packageJson: { name: "example-app" },
        packageManager: "pnpm",
        frameworks: ["React"],
        languages: ["TypeScript"],
        hasCI: true,
        packageCount: 3,
        workspaceRoots: [".", "packages/core", "packages/web"],
      },
      detections: new Map(),
      coverage: [
        { category: "types", status: "covered", providers: ["TypeScript"], capabilities: ["typeChecking"], missingCapabilities: [], scopes: ["."], evidence: ["TypeScript source"] },
        { category: "security", status: "missing", providers: [], capabilities: [], missingCapabilities: ["vulnerabilities"], scopes: ["."], evidence: ["source"] },
      ],
      recommendations,
    };
    expect(auditPageSummary(audit)).toMatchObject({ repositoryName: "example-app", packageManager: "pnpm", ci: "GitHub Actions", workspaceCount: 2 });
    expect(auditRecommendationSummary(recommendations)).toEqual({ baseline: 2, optional: 1, advanced: 0, total: 3 });
    expect(auditRecommendationSummary(recommendations, true)).toEqual({ baseline: 1, optional: 1, advanced: 0, total: 2 });
    expect(auditSetupOptions(audit)).toEqual(["jscpd", "dependency-cruiser", "GitHub Actions health step"]);
    const manualLines = manualRecommendationLines(audit, 80);
    expect(manualLines.join("\n")).toContain("1. OSV-Scanner");
    expect(manualLines.join("\n")).toContain("HOW TO DO IT");
    expect(manualLines[1]).toBe("Review the guidance below. Then add the provider and its configuration to your normal development or CI workflow.");
    expect(manualLines[2]).toBe("");
    expect(manualContentLineCount(audit, 80)).toBeGreaterThan(2);
    expect(manualRecommendationViewport(10)).toBe(9);
    expect(manualRecommendationViewport(1)).toBe(1);
    expect(auditContentLineCount(audit, true)).toBe(12);
    expect(auditContentLineCount(audit, false)).toBe(11);
    expect(auditContentLineCount(audit, true, 40)).toBeGreaterThan(auditContentLineCount(audit, true, 80));
    const setupModel = createSetupTuiModel(recommendations);
    setupModel.selectedProviders = ["jscpd", "dependency-cruiser"];
    setupModel.includeCi = true;
    expect(selectedSetupOptions(audit, setupModel)).toEqual(["jscpd", "dependency-cruiser", "GitHub Actions health step"]);
    const theme = createSetupTuiTheme({ isTTY: false, hasColors: () => false });
    expect(auditStatusPresentation("covered", theme)).toMatchObject({ symbol: "✓" });
    expect(auditStatusPresentation("missing", theme)).toMatchObject({ symbol: "✗" });
  });

  it("maps the five setup steps to the correct active header step", () => {
    expect(setupStepIndex("audit")).toBe(0);
    expect(setupStepIndex("manual")).toBe(1);
    expect(setupStepIndex("select")).toBe(2);
    expect(setupStepIndex("review")).toBe(3);
    expect(setupStepIndex("applying")).toBe(4);
    expect(AUDIT_LABEL_COLUMN_WIDTH).toBe(25);
  });

  it("chooses pane layout from terminal aspect ratio and constrained dimensions", () => {
    expect(setupPaneLayout(80, 100)).toBe("vertical");
    expect(setupPaneLayout(174, 45)).toBe("horizontal");
    expect(setupPaneLayout(COMPACT_LAYOUT_WIDTH - 1, COMPACT_LAYOUT_HEIGHT - 1)).toBe("focused-sidebar");
    expect(setupPaneLayout(COMPACT_LAYOUT_WIDTH, COMPACT_LAYOUT_HEIGHT)).toBe("vertical");
    expect(setupPaneLayout(HORIZONTAL_PANE_MIN_WIDTH, 45)).toBe("horizontal");
    expect(setupPaneLayout(HORIZONTAL_PANE_MIN_WIDTH - 1, 45)).toBe("vertical");
    expect(tuiLayoutMetrics(24, true)).toEqual({ bodyHeight: 13, detailViewport: 7 });
    expect(clampTuiScroll(20, 10, 4)).toBe(6);
    expect(clampTuiScroll(20, 3, 4)).toBe(0);
  });

  it("uses one audit coverage column when the terminal is not wide enough", () => {
    expect(auditUsesSingleColumn(AUDIT_TWO_COLUMN_MIN_WIDTH - 1)).toBe(true);
    expect(auditUsesSingleColumn(AUDIT_TWO_COLUMN_MIN_WIDTH)).toBe(false);
  });

  it("builds provider-specific setup details for the selection pane", () => {
    const details = setupCheckDetails(recommendations[0]!, context);

    expect(details.checks[0]).toContain("Repeated code blocks");
    expect(details.scope).toContain("2 source files under src");
    expect(details.setup).toContain("Create .jscpd.json with safe generated/build exclusions.");
    expect(details.command).toBe("pnpm run health:duplication");
  });

  it("explains how an existing architecture config is handled", () => {
    const details = setupCheckDetails(recommendations[1]!, {
      ...context,
      files: new Set(["src/index.ts", ".dependency-cruiser.cjs"]),
    });

    expect(details.setup).toContain("Use the existing .dependency-cruiser.cjs without overwriting it.");
    expect(details.caveat).toContain("Existing rules in .dependency-cruiser.cjs are preserved");
    expect(details.command).toBe("pnpm run health:architecture");
  });

  it("gives manual recommendations concrete project-specific steps", () => {
    const manual = recommendations[2]!;
    const details = setupCheckDetails(manual, context);
    expect(manualRecommendationSteps(manual, details)).toContain("Install the OSV-Scanner binary in your local toolchain or CI image.");
    expect(manualRecommendationSteps(manual, details)).toHaveLength(3);
  });

  it("wraps check details to the setup viewport without discarding output", () => {
    const output = "Repository health\nA deliberately long finding message that must be readable in a narrow terminal viewport.";
    const lines = setupCheckOutputLines(output, 32);

    expect(lines).toContain("Repository health");
    expect(lines.join(" ")).toContain("deliberately long finding message");
    expect(lines.every((line) => line.length <= 26)).toBe(true);
  });

  it("turns structured check output into clear status rows", () => {
    const output = JSON.stringify({
      repository: { categories: [] },
      results: [
        { provider: "typescript", name: "TypeScript", category: "types", status: "pass", findings: [] },
        { provider: "c8", name: "c8", category: "coverage", status: "error", findings: [] },
      ],
    });
    expect(setupCheckRows(output)).toEqual([
      { category: "Type safety", status: "pass", result: "Passed", providers: "TypeScript" },
      { category: "Test coverage", status: "error", result: "Setup needed", providers: "c8" },
    ]);
  });

  it("automatically saves a structured check report in the repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-setup-report-"));
    try {
      const reportPath = await saveSetupCheckReport(root, JSON.stringify({ results: [] }));
      expect(reportPath).toBe(".repnix/health-report.json");
      expect(JSON.parse(await readFile(path.join(root, reportPath!), "utf8"))).toEqual({ results: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("orders setup work before findings and gives each item a command", () => {
    const output = JSON.stringify({
      repository: { packageManager: "yarn", categories: [] },
      results: [
        { provider: "markdownlint", name: "markdownlint", category: "documentation", status: "error", findings: [], message: "Command output exceeded 10485760 bytes" },
        { provider: "script:format:check", name: "script:format:check", category: "format", status: "warn", findings: [{}] },
        { provider: "jscpd", name: "jscpd", category: "duplication", status: "warn", findings: [{}, {}] },
      ],
    });
    expect(setupCheckActions(output)).toEqual([
      expect.objectContaining({ kind: "setup", title: "Set up Documentation", command: "yarn run health:documentation" }),
      expect.objectContaining({ kind: "review", title: "Review Duplication (2 findings)", command: "yarn run health:duplication" }),
      expect.objectContaining({ kind: "review", title: "Review Formatting (1 finding)", command: "yarn run format:check" }),
    ]);
    expect(setupCheckActions(output)[1]?.detail).toBeUndefined();
  });
});

describe("setup TUI state", () => {
  it("starts on the audit page and advances only after an explicit transition", () => {
    let model = createSetupTuiModel(recommendations);
    expect(model.screen).toBe("audit");
    model = setupTuiReducer(model, { type: "begin-selection" });
    expect(model.screen).toBe("select");
  });

  it("keeps recent live check activity while a health check runs", () => {
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "begin-check" });
    model = setupTuiReducer(model, { type: "check-progress", message: "Running TypeScript" });
    model = setupTuiReducer(model, { type: "check-progress", message: "Finished TypeScript" });
    expect(model.checkProgress).toEqual(["Preparing configured checks…", "Running TypeScript", "Finished TypeScript"]);
  });

  it("opens and scrolls the manual recommendations page", () => {
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "begin-manual" });
    expect(model.screen).toBe("manual");
    model = setupTuiReducer(model, { type: "move-manual", direction: "down", lineCount: 20, viewport: 5 });
    expect(model.manualScroll).toBe(1);
    model = setupTuiReducer(model, { type: "back-to-audit" });
    expect(model.screen).toBe("audit");
    expect(model.manualScroll).toBe(0);
  });

  it("shows the empty state after an audit with no actionable recommendations", () => {
    let model = createSetupTuiModel(recommendations.map((recommendation) => ({ ...recommendation, actionable: false })));
    expect(model.screen).toBe("audit");
    model = setupTuiReducer(model, { type: "show-empty" });
    expect(model.screen).toBe("empty");
  });

  it("scrolls the audit page without wrapping past its content", () => {
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "move-audit", direction: "down", lineCount: 29, viewport: 7 });
    expect(model.auditScroll).toBe(1);
    model = setupTuiReducer(model, { type: "move-audit", direction: "up", lineCount: 29, viewport: 7 });
    expect(model.auditScroll).toBe(0);
    for (let index = 0; index < 40; index += 1) {
      model = setupTuiReducer(model, { type: "move-audit", direction: "down", lineCount: 29, viewport: 7 });
    }
    expect(model.auditScroll).toBe(22);
  });

  it("returns from selection to audit before allowing setup to exit", () => {
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "begin-selection" });
    model = setupTuiReducer(model, { type: "back-to-audit" });
    expect(model.screen).toBe("audit");
  });

  it("toggles the compact navigation sidebar and resets it for each selection or review page", () => {
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "begin-selection" });
    model = setupTuiReducer(model, { type: "toggle-sidebar" });
    expect(model.sidebarCollapsed).toBe(true);
    model = setupTuiReducer(model, { type: "begin-planning" });
    model = setupTuiReducer(model, { type: "planning-complete" });
    expect(model.sidebarCollapsed).toBe(false);
  });

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
    expect(model.confirmFocus).toBe("cancel");
    model = setupTuiReducer(model, { type: "move-confirm", direction: "right" });
    expect(model.confirmFocus).toBe("apply");
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

  it("runs a detailed check after setup and scrolls its output", () => {
    let model = createSetupTuiModel(recommendations);
    model = setupTuiReducer(model, { type: "complete" });
    model = setupTuiReducer(model, { type: "begin-check" });
    expect(model.screen).toBe("checking");
    model = setupTuiReducer(model, { type: "check-complete", output: "first\nsecond\nthird", exitCode: 1 });
    expect(model.screen).toBe("check-details");
    model = setupTuiReducer(model, { type: "move-check", direction: "down", lineCount: 3, viewport: 2 });
    expect(model.checkScroll).toBe(1);
    model = setupTuiReducer(model, { type: "back-to-success" });
    expect(model.screen).toBe("success");
  });
});
