import { CATEGORY_LABELS } from "../core/health-category.js";
import { builtinProvider } from "../providers/registry.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { RepositoryContext } from "../core/types.js";
import type { AuditModel, CoverageStatus } from "../recommendations/recommendation-engine.js";
import { wrapTerminalText } from "../reporting/console-reporter.js";
import type { SetupTuiTheme } from "./setup-theme.js";
import type { SetupTuiModel } from "./setup-state.js";

export function auditStatusPresentation(
  status: CoverageStatus,
  theme: SetupTuiTheme,
): { symbol: string; color: string } {
  switch (status) {
    case "covered":
      return { symbol: "✓", color: theme.success };
    case "partial":
      return { symbol: "◐", color: theme.warning };
    case "missing":
      return { symbol: "✗", color: theme.danger };
    case "off":
      return { symbol: "–", color: theme.muted };
    case "not-applicable":
      return { symbol: "·", color: theme.muted };
  }
}

export function auditRecommendationSummary(
  recommendations: AuditModel["recommendations"],
  actionableOnly = false,
): { baseline: number; optional: number; advanced: number; total: number } {
  const considered = actionableOnly
    ? recommendations.filter((recommendation) => recommendation.actionable)
    : recommendations;
  const summary = { baseline: 0, optional: 0, advanced: 0, total: considered.length };
  for (const recommendation of considered) summary[recommendation.priority] += 1;
  return summary;
}

export function auditSetupOptions(audit: AuditModel): string[] {
  return [
    ...audit.recommendations
      .filter((recommendation) => recommendation.actionable)
      .map((recommendation) => recommendation.name),
    ...(audit.context.hasCI ? ["GitHub Actions health step"] : []),
  ];
}

export function selectedSetupOptions(audit: AuditModel, model: SetupTuiModel): string[] {
  return [
    ...audit.recommendations
      .filter(
        (recommendation) =>
          recommendation.actionable &&
          model.selectedProviders.includes(recommendation.provider as SetupTuiModel["selectedProviders"][number]),
      )
      .map((recommendation) => recommendation.name),
    ...(model.includeCi ? ["GitHub Actions health step"] : []),
  ];
}

export interface AuditPageSummary {
  repositoryName: string;
  packageManager: string;
  languages: string[];
  frameworks: string[];
  roles: string[];
  ci: string;
  workspaceCount: number;
}

export function auditPageSummary(audit: AuditModel): AuditPageSummary {
  const context = audit.context;
  return {
    repositoryName: context.packageJson.name ?? "unnamed",
    packageManager: context.packageManager ?? "unresolved",
    languages: context.languages,
    frameworks: context.frameworks,
    roles: [...new Set(context.scopes.flatMap((scope) => scope.roles))],
    ci: context.hasCI ? "GitHub Actions" : "none detected",
    workspaceCount:
      context.workspaceRoots?.filter((root) => root !== ".").length ?? Math.max(context.packageCount - 1, 0),
  };
}

export function auditContentLineCount(audit: AuditModel, singleColumn: boolean, width = 80): number {
  const relevantCoverage = audit.coverage.filter((entry) => entry.status !== "not-applicable");
  const coverageRows = singleColumn ? relevantCoverage.length : Math.ceil(relevantCoverage.length / 2);
  const setupOptions = auditSetupOptions(audit);
  const setupRows = setupOptions.length
    ? wrapTerminalText(`Setup options: ${setupOptions.join(" · ")}`, Math.max(width - 6, 1)).length
    : 0;
  return 9 + coverageRows + setupRows;
}

export interface SetupCheckDetails {
  checks: string[];
  scope: string;
  setup: string[];
  command: string;
  caveat?: string;
}

