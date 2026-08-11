export const HEALTH_CATEGORIES = [
  "types",
  "lint",
  "format",
  "tests",
  "dead-code",
  "duplication",
  "security",
  "architecture",
  "bundle",
  "accessibility",
  "monorepo",
  "package-health",
] as const;

export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<HealthCategory, string> = {
  types: "Type safety",
  lint: "Linting",
  format: "Formatting",
  tests: "Tests",
  "dead-code": "Dead code",
  duplication: "Duplication",
  security: "Dependency security",
  architecture: "Architecture boundaries",
  bundle: "Bundle regression",
  accessibility: "Accessibility",
  monorepo: "Monorepo consistency",
  "package-health": "Package publishing",
};

/** Plain-language descriptions used by the human-readable CLI output. */
export const CATEGORY_DESCRIPTIONS: Record<HealthCategory, string> = {
  types: "Checks whether TypeScript catches mismatched values before your code runs.",
  lint: "Finds suspicious or inconsistent code patterns while you are developing.",
  format: "Keeps code style consistent so reviews can focus on behavior.",
  tests: "Runs automated tests that protect existing behavior from regressions.",
  "dead-code": "Finds files, exports, and dependencies that nothing in the project uses.",
  duplication: "Finds repeated code that can drift apart when one copy changes.",
  security: "Checks third-party dependencies for publicly known security vulnerabilities.",
  architecture: "Checks whether modules depend on the parts of the application they are allowed to use.",
  bundle: "Checks that shipped JavaScript stays within a deliberate size budget.",
  accessibility: "Checks whether user interfaces can be used by people with different abilities.",
  monorepo: "Checks whether packages in a monorepo follow the project’s shared rules.",
  "package-health": "Checks what consumers receive when an npm package is published.",
};

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  TypeScript: "Type-checks your source code before it runs.",
  ESLint: "Looks for bugs and risky or inconsistent coding patterns.",
  Oxlint: "Looks for common JavaScript and TypeScript problems.",
  Biome: "Checks code quality and can enforce a consistent style.",
  Prettier: "Checks that files follow one consistent formatting style.",
  Oxfmt: "Checks that files follow one consistent formatting style.",
  Jest: "Runs automated tests for your project.",
  Vitest: "Runs automated tests for your project.",
  "Test script": "Uses the project’s existing test command.",
  Knip: "Finds unused files, exports, and dependencies.",
  jscpd: "Finds copy-and-paste code that may become inconsistent.",
  "OSV-Scanner": "Checks dependencies against the OSV vulnerability database.",
  "eslint-plugin-boundaries": "Checks dependency rules through your existing ESLint setup.",
  "dependency-cruiser": "Checks module boundaries and dependency cycles.",
  "Size Limit": "Checks that built JavaScript stays below configured size budgets.",
  Publint: "Checks package exports, entry points, metadata, and published files.",
  "Are The Types Wrong?": "Checks whether published TypeScript types work for consumers.",
};

export const PROVIDER_NEXT_STEPS: Record<string, string> = {
  "OSV-Scanner": "Next step: install the OSV-Scanner binary and prepare its local vulnerability database.",
  "eslint-plugin-boundaries": "Next step: define the folder or module boundary rules in your ESLint configuration.",
  "Size Limit": "Next step: choose a build artifact and set an explicit size budget.",
};
