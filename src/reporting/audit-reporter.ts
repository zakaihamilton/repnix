import pc from "picocolors";
import { categoryLabel } from "../core/health-category.js";
import { builtinProvider } from "../providers/registry.js";
import type { AuditModel, CoverageStatus } from "../recommendations/recommendation-engine.js";
import { addWrapped, rule, terminalWidth, visibleLength } from "./terminal-format.js";

function mark(status: CoverageStatus): string {
  switch (status) {
    case "covered":
      return pc.green("✓");
    case "partial":
      return pc.yellow("◐");
    case "missing":
      return pc.red("✗");
    case "off":
      return pc.dim("– off");
    case "not-applicable":
      return pc.dim("– n/a");
  }
}

/** Render the repository health audit report for terminal output. */
export function renderAudit(model: AuditModel, options: { details?: boolean } = {}): string {
  const { context } = model;
  const width = terminalWidth();
  const lines = [pc.bold("Repository health audit"), ""];
  addWrapped(
    lines,
    "RepNix looks at the checks already protecting this repository, then points out useful gaps. This audit is read-only.",
    width,
  );
  lines.push("");
  lines.push(pc.bold("Detected project"), "");
  for (const scope of context.scopes) {
    const label = scope.path === "." ? "root" : scope.path;
    lines.push(`${label}: ${scope.roles.join(", ")}`);
    if (options.details) {
      for (const evidence of scope.roleEvidence)
        addWrapped(
          lines,
          `${evidence.role}: ${evidence.signals.join(", ")} (${evidence.confidence} confidence)`,
          width,
          "  ",
          "    ",
        );
    }
  }
  addWrapped(
    lines,
    context.packageManager
      ? `${context.packageManager} (${context.packageManagerEvidence ?? "detected"})`
      : "Package manager unresolved",
    width,
    "",
    "  ",
  );
  lines.push(context.hasCI ? "GitHub Actions" : "No CI detected", "", pc.bold("Repository Guardrails"), rule(width));
  addWrapped(lines, "These symbols show whether a kind of protection is active in your project:", width);
  addWrapped(lines, "✓ covered   ◐ partly covered   ✗ missing   – off = disabled   – n/a = not relevant", width, "  ");
  lines.push("");
  const coverageToShow = options.details
    ? model.coverage
    : model.coverage.filter((entry) => entry.status !== "not-applicable");
  for (const entry of coverageToShow) {
    const detail =
      entry.status === "not-applicable" || entry.status === "off"
        ? ""
        : entry.providers.length
          ? entry.providers.join(", ")
          : (entry.reason ?? "Missing");
    const category = model.registry?.categoryRegistry.get(entry.category);
    const prefix = `${(category?.label ?? categoryLabel(entry.category)).padEnd(27)} ${mark(entry.status)}`;
    if (detail) {
      addWrapped(lines, detail, width, `${prefix} `, `${" ".repeat(visibleLength(prefix))} `);
    } else {
      lines.push(prefix);
    }
    if (options.details && entry.evidence.length)
      addWrapped(lines, `Applies because: ${entry.evidence.join("; ")}`, width, "  ", "    ");
    for (const scope of entry.scopeCoverage ?? []) {
      if (scope.status === "missing" || scope.status === "partial")
        addWrapped(
          lines,
          `${scope.scope}: missing ${scope.missingCapabilities.join(", ")}; add a workspace check script.`,
          width,
          "  ",
          "    ",
        );
    }
  }
  if (context.diagnostics.length) {
    lines.push("", pc.bold("Diagnostics"), rule(width));
    for (const diagnostic of context.diagnostics) {
      addWrapped(
        lines,
        diagnostic.message,
        width,
        `${diagnostic.severity === "error" ? pc.red("!") : pc.yellow("!")} `,
        "  ",
      );
    }
  }
  const recommendationsToShow = options.details
    ? model.recommendations
    : [...model.recommendations].sort((left, right) => Number(right.actionable) - Number(left.actionable)).slice(0, 3);
  if (recommendationsToShow.length) {
    for (const priority of ["baseline", "optional", "advanced"] as const) {
      const recommendations = recommendationsToShow.filter((recommendation) => recommendation.priority === priority);
      if (!recommendations.length) continue;
      const heading =
        priority === "baseline"
          ? "Recommended baseline — start here"
          : priority === "optional"
            ? "Optional — useful when your project needs it"
            : "Advanced — add when you have a specific goal";
      lines.push("", pc.bold(heading), rule(width));
      for (const recommendation of recommendations) {
        const setup = recommendation.actionable ? "" : pc.dim(" (manual configuration)");
        lines.push(`+ ${pc.bold(recommendation.name)}${setup}`);
        const provider = model.registry?.get(recommendation.provider) ?? builtinProvider(recommendation.provider);
        const description = provider?.description;
        if (description) addWrapped(lines, `What it checks: ${description}`, width, "  ");
        addWrapped(lines, recommendation.reason, width, "  ");
        if (!recommendation.actionable) {
          addWrapped(
            lines,
            provider?.nextStep ?? "Next step: review the provider configuration before installing this check.",
            width,
            "  ",
          );
        }
        lines.push("");
      }
    }
    if (!options.details && model.recommendations.length > recommendationsToShow.length) {
      addWrapped(
        lines,
        `${model.recommendations.length - recommendationsToShow.length} lower-priority recommendation${model.recommendations.length - recommendationsToShow.length === 1 ? " is" : "s are"} hidden. Run repnix audit --details to review all applicable coverage.`,
        width,
        pc.dim(""),
        "  ",
      );
    }
  } else {
    lines.push("");
    addWrapped(
      lines,
      "No new checks are recommended. Your active coverage matches what RepNix expects for this repository.",
      width,
      pc.green(""),
      "  ",
    );
  }
  return lines.join("\n").trimEnd();
}