const MANUAL_GUIDANCE: Record<string, string[]> = {
  "osv-scanner": [
    "Install the OSV-Scanner binary in your local toolchain or CI image.",
    "Make its local vulnerability database available to the environment that runs health checks.",
    "Add the scan command to the repository health script, then decide whether existing vulnerabilities are baselined or fixed before enabling CI failures.",
  ],
  "eslint-boundaries": [
    "Install eslint-plugin-boundaries as a development dependency.",
    "Add the plugin to the existing ESLint configuration.",
    "Define your folder or module element types and the allowed dependency relationships; start with a small set of rules that reflects the repository’s architecture.",
  ],
  "size-limit": [
    "Choose the built JavaScript file or entry point whose size matters to users.",
    "Add a Size Limit configuration with that artifact and an explicit limit based on the current measured size plus an agreed growth margin.",
    "Run the check after the build and decide whether the limit should fail pull requests.",
  ],
  "jsx-a11y": [
    "Install eslint-plugin-jsx-a11y as a development dependency.",
    "Enable its recommended rules in the existing ESLint configuration.",
    "Review any existing violations and tune only rules that do not match the project’s UI patterns.",
  ],
  c8: [
    "Choose the test command that should produce coverage and install c8 as a development dependency.",
    "Add a coverage script around that test command and set line, function, branch, and statement thresholds that reflect the project’s expectations.",
    "Run the coverage command locally and in CI; raise thresholds deliberately as coverage improves.",
  ],
  stryker: [
    "Install Stryker for the project’s test runner and create its project-specific configuration.",
    "Limit mutation testing to the source paths and test command that matter most so runtime stays manageable.",
    "Set a mutation score target after reviewing surviving mutants, then run it as a scheduled or opt-in CI check if it is too expensive for every pull request.",
  ],
  gitleaks: [
    "Install the Gitleaks binary locally or add it to the CI image.",
    "Run a repository scan and review any matches carefully; rotate real credentials immediately.",
    "Add the scan to pre-commit or CI, and create a narrowly scoped allowlist only for reviewed false positives.",
  ],
  lhci: [
    "Choose a stable deployed URL or a build-and-serve command that Lighthouse CI can measure.",
    "Create a Lighthouse CI configuration with representative pages and explicit LCP, CLS, and TBT budgets.",
    "Run the audit against that URL or build in CI and review the first measurements before making the budgets blocking.",
  ],
  actionlint: [
    "Install actionlint locally or add it to the CI image.",
    "Run it against .github/workflows and fix syntax, expression, and common workflow mistakes.",
    "Add the command to CI so workflow changes are checked before merge.",
  ],
  changesets: [
    "Install and initialize Changesets, which creates the .changeset directory and project configuration.",
    "Decide which package changes require a changeset and document the expected release workflow.",
    "Add a status check to CI and use the generated version/changelog flow when publishing.",
  ],
};

function packageManagerRun(context: RepositoryContext, script: string): string {
  return context.packageManager ? `${context.packageManager} run ${script}` : `run ${script}`;
}

export function manualRecommendationSteps(
  recommendation: AuditModel["recommendations"][number],
  details: SetupCheckDetails,
  registry?: ProviderRegistry,
): string[] {
  const configured = MANUAL_GUIDANCE[recommendation.provider];
  if (configured) return configured;
  const provider = registry?.get(recommendation.provider) ?? builtinProvider(recommendation.provider);
  return [
    ...details.setup,
    provider?.nextStep ?? "Review the provider documentation and add its command to the repository health workflow.",
  ];
}

export function manualRecommendationLines(audit: AuditModel, width: number): string[] {
  const recommendations = audit.recommendations.filter((recommendation) => !recommendation.actionable);
  const wrapWidth = Math.max(width, 20);
  if (!recommendations.length) return ["No manual recommendations were found for this repository."];
  const lines = [
    "These checks apply to this repository but need a project-specific decision before RepNix can configure them safely.",
    "Review the guidance below. Then add the provider and its configuration to your normal development or CI workflow.",
  ];
  recommendations.forEach((recommendation, index) => {
    const details = setupCheckDetails(recommendation, audit.context, audit.registry);
    const provider = audit.registry?.get(recommendation.provider) ?? builtinProvider(recommendation.provider);
    lines.push(
      "",
      `${index + 1}. ${recommendation.name} · ${CATEGORY_LABELS[recommendation.category]} · ${recommendation.priority}`,
    );
    lines.push(...wrapTerminalText(`Why: ${recommendation.reason}`, wrapWidth, "  ", "  "));
    lines.push("  HOW TO DO IT");
    manualRecommendationSteps(recommendation, details, audit.registry).forEach((step, index) => {
      lines.push(...wrapTerminalText(`${index + 1}. ${step}`, wrapWidth, "  ", "  "));
    });
    lines.push(...wrapTerminalText(`When ready: ${details.command}`, wrapWidth, "  ", "  "));
    if (provider?.documentationUrl)
      lines.push(...wrapTerminalText(`Docs: ${provider.documentationUrl}`, wrapWidth, "  ", "  "));
  });
  return lines;
}

export function manualContentLineCount(audit: AuditModel, width: number): number {
  return manualRecommendationLines(audit, Math.max(width - 6, 20)).length;
}

export function manualRecommendationViewport(viewport: number): number {
  return Math.max(viewport - 1, 1);
}

function sourceScope(context: RepositoryContext): string {
  const fileCount = `${context.sourceFiles.length} source file${context.sourceFiles.length === 1 ? "" : "s"}`;
  if (!context.sourceRoots.length) return fileCount;
  const roots = context.sourceRoots.slice(0, 3).join(", ");
  const suffix = context.sourceRoots.length > 3 ? `, +${context.sourceRoots.length - 3} more` : "";
  return `${fileCount} under ${roots}${suffix}`;
}

