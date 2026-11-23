import { Box, Newline, Text } from "ink";
import type React from "react";
import type { InstallPlan } from "../../core/types.js";
import type { AuditModel } from "../../recommendations/recommendation-engine.js";
import { ConfirmButton, Panel, planStats, ReviewNotes } from "../setup-components.js";
import { selectedSetupOptions } from "../setup-helpers.js";
import type { SetupTuiModel } from "../setup-state.js";
import { type SetupTuiTheme, textColor } from "../setup-theme.js";

export function ApplyView({
  plan,
  model,
  theme,
}: {
  plan: InstallPlan;
  model: SetupTuiModel;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const activity = model.progressLog ?? [model.progress ?? "Starting safe apply…"];
  return (
    <Panel title="Applying safely" theme={theme} borderColor={theme.warning}>
      <Text color={theme.warning}>◌ Changes are being revalidated and applied in the reviewed order.</Text>
      <Text color={theme.muted}>
        {planStats(plan)} · {plan.commands.length} install command
        {plan.commands.length === 1 ? "" : "s"}
      </Text>
      <Newline />
      <Text color={theme.secondary} bold>
        ACTIVITY
      </Text>
      {activity.map((message, index) => (
        <Text key={`${index}-${message}`} color={index === activity.length - 1 ? theme.primary : theme.muted}>
          {index === activity.length - 1 ? "▸" : "·"} {message}
        </Text>
      ))}
    </Panel>
  );
}

export function ConfirmView({
  audit,
  plan,
  model,
  theme,
}: {
  audit: AuditModel;
  plan: InstallPlan;
  model: SetupTuiModel;
  theme: SetupTuiTheme;
}): React.ReactElement {
  const selectedOptions = selectedSetupOptions(audit, model);
  return (
    <Panel title="Confirm setup" theme={theme} borderColor={theme.warning}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
        <Text color={theme.warning} bold>
          ◆ Apply these reviewed changes?
        </Text>
        <Newline />
        <Text color={theme.primary} bold>
          {planStats(plan)}
        </Text>
        <Newline />
        <Text color={theme.secondary} bold>
          SELECTED OPTIONS
        </Text>
        {selectedOptions.length ? (
          selectedOptions.map((option) => (
            <Text key={option} {...textColor(theme)}>
              {" "}
              + {option}
            </Text>
          ))
        ) : (
          <Text color={theme.muted}> No setup options selected.</Text>
        )}
        <Newline />
        <Text color={theme.secondary} bold>
          REVIEW NOTES
        </Text>
        <ReviewNotes plan={plan} theme={theme} />
      </Box>
      <Box flexDirection="row" gap={1} flexShrink={0}>
        <ConfirmButton label="CANCEL" focused={model.confirmFocus === "cancel"} theme={theme} />
        <ConfirmButton label="APPLY" focused={model.confirmFocus === "apply"} theme={theme} />
      </Box>
      <Box flexShrink={0}>
        <Text color={theme.muted}>Use the arrow keys to choose an action, then press Enter.</Text>
      </Box>
    </Panel>
  );
}
