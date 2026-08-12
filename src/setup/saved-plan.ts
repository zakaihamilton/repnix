import { isDeepStrictEqual } from "node:util";
import type { InstallPlan } from "../core/types.js";
import type { SetupProviderId } from "./install-plan.js";

export interface InstallPlanSelection {
  providers: SetupProviderId[];
  includeCi: boolean;
}

export interface SavedInstallPlan extends InstallPlan {
  selection: InstallPlanSelection;
}

function isSelection(value: unknown): value is InstallPlanSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<InstallPlanSelection>;
  return Array.isArray(selection.providers) && selection.providers.every((provider) => typeof provider === "string") && typeof selection.includeCi === "boolean";
}

export function serializeInstallPlan(plan: InstallPlan, selection: InstallPlanSelection): SavedInstallPlan {
  return { ...plan, selection: { providers: [...selection.providers], includeCi: selection.includeCi } };
}

export function parseSavedInstallPlan(value: unknown): SavedInstallPlan {
  if (!value || typeof value !== "object") throw new Error("Invalid RepNix setup plan: expected an object.");
  const plan = value as Partial<SavedInstallPlan>;
  if (
    plan.schemaVersion !== 1 ||
    !Array.isArray(plan.packages) ||
    !Array.isArray(plan.files) ||
    !Array.isArray(plan.commands) ||
    !Array.isArray(plan.warnings) ||
    !Array.isArray(plan.conflicts) ||
    !isSelection(plan.selection)
  ) {
    throw new Error("Invalid or outdated RepNix setup plan. Generate a new plan with `repnix setup --plan --format json`.");
  }
  return plan as SavedInstallPlan;
}

export function assertSavedPlanMatches(saved: SavedInstallPlan, regenerated: InstallPlan): void {
  const expected = serializeInstallPlan(regenerated, saved.selection);
  if (!isDeepStrictEqual(saved, expected)) {
    throw new Error("Saved setup plan no longer matches this repository. Generate and review a new plan before applying it.");
  }
}
