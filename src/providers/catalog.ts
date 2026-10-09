import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderDetection, RepositoryContext } from "../core/types.js";
import {
  isNonMutatingQualityCommand,
  isNonMutatingTestCommand,
  matchesScriptPattern,
  safeTestScript,
} from "../repository/script-detection.js";
import { executableOnPath } from "../runners/health/task-executor.js";
import { MARKDOWNLINT_CLI_ARGS, markdownlintScriptCommand } from "./markdownlint/command.js";
import { normalizeMarkdownlintResult } from "./markdownlint/normalizer.js";
import { normalizeStylelintResult } from "./stylelint/normalizer.js";
import { planChangesetsInstall, planJsxA11yInstall, planStylelintInstall } from "./plan-install.js";
import {
  recommendActionlint,
  recommendAttw,
  recommendC8,
  recommendChangesets,
  recommendDependencyCruiser,
  recommendEslintBoundaries,
  recommendGitleaks,
  recommendJscpd,
  recommendJsxA11y,
  recommendAxePlaywright,
  recommendLhciAccessibility,
  recommendKnip,
  recommendLhci,
  recommendLicenseChecker,
  recommendMarkdownlint,
  recommendOsv,
  recommendPublint,
  recommendSizeLimit,
  recommendStorybookA11y,
  recommendStylelint,
  recommendVisualRegression,
  recommendUserEvent,
  recommendStryker,
  recommendSyncpack,
} from "./recommend.js";
import type { ProviderModule } from "./sdk.js";
import { detectAxePlaywright, detectPlaywrightVisual, detectStorybookA11y, detectUserEvent } from "./ui-guardrails.js";

export type ProviderDescriptor = ProviderModule;

const quoteScriptArg = (value: string) => (/\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value);

function packageManagerRun(context: RepositoryContext, script: string): string {
  if (!context.packageManager) return `run ${script}`;
  return context.packageManager === "yarn"
    ? `${context.packageManager} ${script}`
    : `${context.packageManager} run ${script}`;
}

