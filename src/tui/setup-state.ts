import type { Recommendation } from "../recommendations/recommendation-engine.js";
import type { SetupProviderId } from "../setup/install-plan.js";

export type SetupScreen = "loading" | "empty" | "select" | "planning" | "review" | "details" | "confirm" | "applying" | "success" | "error";

export type SetupSelectionItem =
  | { kind: "provider"; provider: SetupProviderId; name: string }
  | { kind: "ci"; name: string };

export interface SetupTuiModel {
  screen: SetupScreen;
  cursor: number;
  reviewCursor: number;
  detailScroll: number;
  confirmFocus: "cancel" | "apply";
  selectedProviders: SetupProviderId[];
  includeCi: boolean;
  progress?: string;
  error?: string;
}

export type SetupTuiAction =
  | { type: "move"; direction: "up" | "down"; itemCount: number }
  | { type: "toggle"; item?: SetupSelectionItem }
  | { type: "begin-planning" }
  | { type: "planning-complete" }
  | { type: "back-to-select" }
  | { type: "move-review"; direction: "up" | "down"; fileCount: number }
  | { type: "open-details" }
  | { type: "close-details" }
  | { type: "move-detail"; direction: "up" | "down"; lineCount: number; viewport: number }
  | { type: "move-confirm"; direction: "left" | "right" }
  | { type: "begin-confirm" }
  | { type: "cancel-confirm" }
  | { type: "begin-applying" }
  | { type: "progress"; message: string }
  | { type: "complete" }
  | { type: "fail"; message: string };

function moveCursor(cursor: number, direction: "up" | "down", itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (direction === "up") return cursor <= 0 ? itemCount - 1 : cursor - 1;
  return cursor >= itemCount - 1 ? 0 : cursor + 1;
}

function moveScroll(scroll: number, direction: "up" | "down", lineCount: number, viewport: number): number {
  if (direction === "up") return Math.max(0, scroll - 1);
  return Math.min(Math.max(lineCount - Math.max(viewport, 1), 0), scroll + 1);
}

function selectedProvidersFrom(recommendations: Recommendation[]): SetupProviderId[] {
  return recommendations
    .filter((recommendation) => recommendation.actionable && recommendation.priority === "baseline")
    .map((recommendation) => recommendation.provider as SetupProviderId);
}

export function selectionItems(recommendations: Recommendation[], hasCi: boolean): SetupSelectionItem[] {
  const items: SetupSelectionItem[] = recommendations
    .filter((recommendation) => recommendation.actionable)
    .map((recommendation) => ({ kind: "provider" as const, provider: recommendation.provider as SetupProviderId, name: recommendation.name }));
  if (hasCi) items.push({ kind: "ci", name: "GitHub Actions health step" });
  return items;
}

export function createSetupTuiModel(recommendations: Recommendation[]): SetupTuiModel {
  return {
    screen: "select",
    cursor: 0,
    reviewCursor: 0,
    detailScroll: 0,
    confirmFocus: "cancel",
    selectedProviders: selectedProvidersFrom(recommendations),
    includeCi: false,
  };
}

export function setupTuiReducer(model: SetupTuiModel, action: SetupTuiAction): SetupTuiModel {
  switch (action.type) {
    case "move":
      return { ...model, cursor: moveCursor(model.cursor, action.direction, action.itemCount) };
    case "toggle":
      {
        const item = action.item;
        if (!item) return model;
        if (item.kind === "ci") return { ...model, includeCi: !model.includeCi };
        return {
          ...model,
          selectedProviders: model.selectedProviders.includes(item.provider)
            ? model.selectedProviders.filter((provider) => provider !== item.provider)
            : [...model.selectedProviders, item.provider],
        };
      }
    case "begin-planning":
      return { ...model, screen: "planning" };
    case "planning-complete":
      return { ...model, screen: "review", reviewCursor: 0 };
    case "back-to-select":
      return { ...model, screen: "select" };
    case "move-review":
      return { ...model, reviewCursor: moveCursor(model.reviewCursor, action.direction, action.fileCount) };
    case "open-details":
      return { ...model, screen: "details", detailScroll: 0 };
    case "close-details":
      return { ...model, screen: "review" };
    case "move-detail":
      return { ...model, detailScroll: moveScroll(model.detailScroll, action.direction, action.lineCount, action.viewport) };
    case "move-confirm":
      return { ...model, confirmFocus: action.direction === "right" ? "apply" : "cancel" };
    case "begin-confirm":
      return { ...model, screen: "confirm", confirmFocus: "cancel" };
    case "cancel-confirm":
      return { ...model, screen: "review" };
    case "begin-applying":
      return { ...model, screen: "applying", progress: "Starting safe apply…" };
    case "progress":
      return { ...model, progress: action.message };
    case "complete":
      return { ...model, screen: "success" };
    case "fail":
      return { ...model, screen: "error", error: action.message };
  }
}
