import { Box, Newline, Text } from "ink";
import type React from "react";
import { CATEGORY_LABELS } from "../../core/health-category.js";
import type { AuditModel } from "../../recommendations/recommendation-engine.js";
import { Panel } from "../setup-components.js";
import { auditPageSummary, auditRecommendationSummary, auditSetupOptions } from "../setup-helpers.js";
import { clampTuiScroll, type SetupTuiTheme, textColor } from "../setup-theme.js";

export const AUDIT_LABEL_COLUMN_WIDTH = 25;
export const AUDIT_TWO_COLUMN_MIN_WIDTH = 120;

export function auditUsesSingleColumn(width: number): boolean {
  return width < AUDIT_TWO_COLUMN_MIN_WIDTH;
}

function auditCoverageRow(entry: AuditModel["coverage"][number], theme: SetupTuiTheme): React.ReactElement {
  const status =
    entry.status === "covered"
      ? { symbol: "✓", color: theme.success }
      : entry.status === "partial"
        ? { symbol: "◐", color: theme.warning }
        : entry.status === "missing"
          ? { symbol: "✗", color: theme.danger }
          : entry.status === "off"
            ? { symbol: "–", color: theme.muted }
            : { symbol: "·", color: theme.muted };
  return (
    <Box key={entry.category} flexDirection="row" overflow="hidden">
      <Box width={2} flexShrink={0}>
        <Text color={status.color}>{status.symbol}</Text>
      </Box>
      <Box width={AUDIT_LABEL_COLUMN_WIDTH} flexShrink={0}>
        <Text {...textColor(theme)} wrap="truncate-end">
          {CATEGORY_LABELS[entry.category]}
        </Text>
      </Box>
      {entry.providers.length ? (
        <Text color={status.color} wrap="truncate-end">
          {entry.providers.join(", ")}
        </Text>
      ) : null}
    </Box>
  );
}

export function AuditView({
  audit,
  singleColumn,
  scroll,
  viewport,
  theme,
}: {
  audit: AuditModel;
  singleColumn: boolean;
  scroll: number;
  viewport: number;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const page = auditPageSummary(audit);
  const summary = auditRecommendationSummary(audit.recommendations, true);
  const setupOptions = auditSetupOptions(audit);
  const relevantCoverage = audit.coverage.filter((entry) => entry.status !== "not-applicable");
  const coverageLines = singleColumn
    ? relevantCoverage.map((entry) => auditCoverageRow(entry, theme))
    : Array.from({ length: Math.ceil(relevantCoverage.length / 2) }, (_, index) => (
        <Box key={`coverage-row-${index}`} flexDirection="row" gap={2} overflow="hidden">
          <Box width="50%" flexShrink={0}>
            {relevantCoverage[index] ? auditCoverageRow(relevantCoverage[index]!, theme) : null}
          </Box>
          <Box width="50%" flexShrink={0}>
            {relevantCoverage[index + Math.ceil(relevantCoverage.length / 2)]
              ? auditCoverageRow(relevantCoverage[index + Math.ceil(relevantCoverage.length / 2)]!, theme)
              : null}
          </Box>
        </Box>
      ));
  const lines: React.ReactNode[] = [
    <Text key="repository" {...textColor(theme)}>
      Repository: <Text color={theme.primary}>{page.repositoryName}</Text>
    </Text>,
    <Text key="package-manager" {...textColor(theme)}>
      Package manager: <Text color={theme.primary}>{page.packageManager}</Text> · CI: {page.ci}
    </Text>,
    <Text key="facts" {...textColor(theme)} wrap="truncate-end">
      Roles: {page.roles.join(", ") || "none detected"} · Languages: {page.languages.join(", ") || "none detected"} ·
      Workspaces: {page.workspaceCount}
    </Text>,
    <Newline key="facts-gap" />,
    <Text key="coverage-heading" color={theme.secondary} bold>
      HEALTH COVERAGE
    </Text>,
    ...coverageLines,
    <Newline key="coverage-gap" />,
    <Text key="next-steps-heading" color={theme.secondary} bold>
      NEXT STEPS
    </Text>,
    <Text key="recommendations" {...textColor(theme)}>
      Actionable recommendations: {summary.baseline} baseline · {summary.optional} optional · {summary.advanced}{" "}
      advanced
    </Text>,
    ...(setupOptions.length
      ? [
          <Text key="setup-options" {...textColor(theme)} wrap="wrap">
            Setup options: {setupOptions.join(" · ")}
          </Text>,
        ]
      : []),
    <Text key="prompt" color={setupOptions.length ? theme.primary : theme.success} bold>
      {setupOptions.length
        ? "Press Enter to choose checks and continue setup."
        : "No actionable setup changes were found. Press Enter to finish."}
    </Text>,
  ];
  const start = clampTuiScroll(scroll, lines.length, Math.max(viewport, 1));
  const visible = lines.slice(start, start + Math.max(viewport, 1));
  return (
    <Panel title="Repository audit" theme={theme} borderColor={theme.info}>
      {visible}
      {start + visible.length < lines.length ? <Text color={theme.muted}>↓ more · use ↑↓ to scroll</Text> : null}
    </Panel>
  );
}