function existingConfig(context: RepositoryContext, files: string[]): string | undefined {
  return files.find((file) => context.files.has(file));
}

export function setupCheckDetails(
  recommendation: AuditModel["recommendations"][number],
  context: RepositoryContext,
  registry?: ProviderRegistry,
): SetupCheckDetails {
  const scope = sourceScope(context);
  const provider = registry?.get(recommendation.provider) ?? builtinProvider(recommendation.provider);
  switch (recommendation.provider) {
    case "knip":
      return {
        checks: ["Unused files, exports, and dependencies that are not reachable from the project entry points."],
        scope: `${scope}; package.json scripts and workspace packages are used to understand entry points.`,
        setup: ["Install Knip as a development dependency.", "Add the health:dead-code script to package.json."],
        command: packageManagerRun(context, "health:dead-code"),
      };
    case "jscpd": {
      const config = existingConfig(context, [".jscpd.json", "jscpd.json"]);
      return {
        checks: [
          "Repeated code blocks across the detected source roots, including copies that can drift apart over time.",
        ],
        scope,
        setup: [
          "Install jscpd as a development dependency.",
          "Add the health:duplication script to package.json.",
          config
            ? `Extend ${config} with safe generated/build exclusions.`
            : "Create .jscpd.json with safe generated/build exclusions.",
        ],
        command: packageManagerRun(context, "health:duplication"),
        ...(context.packageJson.jscpd !== undefined && !config
          ? {
              caveat:
                "A jscpd configuration embedded in package.json will be preserved; verify its exclusions manually.",
            }
          : {}),
      };
    }
    case "dependency-cruiser": {
      const config = existingConfig(context, [
        ".dependency-cruiser.json",
        ".dependency-cruiser.js",
        ".dependency-cruiser.cjs",
        ".dependency-cruiser.mjs",
        ".dependency-cruiser.ts",
      ]);
      return {
        checks: [
          "Circular dependencies between modules.",
          "Production source importing test files through conservative starter rules.",
        ],
        scope,
        setup: [
          "Install dependency-cruiser as a development dependency.",
          "Add the health:architecture script to package.json.",
          config
            ? `Use the existing ${config} without overwriting it.`
            : "Create .dependency-cruiser.cjs with conservative starter rules.",
        ],
        command: packageManagerRun(context, "health:architecture"),
        ...(config
          ? { caveat: `Existing rules in ${config} are preserved and will determine the final boundaries.` }
          : {}),
      };
    }
    case "jsx-a11y":
      return {
        checks: ["Common JSX accessibility issues, using eslint-plugin-jsx-a11y's recommended rules."],
        scope: "The existing root .eslintrc.json configuration and the repository's normal ESLint command.",
        setup: [
          "Install eslint-plugin-jsx-a11y as a development dependency.",
          "Add the plugin and its recommended preset to .eslintrc.json without changing existing rules.",
        ],
        command: packageManagerRun(context, "lint"),
      };
    case "publint":
      return {
        checks: ["Package exports, entry points, metadata, and the files consumers receive from npm."],
        scope: `${context.packageJson.name ?? "the package"} package manifest and its publishable file layout.`,
        setup: [
          "Install Publint as a development dependency.",
          "Add the health:package:publint script to package.json.",
        ],
        command: packageManagerRun(context, "health:package:publint"),
      };
    case "attw":
      return {
        checks: [
          "Whether TypeScript types resolve correctly for consumers using Node and bundler-style package entry points.",
        ],
        scope: `${context.packageJson.name ?? "the package"} after it is packed, including its published type declarations.`,
        setup: [
          "Install Are The Types Wrong? as a development dependency.",
          "Add the health:package:types script to package.json.",
        ],
        command: packageManagerRun(context, "health:package:types"),
      };
    default: {
      const caveat = provider?.setup?.details?.caveat?.(context) ?? provider?.nextStep;
      return {
        checks: provider?.setup?.details?.checks ??
          provider?.setup?.checks ?? [provider?.description ?? "The recommended repository health check."],
        scope: provider?.setup?.details?.scope?.(context) ?? scope,
        setup: provider?.setup
          ? [
              `Install ${provider.setup.packageName} as a development dependency.`,
              `Add the ${provider.setup.scriptName} script to package.json.`,
            ]
          : ["Follow the provider preparation recipe."],
        command: packageManagerRun(context, provider?.setup?.scriptName ?? `health:${recommendation.category}`),
        ...(caveat ? { caveat } : {}),
      };
    }
  }
}
