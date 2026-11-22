import { Text } from "ink";
import type React from "react";
import { CATEGORY_LABELS } from "../../core/health-category.js";
import type { AuditModel } from "../../recommendations/recommendation-engine.js";
import { CheckDetailView, CiDetailView, Panel } from "../setup-components.js";
import { type SetupSelectionItem, type SetupTuiModel, selectionItems } from "../setup-state.js";
import {
  foregroundColor,
  type SetupPaneLayout,
  type SetupTuiTheme,
  SIDEBAR_CONTENT_WIDTH,
  SIDEBAR_WIDTH,
  selectionRowPresentation,
} from "../setup-theme.js";
import { SplitLayout } from "./SplitLayout.js";

function providerFor(items: SetupSelectionItem[], model: SetupTuiModel): SetupSelectionItem | undefined {
  return items[model.cursor];
}

export function SelectView({
  audit,
  model,
  theme,
  paneLayout,
}: {
  audit: AuditModel;
  model: SetupTuiModel;
  theme: SetupTuiTheme;
  paneLayout: SetupPaneLayout;
}): React.ReactElement {
  const items = selectionItems(audit.recommendations, audit.context.hasCI);
  const selected = providerFor(items, model);
  const recommendation =
    selected?.kind === "provider"
      ? audit.recommendations.find((item) => item.provider === selected.provider)
      : undefined;
  const horizontal = paneLayout === "horizontal";
  const focusedSidebar = paneLayout === "focused-sidebar";
  const showSidebar = !focusedSidebar || !model.sidebarCollapsed;
  const showDetails = !focusedSidebar || model.sidebarCollapsed;
  const sidebar = (
    <Panel
      title="Recommended checks"
      width={horizontal ? SIDEBAR_WIDTH : "100%"}
      flexGrow={0}
      flexShrink={0}
      fill={horizontal}
      theme={theme}
      borderColor={theme.borderStrong}
    >
      {items.map((item, index) => {
        const checked = item.kind === "ci" ? model.includeCi : model.selectedProviders.includes(item.provider);
        const active = index === model.cursor;
        const itemRecommendation =
          item.kind === "provider"
            ? audit.recommendations.find((entry) => entry.provider === item.provider)
            : undefined;
        const presentation = selectionRowPresentation(
          item.name,
          checked,
          active,
          itemRecommendation?.priority,
          theme,
          SIDEBAR_CONTENT_WIDTH,
        );
        return (
          <Text
            key={item.kind === "ci" ? item.name : item.provider}
            {...foregroundColor(presentation.color)}
            {...(presentation.backgroundColor ? { backgroundColor: presentation.backgroundColor } : {})}
            bold={presentation.bold}
            wrap="truncate-end"
          >
            {presentation.label}
          </Text>
        );
      })}
      {items.length === 0 ? <Text color={theme.success}>No setup changes are recommended.</Text> : null}
    </Panel>
  );
  const details = (
    <Panel
      width="100%"
      title={
        recommendation
          ? `${recommendation.name} · ${CATEGORY_LABELS[recommendation.category]}`
          : (selected?.name ?? "Setup overview")
      }
      flexGrow={1}
      fill={horizontal}
      theme={theme}
      borderColor={recommendation ? theme.primary : theme.border}
    >
      {recommendation ? (
        <CheckDetailView
          recommendation={recommendation}
          context={audit.context}
          registry={audit.registry}
          theme={theme}
        />
      ) : selected?.kind === "ci" ? (
        <CiDetailView context={audit.context} theme={theme} />
      ) : (
        <Text color={theme.muted}>Select a check to see why it is recommended and what it will add.</Text>
      )}
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
