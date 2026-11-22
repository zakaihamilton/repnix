import { Box, Text } from "ink";
import type React from "react";
import type { HealthResult } from "../../core/types.js";
import {
  checkDetailViewport,
  checkTableColumns,
  clipTuiLine,
  parseHealthRun,
  type SetupCheckDetailStyle,
  setupCheckDetailItems,
  setupCheckRows,
  tuiPanelContentWidth,
} from "../check-results-model.js";
import { Panel, ScrollHint } from "../setup-components.js";
import type { SetupTuiModel } from "../setup-state.js";
import {
  clampTuiScroll,
  foregroundColor,
  type SetupTuiTheme,
  type TuiLayoutMetrics,
  textColor,
} from "../setup-theme.js";

function checkStatusColor(status: HealthResult["status"], theme: SetupTuiTheme): string {
  return status === "pass"
    ? theme.success
    : status === "error"
      ? theme.danger
      : status === "skipped"
        ? theme.muted
        : theme.warning;
}

function checkStatusLabel(status: HealthResult["status"]): string {
  return status === "pass" ? "PASS" : status === "error" ? "ERROR" : status === "skipped" ? "SKIP" : "WARN";
}

function FrozenLine({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Box flexDirection="column" height={1} flexShrink={0} width="100%" overflow="hidden">
      {children}
    </Box>
  );
}

function CheckTableRow({
  columns,
  status,
  check,
  result,
  providers,
  theme,
  header = false,
  statusColor,
}: {
  columns: ReturnType<typeof checkTableColumns>;
  status: string;
  check: string;
  result: string;
  providers: string;
  theme: SetupTuiTheme;
  header?: boolean;
  statusColor?: string;
}): React.ReactElement {
  const statusTone = header ? theme.muted : statusColor;
  return (
    <Box flexDirection="row" height={1} flexShrink={0} width="100%" overflow="hidden">
      <Box width={columns.status} height={1} flexShrink={0} overflow="hidden">
        <Text {...foregroundColor(statusTone)} bold wrap="truncate">
          {clipTuiLine(status, columns.status)}
        </Text>
      </Box>
      <Box width={columns.check} height={1} flexShrink={0} overflow="hidden">
        <Text {...(header ? { color: theme.muted, bold: true } : textColor(theme))} wrap="truncate">
          {clipTuiLine(check, columns.check)}
        </Text>
      </Box>
      <Box width={columns.result} height={1} flexShrink={0} overflow="hidden">
        <Text {...foregroundColor(statusTone)} {...(header ? { bold: true } : {})} wrap="truncate">
          {clipTuiLine(result, columns.result)}
        </Text>
      </Box>
      <Box width={columns.provider} height={1} flexShrink={0} overflow="hidden">
        <Text {...(header ? { color: theme.muted, bold: true } : textColor(theme))} wrap="truncate">
          {clipTuiLine(providers, columns.provider)}
        </Text>
      </Box>
    </Box>
  );
}

function detailItemColor(style: SetupCheckDetailStyle, theme: SetupTuiTheme): string | undefined {
  if (style === "success") return theme.success;
  if (style === "warning") return theme.warning;
  if (style === "danger") return theme.danger;
  if (style === "info") return theme.info;
  if (style === "heading") return theme.secondary;
  if (style === "muted") return theme.muted;
  if (style === "primary") return theme.primary;
  return theme.text;
}

export function CheckDetailsView({
  model,
  width,
  layout,
  theme,
}: {
  model: SetupTuiModel;
  width: number;
  layout: TuiLayoutMetrics;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const extras = {
    ...(model.checkReportPath ? { reportPath: model.checkReportPath } : {}),
    ...(model.checkSummaryPath ? { summaryPath: model.checkSummaryPath } : {}),
    ...(model.checkExitCode !== undefined ? { exitCode: model.checkExitCode } : {}),
  };
  const items = setupCheckDetailItems(model.checkOutput ?? "", width, extras);
  const viewport = checkDetailViewport(layout.detailViewport);
  const scroll = clampTuiScroll(model.checkScroll ?? 0, items.length, viewport);
  const visible = items.slice(scroll, scroll + viewport);
  const hasMore = scroll + visible.length < items.length;
  const columns = checkTableColumns(tuiPanelContentWidth(width));
  const rows = setupCheckRows(model.checkOutput ?? "");
  const run = parseHealthRun(model.checkOutput ?? "");
  const errors = run?.results.filter((result) => result.status === "error") ?? [];
  const passed = model.checkExitCode === 0;
  const borderColor = rows.length
    ? errors.length
      ? theme.warning
      : theme.success
    : passed
      ? theme.success
      : theme.warning;
  return (
    <Panel
      title={rows.length ? "Check results" : "Check results · repnix check"}
      theme={theme}
      borderColor={borderColor}
    >
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        {visible.map((item, index) => {
          const key = `${scroll + index}`;
          if (item.kind === "blank") return <Box key={key} height={1} flexShrink={0} />;
          if (item.kind === "table-header")
            return (
              <CheckTableRow
                key={key}
                columns={columns}
                header
                status="STATUS"
                check="CHECK"
                result="RESULT"
                providers="PROVIDER"
                theme={theme}
              />
            );
          if (item.kind === "table-row")
            return (
              <CheckTableRow
                key={key}
                columns={columns}
                status={checkStatusLabel(item.row.status)}
                check={item.row.category}
                result={item.row.result}
                providers={item.row.providers}
                statusColor={checkStatusColor(item.row.status, theme)}
                theme={theme}
              />
            );
          return (
            <FrozenLine key={key}>
              <Text
                {...foregroundColor(detailItemColor(item.style, theme))}
                {...(item.bold ? { bold: true } : {})}
                wrap="truncate"
              >
                {clipTuiLine(item.text, tuiPanelContentWidth(width))}
              </Text>
            </FrozenLine>
          );
        })}
      </Box>
      <ScrollHint hasMore={hasMore} theme={theme} />
    </Panel>
  );
}
