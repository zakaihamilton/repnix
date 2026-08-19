import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import React from "react";
import { Box, renderToString } from "ink";
import { CheckDetailsView } from "../src/tui/setup-views.js";
import { Footer, Header } from "../src/tui/setup-components.js";
import { createSetupTuiTheme, tuiLayoutMetrics } from "../src/tui/setup-theme.js";
import type { SetupTuiModel } from "../src/tui/setup-state.js";

function checkModel(findings = 133): SetupTuiModel {
  const output = JSON.stringify({
    repository: { packageManager: "yarn", categories: [] },
    results: [
      { provider: "typescript", name: "TypeScript", category: "types", status: "pass", findings: [] },
      { provider: "script:lint", name: "Lint", category: "lint", status: "fail", findings: Array.from({ length: 40 }, () => ({ id: "x" })) },
      { provider: "knip", name: "knip", category: "dead-code", status: "warn", findings: Array.from({ length: 50 }, () => ({ id: "x" })) },
      { provider: "jscpd", name: "jscpd", category: "duplication", status: "warn", findings: Array.from({ length: findings - 90 }, () => ({ id: "x" })) },
    ],
  });
  return {
    screen: "check-details",
    cursor: 0,
    auditScroll: 0,
    manualScroll: 0,
    reviewCursor: 0,
    detailScroll: 0,
    confirmFocus: "cancel",
    selectedProviders: [],
    includeCi: false,
    sidebarCollapsed: false,
    checkOutput: output,
    checkExitCode: 1,
    checkScroll: 0,
    checkReportPath: ".repnix/health-report.md",
    checkSummaryPath: ".repnix/check-results.md",
  };
}

function screenshotModel(): SetupTuiModel {
  const output = JSON.stringify({
    repository: { packageManager: "yarn", categories: [] },
    results: [
      { provider: "typescript", name: "TypeScript", category: "types", status: "pass", findings: [] },
      { provider: "script:lint", name: "script:lint", category: "lint", status: "warn", findings: Array.from({ length: 26 }, () => ({ id: "x" })) },
      { provider: "vitest", name: "Vitest", category: "tests", status: "pass", findings: [] },
      { provider: "c8", name: "c8", category: "coverage", status: "pass", findings: [] },
      { provider: "markdownlint", name: "markdownlint", category: "documentation", status: "error", findings: [], message: "unavailable" },
      { provider: "knip", name: "knip", category: "dead-code", status: "warn", findings: Array.from({ length: 10 }, () => ({ id: "x" })) },
      { provider: "jscpd", name: "jscpd", category: "duplication", status: "warn", findings: Array.from({ length: 5 }, () => ({ id: "x" })) },
    ],
  });
  return { ...checkModel(), checkOutput: output };
}

function renderCheckScreen(width: number, height: number, compact = true, model: SetupTuiModel = checkModel()): string {
  const theme = createSetupTuiTheme({ isTTY: false, hasColors: () => false });
  const layout = tuiLayoutMetrics(height, compact);
  return renderToString(
    <Box flexDirection="column" width={width} height={height} paddingX={1} overflow="hidden">
      <Header model={model} repositoryName="genesis-protocol" packageManager="yarn" compact={compact} theme={theme} />
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        <CheckDetailsView model={model} width={width} layout={layout} theme={theme} />
      </Box>
      <Footer model={model} sidebarMode={false} theme={theme} />
    </Box>,
    { columns: width },
  );
}

describe("setup TUI narrow layout", () => {
  it.each([60, 70, 80, 90, 100])("does not overlay check-result rows at %i columns", (width) => {
    const rendered = renderCheckScreen(width, 24);
    const lines = rendered.split("\n").map((line) => stripVTControlCharacters(line));
    const overflow = lines
      .map((line, index) => ({ index, length: line.length, line }))
      .filter((entry) => entry.length > width);

    expect(overflow, overflow.map((entry) => `${entry.index}:${entry.line}`).join("\n")).toEqual([]);
    expect(lines.some((line) => line.includes("Lintingfety"))).toBe(false);
    expect(lines.some((line) => line.includes("Passeddings"))).toBe(false);
    expect(lines.filter((line) => /yarn run lint/.test(line) && /findings\)/.test(line))).toEqual([]);
    expect(lines.filter((line) => /health:dead-code/.test(line) && /gs\)/.test(line))).toEqual([]);
    expect(lines.join("\n")).not.toMatch(/╰─\s+\S/);
    expect(lines.some((line) => /Type saf/.test(line))).toBe(true);
    expect(lines.some((line) => /Linting/.test(line))).toBe(true);
  });

  it("does not leak finding counts onto next-step commands", () => {
    const lines = renderCheckScreen(159, 34, false, screenshotModel()).split("\n").map((line) => stripVTControlCharacters(line));
    const commands = lines.filter((line) => /\$ yarn run /.test(line));
    expect(commands.length).toBeGreaterThan(0);
    for (const line of commands) {
      expect(line).not.toMatch(/findings\)/);
      expect(line).not.toMatch(/codegs\)/);
      expect(line).not.toMatch(/duplications\)/);
      expect(line).toMatch(/\$ yarn run \S+\s+│/);
    }
    expect(lines.some((line) => /WARN/.test(line) && /Linting/.test(line) && /26 findings/.test(line))).toBe(true);
    expect(lines.filter((line) => /\$ yarn run /.test(line) && /findings/.test(line))).toEqual([]);
  });

  it("keeps table rows and next-step commands on separate lines in a typical window", () => {
    const lines = renderCheckScreen(90, 40).split("\n").map((line) => stripVTControlCharacters(line));
    expect(lines.find((line) => line.includes("Type safety"))).toMatch(/PASS\s+Type safety\s+Passed/);
    expect(lines.find((line) => line.includes("Linting") && line.includes("WARN"))).toMatch(/WARN\s+Linting\s+40 findings/);
    expect(lines.find((line) => /\$ yarn run lint/.test(line))).toMatch(/yarn run lint\s+│/);
    expect(lines.find((line) => /health:dead-code/.test(line))).toMatch(/health:dead-code\s+│/);
    expect(lines.filter((line) => /findings\)/.test(line) && /yarn run/.test(line))).toEqual([]);
  });
});
