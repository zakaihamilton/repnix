import { useInput } from "ink";
import type { InstallPlan } from "../core/types.js";
import type { AuditModel } from "../recommendations/recommendation-engine.js";
import { manualRecommendationViewport } from "./setup-helpers.js";
import type { SetupSelectionItem, SetupTuiModel, setupTuiReducer } from "./setup-state.js";

export interface UseSetupInputOptions {
  model: SetupTuiModel;
  audit: AuditModel | undefined;
  plan: InstallPlan | undefined;
  items: SetupSelectionItem[];
  dispatch: (action: Parameters<typeof setupTuiReducer>[1]) => void;
  sidebarMode: boolean;
  busy: boolean;
  auditLineCount: number;
  manualLineCount: number;
  detailLineCount: number;
  checkLineCount: number;
  detailViewport: number;
  checkViewport: number;
  leave: () => void;
}

/** Handle keyboard navigation and screen transitions for the interactive setup TUI. */
export function useSetupInput({
  model,
  audit,
  plan,
  items,
  dispatch,
  sidebarMode,
  busy,
  auditLineCount,
  manualLineCount,
  detailLineCount,
  checkLineCount,
  detailViewport,
  checkViewport,
  leave,
}: UseSetupInputOptions): void {
  useInput((input, key) => {
    if (input === "\u0003" || (key.ctrl && input === "c")) {
      if (!busy) leave();
      return;
    }
    if (input === "q") {
      if (!busy) leave();
      return;
    }
    if (key.escape || key.backspace || key.delete) {
      if (busy) return;
      if (model.screen === "details") dispatch({ type: "close-details" });
      else if (model.screen === "check-details") dispatch({ type: "back-to-success" });
      else if (model.screen === "manual") dispatch({ type: "back-to-audit" });
      else if (model.screen === "confirm") dispatch({ type: "cancel-confirm" });
      else if (model.screen === "review") dispatch({ type: "back-to-select" });
      else if (model.screen === "select") dispatch({ type: "back-to-audit" });
      else leave();
      return;
    }
    if (busy) return;
    if (key.tab) {
      if (sidebarMode && (model.screen === "select" || model.screen === "review")) dispatch({ type: "toggle-sidebar" });
      return;
    }
    if (model.screen === "audit") {
      if (key.upArrow || input === "k")
        dispatch({
          type: "move-audit",
          direction: "up",
          lineCount: auditLineCount,
          viewport: detailViewport,
        });
      else if (key.downArrow || input === "j")
        dispatch({
          type: "move-audit",
          direction: "down",
          lineCount: auditLineCount,
          viewport: detailViewport,
        });
      else if (key.return)
        dispatch({
          type: audit?.recommendations.some((recommendation) => !recommendation.actionable)
            ? "begin-manual"
            : audit?.recommendations.some((recommendation) => recommendation.actionable)
              ? "begin-selection"
              : "show-empty",
        });
      return;
    }
    if (model.screen === "manual") {
      if (key.upArrow || input === "k")
        dispatch({
          type: "move-manual",
          direction: "up",
          lineCount: manualLineCount,
          viewport: manualRecommendationViewport(detailViewport),
        });
      else if (key.downArrow || input === "j")
        dispatch({
          type: "move-manual",
          direction: "down",
          lineCount: manualLineCount,
          viewport: manualRecommendationViewport(detailViewport),
        });
      else if (key.return)
        dispatch({
          type: audit?.recommendations.some((recommendation) => recommendation.actionable)
            ? "begin-selection"
            : "show-empty",
        });
      return;
    }
    if (model.screen === "success") {
      dispatch({ type: "begin-check" });
      return;
    }
    if (model.screen === "empty" || model.screen === "error") {
      leave();
      return;
    }
    if (model.screen === "select") {
      const sidebarFocused = sidebarMode ? !model.sidebarCollapsed : true;
      if (sidebarFocused && (key.upArrow || input === "k"))
        dispatch({ type: "move", direction: "up", itemCount: items.length });
      else if (sidebarFocused && (key.downArrow || input === "j"))
        dispatch({ type: "move", direction: "down", itemCount: items.length });
      else if (sidebarFocused && input === " ") {
        const item = items[model.cursor];
        if (item) dispatch({ type: "toggle", item });
      } else if (key.return) dispatch({ type: "begin-planning" });
      return;
    }
    if (model.screen === "review") {
      const sidebarFocused = sidebarMode ? !model.sidebarCollapsed : true;
      if (sidebarFocused && (key.upArrow || input === "k"))
        dispatch({ type: "move-review", direction: "up", fileCount: plan?.files.length ?? 0 });
      else if (sidebarFocused && (key.downArrow || input === "j"))
        dispatch({ type: "move-review", direction: "down", fileCount: plan?.files.length ?? 0 });
      else if (sidebarFocused && input === " " && plan?.files.length) dispatch({ type: "open-details" });
      else if (key.return) dispatch({ type: "begin-confirm" });
      return;
    }
    if (model.screen === "confirm") {
      if (key.rightArrow) dispatch({ type: "move-confirm", direction: "right" });
      else if (key.leftArrow) dispatch({ type: "move-confirm", direction: "left" });
      else if (key.return) dispatch({ type: model.confirmFocus === "apply" ? "begin-applying" : "cancel-confirm" });
      return;
    }
    if (model.screen === "details") {
      if (key.upArrow || input === "k")
        dispatch({
          type: "move-detail",
          direction: "up",
          lineCount: detailLineCount,
          viewport: detailViewport,
        });
      else if (key.downArrow || input === "j")
        dispatch({
          type: "move-detail",
          direction: "down",
          lineCount: detailLineCount,
          viewport: detailViewport,
        });
    }
    if (model.screen === "check-details") {
      if (key.upArrow || input === "k")
        dispatch({
          type: "move-check",
          direction: "up",
          lineCount: checkLineCount,
          viewport: checkViewport,
        });
      else if (key.downArrow || input === "j")
        dispatch({
          type: "move-check",
          direction: "down",
          lineCount: checkLineCount,
          viewport: checkViewport,
        });
    }
  });
}
