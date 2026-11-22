import { Newline, Text } from "ink";
import type React from "react";
import type { InstallPlan } from "../../core/types.js";
import { renderFileDiff } from "../../setup/file-plan.js";
import { Panel, planStats, ReviewNotes } from "../setup-components.js";
import type { SetupTuiModel } from "../setup-state.js";
import {
  clampTuiScroll,
  diffLineColor,
  foregroundColor,
  normalizeTuiDiffLine,
  type SetupPaneLayout,
  type SetupTuiTheme,
  SIDEBAR_WIDTH,
  type TuiLayoutMetrics,
  textColor,
} from "../setup-theme.js";
import { SplitLayout } from "./SplitLayout.js";

export function ReviewView({
  plan,
  model,
  theme,
  paneLayout,
}: {
  plan: InstallPlan;
  model: SetupTuiModel;
  theme: SetupTuiTheme;
  paneLayout: SetupPaneLayout;
}): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  const horizontal = paneLayout === "horizontal";
  const focusedSidebar = paneLayout === "focused-sidebar";
  const showSidebar = !focusedSidebar || !model.sidebarCollapsed;
  const showDetails = !focusedSidebar || model.sidebarCollapsed;
  const sidebar = (
    <Panel
      title="Planned changes"
      width={horizontal ? SIDEBAR_WIDTH : "100%"}
      flexGrow={0}
      flexShrink={0}
      fill={horizontal}
      theme={theme}
      borderColor={theme.borderStrong}
    >
      <Text color={theme.primary} bold>
        {planStats(plan)}
      </Text>
      <Newline />
      <Text color={theme.secondary} bold>
        PACKAGES
      </Text>
      {plan.packages.length ? (
        plan.packages.map((item) => (
          <Text key={item.name} {...textColor(theme)}>
            {" "}
            + {item.name}
            {item.version ? `@${item.version}` : ""}
          </Text>
        ))
      ) : (
        <Text color={theme.muted}> none</Text>
      )}
      <Newline />
      <Text color={theme.secondary} bold>
        FILES
      </Text>
      {plan.files.length ? (
        plan.files.map((item, index) => (
          <Text
            key={item.path}
            {...(index === model.reviewCursor
              ? { color: theme.primary, backgroundColor: theme.active }
              : textColor(theme))}
            bold={index === model.reviewCursor}
          >{`${index === model.reviewCursor ? "▸" : " "} ${item.kind === "create" ? "A" : "M"} ${item.path}`}</Text>
        ))
      ) : (
        <Text color={theme.muted}> none</Text>
      )}
      {plan.warnings.length ? (
        <>
          <Newline />
          <Text color={theme.warning}>◆ Warnings: {plan.warnings.length}</Text>
        </>
      ) : null}
      {plan.conflicts.length ? <Text color={theme.warning}>◆ Conflicts preserved: {plan.conflicts.length}</Text> : null}
    </Panel>
  );
  const details = (
    <Panel
      width="100%"
      title={file ? `Detail · ${file.path}` : "Review summary"}
      flexGrow={1}
      fill={horizontal}
      theme={theme}
      borderColor={plan.warnings.length || plan.conflicts.length ? theme.warning : theme.border}
    >
      {file ? (
        <>
          <Text color={theme.muted}>{file.reason}</Text>
          <Newline />
          <Text color={theme.info}>Press Space to inspect this file.</Text>
        </>
      ) : (
        <Text color={theme.muted}>No file changes are planned. Press Enter to continue.</Text>
      )}
      {plan.commands.length ? (
        <>
          <Newline />
          <Text color={theme.secondary} bold>
            COMMANDS
          </Text>
          {plan.commands.map((command) => (
            <Text
              key={command.command}
              {...textColor(theme)}
            >{`  $ ${command.command} ${command.args.join(" ")}`}</Text>
          ))}
        </>
      ) : null}
      <Newline />
      <Text color={theme.secondary} bold>
        REVIEW NOTES
      </Text>
      <ReviewNotes plan={plan} theme={theme} />
    </Panel>
  );
  return (
    <SplitLayout
      horizontal={horizontal}
      showSidebar={showSidebar}
      sidebar={sidebar}
      showDetails={showDetails}
      details={details}
    />
  );
}

export function DetailsView({
  plan,
  model,
  width,
  layout,
  theme,
}: {
  plan: InstallPlan;
  model: SetupTuiModel;
  width: number;
  layout: TuiLayoutMetrics;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const file = plan.files[model.reviewCursor];
  if (!file)
    return (
      <Panel title="Details" theme={theme}>
        <Text color={theme.muted}>There are no file details to show.</Text>
      </Panel>
    );
  const diff = renderFileDiff(file, Math.max(width - 8, 32))
    .split("\n")
    .map(normalizeTuiDiffLine);
  const scroll = clampTuiScroll(model.detailScroll, diff.length, layout.detailViewport);
  const visible = diff.slice(scroll, scroll + layout.detailViewport);
  return (
    <Panel title={`File detail · ${file.path}`} theme={theme} borderColor={theme.info}>
      <Text color={theme.muted}>{file.reason}</Text>
      <Newline />
      {visible.map((line, index) => (
        <Text key={`${index}-${line}`} {...foregroundColor(diffLineColor(line, theme))}>
          {line}
        </Text>
      ))}
      {scroll + visible.length < diff.length ? <Text color={theme.muted}>↓ more</Text> : null}
    </Panel>
  );
}