export const PROVIDERS: ProviderDescriptor[] = [
  {
    id: "typescript",
    name: "TypeScript",
    category: "types",
    packages: ["typescript"],
    configPatterns: [/(^|\/)tsconfig(?:\.[^/]+)?\.json$/],
    scriptPattern: /(^|\s|&&|\|)tsc(?:\s|$)/,
    capabilities: { typeChecking: true },
    description: "Type-checks your source code before it runs.",
    documentationUrl: "https://www.typescriptlang.org/docs/",
  },
  {
    id: "eslint",
    name: "ESLint",
    category: "lint",
    packages: ["eslint"],
    configPatterns: [/(^|\/)eslint\.config\.[cm]?[jt]s$/, /(^|\/)\.eslintrc(?:\.[^/]+)?$/],
    scriptPattern: /(^|\s|&&|\|)eslint(?:\s|$)/,
    capabilities: { linting: true },
    description: "Looks for bugs and risky or inconsistent coding patterns.",
    documentationUrl: "https://eslint.org/docs/latest/",
    fix: [
      {
        category: "lint",
        description: "Auto-fix lint issues with ESLint",
        scriptNames: ["lint:fix", "fix:lint"],
        binary: "eslint",
        args: [".", "--fix"],
        order: 20,
      },
    ],
  },
  {
    id: "oxlint",
    name: "Oxlint",
    category: "lint",
    packages: ["oxlint"],
    configPatterns: [/(^|\/)\.oxlintrc\.json$/],
    scriptPattern: /(^|\s|&&|\|)oxlint(?:\s|$)/,
    capabilities: { linting: true },
    zeroConfig: true,
    description: "Looks for common JavaScript and TypeScript problems.",
    documentationUrl: "https://oxc.rs/docs/guide/usage/linter.html",
    fix: [
      {
        category: "lint",
        description: "Auto-fix lint issues with Oxlint",
        scriptNames: ["lint:fix", "fix:lint"],
        binary: "oxlint",
        args: ["--fix", "."],
        order: 30,
      },
    ],
  },
  {
    id: "biome",
    name: "Biome",
    category: "lint",
    packages: ["@biomejs/biome"],
    configPatterns: [/(^|\/)biome\.jsonc?$/],
    scriptPattern: /(^|\s|&&|\|)biome(?:\s|$)/,
    capabilities: { linting: true, formatting: true },
    description: "Checks code quality and can enforce a consistent style.",
    documentationUrl: "https://biomejs.dev/guides/getting-started/",
    fix: [
      {
        category: "format",
        description: "Format files with Biome",
        scriptNames: ["format"],
        binary: "biome",
        args: ["format", "--write", "."],
        order: 30,
      },
      {
        category: "lint",
        description: "Auto-fix lint issues with Biome",
        scriptNames: ["lint:fix", "fix:lint"],
        binary: "biome",
        args: ["lint", "--write", "."],
        order: 10,
      },
    ],
  },
  {
    id: "prettier",
    name: "Prettier",
    category: "format",
    packages: ["prettier"],
    configPatterns: [/(^|\/)\.prettierrc(?:\.[^/]+)?$/, /(^|\/)prettier\.config\.[cm]?[jt]s$/],
    scriptPattern: /(^|\s|&&|\|)prettier(?:\s|$)/,
    scriptNames: ["health:format", "format", "format:check", "check:format", "format-check"],
    capabilities: { formatting: true },
    zeroConfig: true,
    description: "Checks that files follow one consistent formatting style.",
    documentationUrl: "https://prettier.io/docs/en/",
    setup: {
      packageName: "prettier",
      scriptName: "health:format",
      scriptCommand: () => "prettier --check .",
      checks: ["Consistent file formatting across repository files."],
    },
    fix: [
      {
        category: "format",
        description: "Format files with Prettier",
        scriptNames: ["format"],
        binary: "prettier",
        args: ["--write", "."],
        order: 10,
      },
    ],
  },
  {
    id: "oxfmt",
    name: "Oxfmt",
    category: "format",
    packages: ["oxfmt"],
    configPatterns: [/(^|\/)\.oxfmtrc\.json$/],
    scriptPattern: /(^|\s|&&|\|)oxfmt(?:\s|$)/,
    capabilities: { formatting: true },
    zeroConfig: true,
    description: "Checks that files follow one consistent formatting style.",
    documentationUrl: "https://oxc.rs/docs/guide/usage/formatter.html",
    fix: [
      {
        category: "format",
        description: "Format files with Oxfmt",
        scriptNames: ["format"],
        binary: "oxfmt",
        args: ["."],
        order: 20,
      },
    ],
  },
  {
    id: "jest",
    name: "Jest",
    category: "tests",
    packages: ["jest"],
    configPatterns: [/(^|\/)jest\.config\.[cm]?[jt]s(?:on)?$/],
    scriptPattern: /(^|\s|&&|\|)jest(?:\s|$)/,
    capabilities: { testing: true },
    zeroConfig: true,
    description: "Runs automated tests for your project.",
    documentationUrl: "https://jestjs.io/docs/getting-started",
  },
  {
    id: "vitest",
    name: "Vitest",
    category: "tests",
    packages: ["vitest"],
    configPatterns: [/(^|\/)vitest\.config\.[cm]?[jt]s$/],
    scriptPattern: /(^|\s|&&|\|)vitest(?:\s|$)/,
    capabilities: { testing: true },
    zeroConfig: true,
    description: "Runs automated tests for your project.",
    documentationUrl: "https://vitest.dev/guide/",
  },
  {
    id: "test-script",
    name: "Test script",
    category: "tests",
    packages: [],
    configPatterns: [],
    scriptPattern: /$^/,
    scriptNames: ["test", "test:run", "check:test"],
    capabilities: { testing: true },
    description: "Uses the project’s existing test command.",
  },
  {
    id: "c8",
    name: "c8",
    category: "coverage",
    packages: ["c8"],
    configPatterns: [/(^|\/)(?:\.c8rc(?:\.[^/]+)?|c8\.config\.[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)c8(?:\s|$)/,
    scriptNames: ["health:coverage", "coverage", "test:coverage", "check:coverage"],
    scriptKind: "test",
    capabilities: { testCoverage: true },
    description: "Measures test coverage and can enforce coverage thresholds.",
    documentationUrl: "https://github.com/bcoe/c8",
    dependsOnCategory: "tests",
    recommendOrder: 110,
    recommend: recommendC8,
    setup: {
      packageName: "c8",
      scriptName: "health:coverage",
      scriptCommand: (context) =>
        `c8 --all --reporter=text ${packageManagerRun(context, safeTestScript(context.scripts) ?? "test")}`,
      checks: ["Test coverage reported for the repository's safe test command."],
    },
  },
  {
    id: "stryker",
    name: "Stryker",
    category: "coverage",
    packages: ["@stryker-mutator/core"],
    configPatterns: [/(^|\/)stryker\.config\.[cm]?[jt]s$/],
    scriptPattern: /(^|\s|&&|\|)stryker(?:\s|$)/,
    scriptNames: ["health:mutation", "mutation", "stryker"],
    capabilities: { mutationTesting: true },
    command: { binary: "stryker", args: ["run"] },
    requiresConfiguration: true,
    description: "Mutates code to measure whether tests catch behavioral changes.",
    documentationUrl: "https://stryker-mutator.io/docs/",
    recommendOrder: 120,
    recommend: recommendStryker,
  },
  {
    id: "knip",
    name: "Knip",
    category: "dead-code",
    runnable: true,
    packages: ["knip"],
    configPatterns: [/(^|\/)knip\.(?:jsonc?|[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)knip(?:\s|$)/,
    capabilities: {
      unusedFiles: true,
      unusedExports: true,
      unusedDependencies: true,
      dependencyCycles: true,
    },
    zeroConfig: true,
    description: "Finds unused files, exports, and dependencies.",
    documentationUrl: "https://knip.dev/",
    recommendOrder: 10,
    recommend: recommendKnip,
    setup: {
      packageName: "knip",
      scriptName: "health:dead-code",
      scriptCommand: () => "knip",
      checks: ["Unused files, exports, and dependencies not reachable from project entry points."],
    },
  },
  {
    id: "jscpd",
    name: "jscpd",
    category: "duplication",
    runnable: true,
    packages: ["jscpd"],
    configPatterns: [/(^|\/)\.jscpd\.json$/, /(^|\/)jscpd\.json$/],
    scriptPattern: /(^|\s|&&|\|)jscpd(?:\s|$)/,
    capabilities: { duplication: true },
    zeroConfig: true,
    description: "Finds copy-and-paste code that may become inconsistent.",
    documentationUrl: "https://github.com/kucherenko/jscpd",
    recommendOrder: 20,
    recommend: recommendJscpd,
    setup: {
      packageName: "jscpd",
      scriptName: "health:duplication",
      scriptCommand: (context) => `jscpd ${context.sourceRoots.map(quoteScriptArg).join(" ")}`,
      checks: ["Repeated code blocks across detected source roots."],
    },
  },
  {
    id: "osv-scanner",
    name: "OSV-Scanner",
    category: "security",
    runnable: true,
    packages: [],
    configPatterns: [/(^|\/)osv-scanner\.toml$/],
    scriptPattern: /(^|\s|&&|\|)osv-scanner(?:\s|$)/,
    capabilities: { vulnerabilities: true },
    binary: "osv-scanner",
    searchPath: true,
    zeroConfig: true,
    description: "Checks dependencies against the OSV vulnerability database.",
    documentationUrl: "https://google.github.io/osv-scanner/",
    nextStep: "Next step: install the OSV-Scanner binary and prepare its local vulnerability database.",
    recommendOrder: 30,
    recommend: recommendOsv,
  },
  {
    id: "jsx-a11y",
    name: "eslint-plugin-jsx-a11y",
    category: "accessibility",
    runnable: true,
    packages: ["eslint-plugin-jsx-a11y"],
    configPatterns: [/(^|\/)eslint\.config\.[cm]?[jt]s$/, /(^|\/)\.eslintrc(?:\.[^/]+)?$/],
    scriptPattern: /(^|\s|&&|\|)eslint(?:\s|$)/,
    capabilities: { accessibilityRules: true },
    activeConfigPattern: /jsx-a11y/,
    requiresConfiguration: true,
    description: "Checks common accessibility problems in JSX.",
    documentationUrl: "https://github.com/jsx-eslint/eslint-plugin-jsx-a11y",
    nextStep: "Next step: enable the plugin’s recommended rules in the existing ESLint configuration.",
    deriveFromCategory: "lint",
    recommendOrder: 90,
    recommend: recommendJsxA11y,
    planInstall: planJsxA11yInstall,
  },
  {
    id: "axe-playwright",
    name: "axe-core with Playwright",
    category: "runtime-accessibility",
    packages: ["@axe-core/playwright"],
    configPatterns: [],
    scriptPattern: /(?:playwright\s+test|vitest(?:\s+run)?|jest)/,
    scriptNames: ["health:a11y", "test:a11y", "a11y:test"],
    scriptKind: "test",
    runnable: true,
    capabilities: { runtimeAccessibility: true },
    description: "Audits rendered pages for accessibility issues using axe-core.",
    documentationUrl: "https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright",
    nextStep: "Add axe scans to representative page tests and run them through a dedicated accessibility test script.",
    recommendOrder: 151,
    recommend: recommendAxePlaywright,
    detect: detectAxePlaywright,
  },
  {
    id: "storybook-a11y",
    name: "Storybook accessibility addon",
    category: "runtime-accessibility",
    packages: ["@storybook/addon-a11y"],
    configPatterns: [],
    scriptPattern: /(?:vitest|playwright\s+test|storybook\s+test)/,
    scriptNames: ["health:storybook-a11y", "test:storybook-a11y", "storybook:a11y"],
    scriptKind: "test",
    runnable: true,
    capabilities: { runtimeAccessibility: true },
    description: "Checks rendered Storybook stories for accessibility violations.",
    documentationUrl: "https://storybook.js.org/docs/writing-tests/accessibility-testing",
    nextStep:
      "Enable the addon, run stories through the Storybook Vitest addon or test-runner, and set parameters.a11y.test to 'error'.",
    recommendOrder: 150,
    recommend: recommendStorybookA11y,
    detect: detectStorybookA11y,
  },
  {
    id: "lhci-accessibility",
    name: "Lighthouse CI accessibility",
    category: "runtime-accessibility",
    packages: ["@lhci/cli"],
    configPatterns: [/(^|\/)lighthouserc\.[cm]?[jt]s(?:on)?$/],
    activeConfigPattern: /categories:accessibility/,
    scriptPattern: /(^|\s|&&|\|)lhci(?:\s|$)/,
    capabilities: { runtimeAccessibility: true },
    command: { binary: "lhci", args: ["autorun"] },
    deriveFromCategory: "performance",
    deriveFromProvider: "lhci",
    requiresConfiguration: true,
    description: "Checks the Lighthouse accessibility assertion in the configured site audit.",
    documentationUrl: "https://googlechrome.github.io/lighthouse-ci/docs/configuration.html",
    nextStep: "Add a categories:accessibility assertion to the existing Lighthouse CI configuration.",
    recommendOrder: 149,
    recommend: recommendLhciAccessibility,
  },
  {
    id: "playwright-visual",
    name: "Playwright visual comparisons",
    category: "visual-regression",
    packages: ["@playwright/test", "playwright"],
    configPatterns: [],
    scriptPattern: /playwright\s+test/,
    scriptNames: ["health:visual", "test:visual", "visual:test"],
    scriptKind: "test",
    runnable: true,
    capabilities: { visualRegression: true },
    description: "Compares approved screenshots to catch unintended visual changes.",
    documentationUrl: "https://playwright.dev/docs/test-snapshots",
    nextStep:
      "Add toHaveScreenshot assertions for representative pages and viewports, then review the initial baselines.",
    recommendOrder: 165,
    recommend: recommendVisualRegression,
    detect: detectPlaywrightVisual,
  },
  {
    id: "testing-library-user-event",
    name: "Testing Library user-event",
    category: "interactions",
    packages: ["@testing-library/user-event"],
    configPatterns: [],
    scriptPattern: /(?:vitest(?:\s+run)?|jest|playwright\s+test)/,
    scriptNames: ["health:interactions", "test:interactions", "ui:interactions"],
    scriptKind: "test",
    runnable: true,
    capabilities: { userInteractionTesting: true },
    description: "Exercises UI behavior through realistic keyboard and pointer interactions.",
    documentationUrl: "https://testing-library.com/docs/user-event/setup/",
    nextStep: "Use userEvent.setup() in component tests and run those tests from a dedicated interaction test script.",
    recommendOrder: 166,
    recommend: recommendUserEvent,
    detect: detectUserEvent,
  },
  {
    id: "stylelint",
    name: "Stylelint",
    category: "styles",
    packages: ["stylelint"],
    configPatterns: [/(^|\/)\.stylelintrc(?:\.[^/]+)?$/, /(^|\/)stylelint\.config\.[cm]?[jt]s$/],
    packageJsonConfigKey: "stylelint",
    scriptPattern: /(^|\s|&&|\|)stylelint(?:\s|$)/,
    scriptNames: ["health:styles", "styles", "stylelint"],
    scriptKind: "quality",
    capabilities: { cssConsistency: true },
    command: { binary: "stylelint", args: ["--formatter", "json", "**/*.{css,pcss,postcss}"] },
    requiresConfiguration: true,
    description: "Checks CSS syntax and configured style conventions.",
    documentationUrl: "https://stylelint.io/user-guide/get-started/",
    recommendOrder: 155,
    recommend: recommendStylelint,
    planInstall: planStylelintInstall,
    setup: {
      packageName: "stylelint",
      scriptName: "health:styles",
      scriptCommand: () => 'stylelint --formatter json "**/*.{css,pcss,postcss}"',
      checks: ["CSS syntax and the rules enabled in the project's Stylelint configuration."],
    },
    normalize: normalizeStylelintResult,
  },
  {
    id: "eslint-boundaries",
    name: "eslint-plugin-boundaries",
    category: "architecture",
    runnable: true,
    packages: ["eslint-plugin-boundaries"],
    configPatterns: [/(^|\/)eslint\.config\.[cm]?[jt]s$/, /(^|\/)\.eslintrc(?:\.[^/]+)?$/],
    scriptPattern: /\bboundaries\//,
    capabilities: { architectureRules: true },
    activeConfigPattern: /boundaries\/(?:dependencies|element-types|entry-point|external|no-private|no-unknown)/,
    requiresConfiguration: true,
    description: "Checks dependency rules through your existing ESLint setup.",
    documentationUrl: "https://github.com/javierbrea/eslint-plugin-boundaries",
    nextStep: "Next step: define the folder or module boundary rules in your ESLint configuration.",
    deriveFromCategory: "lint",
    recommendOrder: 40,
    recommend: recommendEslintBoundaries,
  },
  {
    id: "dependency-cruiser",
    name: "dependency-cruiser",
    category: "architecture",
    runnable: true,
    packages: ["dependency-cruiser"],
    configPatterns: [/(^|\/)\.dependency-cruiser\.(?:json|[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)(?:depcruise|dependency-cruiser)(?:\s|$)/,
    capabilities: { dependencyCycles: true, architectureRules: true },
    activeConfigPattern: /(?:forbidden\s*:|"forbidden"\s*:)/,
    requiresConfiguration: true,
    description: "Checks module boundaries and dependency cycles.",
    documentationUrl: "https://github.com/sverweij/dependency-cruiser",
    recommendOrder: 50,
    recommend: recommendDependencyCruiser,
    setup: {
      packageName: "dependency-cruiser",
      scriptName: "health:architecture",
      scriptCommand: (context) =>
        `depcruise --output-type json --config -- ${context.sourceRoots.map(quoteScriptArg).join(" ")}`,
      checks: ["Circular dependencies and configured module-boundary violations."],
    },
  },
  {
    id: "size-limit",
    name: "Size Limit",
    category: "bundle",
    runnable: true,
    packages: ["size-limit"],
    configPatterns: [/(^|\/)\.size-limit\.(?:json|[cm]?[jt]s)$/],
    scriptPattern: /(^|\s|&&|\|)size-limit(?:\s|$)/,
    capabilities: { bundleBudget: true },
    packageJsonConfigKey: "size-limit",
    activeConfigPattern: /(?:limit\s*:|"limit"\s*:)/,
    requiresConfiguration: true,
    description: "Checks that built JavaScript stays below configured size budgets.",
    documentationUrl: "https://github.com/ai/size-limit",
    nextStep: "Next step: choose a build artifact and set an explicit size budget.",
    recommendOrder: 60,
    recommend: recommendSizeLimit,
  },
  {
    id: "syncpack",
    name: "syncpack",
    category: "monorepo",
    packages: ["syncpack"],
    configPatterns: [/(^|\/)\.syncpack(?:\.[^/]+)?$/],
    scriptPattern: /(^|\s|&&|\|)syncpack(?:\s|$)/,
    scriptNames: ["health:monorepo", "monorepo", "syncpack"],
    capabilities: { workspaceConsistency: true },
    command: { binary: "syncpack", args: ["list-mismatches"] },
    zeroConfig: true,
    description: "Checks dependency versions and package metadata across workspaces.",
    documentationUrl: "https://jamiemason.github.io/syncpack/",
    recommendOrder: 100,
    recommend: recommendSyncpack,
    setup: {
      packageName: "syncpack",
      scriptName: "health:monorepo",
      scriptCommand: () => "syncpack list-mismatches",
      checks: ["Dependency version and package metadata consistency across workspaces."],
    },
  },
  {
    id: "gitleaks",
    name: "Gitleaks",
    category: "secrets",
    packages: [],
    configPatterns: [/(^|\/)\.gitleaks\.(?:toml|ya?ml)$/],
    scriptPattern: /(^|\s|&&|\|)gitleaks(?:\s|$)/,
    capabilities: { secrets: true },
    binary: "gitleaks",
    searchPath: true,
    command: {
      binary: "gitleaks",
      args: ["detect", "--source", ".", "--no-banner", "--redact", "--exit-code", "1"],
      searchPath: true,
    },
    zeroConfig: true,
    description: "Scans repository history and files for leaked secrets.",
    documentationUrl: "https://github.com/gitleaks/gitleaks",
    nextStep: "Next step: install the Gitleaks binary or make it available in CI.",
    recommendOrder: 130,
    recommend: recommendGitleaks,
  },
  {
    id: "license-checker",
    name: "license-checker",
    category: "licenses",
    packages: ["license-checker"],
    configPatterns: [],
    scriptPattern: /(^|\s|&&|\|)license-checker(?:\s|$)/,
    scriptNames: ["health:licenses", "licenses", "license-checker"],
    capabilities: { licenses: true },
    command: { binary: "license-checker", args: ["--json"] },
    zeroConfig: true,
    description: "Reports dependency licenses for comparison with project policy.",
    documentationUrl: "https://github.com/davglass/license-checker",
    recommendOrder: 140,
    recommend: recommendLicenseChecker,
    setup: {
      packageName: "license-checker",
      scriptName: "health:licenses",
      scriptCommand: () => "license-checker --json",
      checks: ["Declared dependency licenses against repository policy."],
    },
  },
  {
    id: "markdownlint",
    name: "markdownlint",
    category: "documentation",
    packages: ["markdownlint-cli2"],
    configPatterns: [/(^|\/)\.markdownlint(?:[.-][^/]+)?$/],
    scriptPattern: /(^|\s|&&|\|)markdownlint(?:-cli2)?(?:\s|$)/,
    scriptNames: ["health:documentation", "documentation", "docs", "markdownlint"],
    capabilities: { documentation: true },
    command: { binary: "markdownlint-cli2", args: [...MARKDOWNLINT_CLI_ARGS] },
    normalize: normalizeMarkdownlintResult,
    zeroConfig: true,
    description: "Checks Markdown structure and style.",
    documentationUrl: "https://github.com/DavidAnson/markdownlint",
    recommendOrder: 150,
    recommend: recommendMarkdownlint,
    setup: {
      packageName: "markdownlint-cli2",
      scriptName: "health:documentation",
      scriptCommand: () => markdownlintScriptCommand(),
      checks: ["Markdown structure and style consistency."],
    },
    fix: [
      {
        category: "documentation",
        description: "Auto-fix Markdown formatting with markdownlint",
        scriptNames: ["docs:fix", "documentation:fix"],
        binary: "markdownlint-cli2",
        args: ["--fix", ...MARKDOWNLINT_CLI_ARGS],
        order: 10,
      },
    ],
  },
  {
    id: "lhci",
    name: "Lighthouse CI",
    category: "performance",
    packages: ["@lhci/cli"],
    configPatterns: [/(^|\/)lighthouserc\.[cm]?[jt]s(?:on)?$/],
    scriptPattern: /(^|\s|&&|\|)lhci(?:\s|$)/,
    scriptNames: ["health:performance", "performance", "lhci"],
    capabilities: { performance: true },
    requiresConfiguration: true,
    description: "Checks configured web performance budgets.",
    documentationUrl: "https://github.com/GoogleChrome/lighthouse-ci",
    recommendOrder: 160,
    recommend: recommendLhci,
  },
  {
    id: "changesets",
    name: "Changesets",
    category: "release",
    packages: ["@changesets/cli"],
    configPatterns: [/(^|\/)\.changeset\/config\.json$/],
    scriptPattern: /(^|\s|&&|\|)changeset(?:\s|$)/,
    scriptNames: ["health:release", "release", "changeset:status"],
    capabilities: { release: true },
    requiresConfiguration: true,
    description: "Checks release metadata and pending package changes.",
    documentationUrl: "https://github.com/changesets/changesets",
    recommendOrder: 170,
    recommend: recommendChangesets,
    planInstall: planChangesetsInstall,
    setup: {
      packageName: "@changesets/cli",
      scriptName: "health:release",
      scriptCommand: () => "changeset status",
      checks: ["Pending release metadata and package versioning intent."],
    },
  },
  {
    id: "actionlint",
    name: "actionlint",
    category: "ci",
    packages: [],
    configPatterns: [/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/],
    scriptPattern: /(^|\s|&&|\|)actionlint(?:\s|$)/,
    capabilities: { ciWorkflow: true },
    binary: "actionlint",
    searchPath: true,
    command: { binary: "actionlint", args: [".github/workflows"], searchPath: true },
    zeroConfig: true,
    description: "Checks GitHub Actions workflow syntax and common mistakes.",
    documentationUrl: "https://github.com/rhysd/actionlint",
    nextStep: "Next step: install actionlint or add it to the CI image.",
    recommendOrder: 180,
    recommend: recommendActionlint,
  },
  {
    id: "publint",
    name: "Publint",
    category: "package-health",
    runnable: true,
    packages: ["publint"],
    configPatterns: [],
    scriptPattern: /(^|\s|&&|\|)publint(?:\s|$)/,
    capabilities: { packagePublishing: true },
    zeroConfig: true,
    description: "Checks package exports, entry points, metadata, and published files.",
    documentationUrl: "https://publint.dev/",
    recommendOrder: 70,
    recommend: recommendPublint,
    setup: {
      packageName: "publint",
      scriptName: "health:package:publint",
      scriptCommand: () => "publint",
      checks: ["Published package exports, entry points, metadata, and files."],
    },
  },
  {
    id: "attw",
    name: "Are The Types Wrong?",
    category: "package-health",
    runnable: true,
    packages: ["@arethetypeswrong/cli"],
    configPatterns: [/(^|\/)\.attw\.json$/],
    scriptPattern: /(^|\s|&&|\|)attw(?:\s|$)/,
    capabilities: { typesCompatibility: true },
    zeroConfig: true,
    description: "Checks whether published TypeScript types work for consumers.",
    documentationUrl: "https://github.com/arethetypeswrong/arethetypeswrong.github.io",
    recommendOrder: 80,
    recommend: recommendAttw,
    setup: {
      packageName: "@arethetypeswrong/cli",
      scriptName: "health:package:types",
      scriptCommand: () => "attw --pack .",
      checks: ["TypeScript consumer resolution across Node and bundler modes."],
    },
  },
];

export async function detectProvider(
  descriptor: ProviderDescriptor,
  context: RepositoryContext,
): Promise<ProviderDetection> {
  if (descriptor.detect) return descriptor.detect(context);
  const packageName = descriptor.packages.find((name) => context.installedPackages.has(name));
  const candidateConfigFiles = [...context.files].filter((file) =>
    descriptor.configPatterns.some((pattern) => pattern.test(file)),
  );
  const configFiles: string[] = [];
  for (const file of candidateConfigFiles) {
    if (!descriptor.activeConfigPattern) {
      configFiles.push(file);
      continue;
    }
    try {
      if (descriptor.activeConfigPattern.test(await readFile(path.join(context.root, file), "utf8")))
        configFiles.push(file);
    } catch {
      // Repository diagnostics handle malformed manifests; unreadable optional tool configs stay inactive.
    }
  }
  const scriptEntries = Object.entries(context.scripts).filter(([name, command]) => {
    if (!descriptor.scriptNames) return matchesScriptPattern(command, descriptor.scriptPattern);
    const safe =
      descriptor.scriptKind === "quality" ? isNonMutatingQualityCommand(command) : isNonMutatingTestCommand(command);
    // A conventional script name does not always identify its provider. In
    // particular, Vitest's --coverage mode is not c8, and an unrestricted
    // Markdown glob would lint dependency documentation as well as the app.
    const invokesNamedProvider =
      !["c8", "lhci"].includes(descriptor.id) || matchesScriptPattern(command, descriptor.scriptPattern);
    const excludesDependencyDocs =
      descriptor.id !== "markdownlint" || /(?:^|\s)["']?#node_modules["']?(?:\s|$)/.test(command);
    return descriptor.scriptNames.includes(name) && safe && invokesNamedProvider && excludesDependencyDocs;
  });
  const packageConfigKey = descriptor.packageJsonConfigKey ?? descriptor.id;
  const packageJsonConfig = Object.hasOwn(context.packageJson, packageConfigKey);
  const packageJsonConfigActive =
    packageJsonConfig &&
    (!descriptor.activeConfigPattern ||
      descriptor.activeConfigPattern.test(JSON.stringify(context.packageJson[packageConfigKey])));
  const pathBinary = descriptor.searchPath && descriptor.binary ? await executableOnPath(descriptor.binary) : null;
  const installed = Boolean(packageName || pathBinary);
  const installedAtRoot = packageName
    ? context.installedPackageOrigins.get(packageName)?.includes("package.json") === true
    : false;
  const configured = configFiles.length > 0 || scriptEntries.length > 0 || packageJsonConfigActive;
  const pathBinaryConfigured = Boolean(pathBinary) && configured;
  const active = descriptor.requiresConfiguration
    ? installed && (configFiles.length > 0 || packageJsonConfigActive)
    : scriptEntries.length > 0 ||
      ((installedAtRoot || pathBinaryConfigured) &&
        (configFiles.length > 0 || packageJsonConfigActive || descriptor.zeroConfig === true));
  const evidence: string[] = [];
  if (packageName) evidence.push(`${packageName} ${context.installedPackages.get(packageName)}`);
  if (pathBinary) evidence.push(pathBinary);
  evidence.push(...configFiles);
  evidence.push(...scriptEntries.map(([name]) => `script:${name}`));
  if (packageJsonConfig) evidence.push(`package.json#${packageConfigKey}`);
  const detection: ProviderDetection = {
    installed,
    configured,
    configFiles,
    evidence,
    availableCapabilities: installed ? descriptor.capabilities : {},
    activeCapabilities: active ? descriptor.capabilities : {},
  };
  if (packageName) detection.version = context.installedPackages.get(packageName)!;
  return detection;
}

export async function detectAllProviders(
  context: RepositoryContext,
  providers: readonly ProviderDescriptor[] = PROVIDERS,
): Promise<Map<string, ProviderDetection>> {
  const detections = await Promise.all(
    providers.map(async (provider) => [provider.id, await detectProvider(provider, context)] as const),
  );
  const result = new Map(detections);
  if (["jest", "vitest"].some((id) => result.get(id)?.activeCapabilities.testing)) {
    const generic = result.get("test-script");
    if (generic) result.set("test-script", { ...generic, activeCapabilities: {} });
  }
  return result;
}
