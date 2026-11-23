import { Box, Newline, Text } from "ink";
import type React from "react";
import type { AuditModel } from "../../recommendations/recommendation-engine.js";
import { Panel, ScrollHint } from "../setup-components.js";
import { manualRecommendationLines, manualRecommendationViewport } from "../setup-helpers.js";
import { clampTuiScroll, type SetupTuiTheme, textColor } from "../setup-theme.js";

export function ManualRecommendationsView({
  audit,
  scroll,
  viewport,
  width,
  theme,
}: {
  audit: AuditModel;
  scroll: number;
  viewport: number;
  width: number;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const lines = manualRecommendationLines(audit, Math.max(width - 6, 20));
  const contentViewport = manualRecommendationViewport(viewport);
  const start = clampTuiScroll(scroll, lines.length, contentViewport);
  const visible = lines.slice(start, start + contentViewport);
  const hasMore = start + visible.length < lines.length;
  return (
    <Panel
      title={`Manual recommendations (${audit.recommendations.filter((recommendation) => !recommendation.actionable).length})`}
      theme={theme}
      borderColor={theme.warning}
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {visible.map((line, index) =>
          line === "" ? (
            <Newline key={`${start + index}-blank`} />
          ) : (
            <Text
              key={`${start + index}-${line}`}
              {...(line.includes("HOW TO DO IT")
                ? { color: theme.secondary, bold: true }
                : line.match(/ · (baseline|optional|advanced)$/)
                  ? { color: theme.warning, bold: true }
                  : textColor(theme))}
            >
              {line}
            </Text>
          ),
        )}
      </Box>
      <ScrollHint hasMore={hasMore} theme={theme} />
    </Panel>
  );
}
