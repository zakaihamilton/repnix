export const HEALTH_CATEGORIES = [
  "types",
  "lint",
  "format",
  "tests",
  "coverage",
  "dead-code",
  "duplication",
  "security",
  "architecture",
  "bundle",
  "accessibility",
  "monorepo",
  "secrets",
  "licenses",
  "documentation",
  "performance",
  "release",
  "ci",
  "package-health",
] as const;

export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];

export function isHealthCategory(value: string): value is HealthCategory {
  return (HEALTH_CATEGORIES as readonly string[]).includes(value);
}

export function categoryLabel(category: string): string {
  return isHealthCategory(category) ? CATEGORY_LABELS[category] : category;
}

export function categoryDescription(category: string): string {
  return isHealthCategory(category) ? CATEGORY_DESCRIPTIONS[category] : "This category has no additional description.";
}

export const CATEGORY_LABELS: Record<HealthCategory, string> = {
  types: "Type safety",
  lint: "Linting",
  format: "Formatting",
  tests: "Tests",
  coverage: "Test coverage",
  "dead-code": "Dead code",
  duplication: "Duplication",
  security: "Dependency security",
  architecture: "Architecture boundaries",
  bundle: "Bundle regression",
  accessibility: "Accessibility",
  monorepo: "Monorepo consistency",
  secrets: "Secret scanning",
  licenses: "License policy",
  documentation: "Documentation",
  performance: "Performance budgets",
  release: "Release readiness",
  ci: "CI workflow health",
  "package-health": "Package publishing",
};

/** Plain-language descriptions used by the human-readable CLI output. */
export const CATEGORY_DESCRIPTIONS: Record<HealthCategory, string> = {
  types: "Checks whether TypeScript catches mismatched values before your code runs.",
  lint: "Finds suspicious or inconsistent code patterns while you are developing.",
  format: "Keeps code style consistent so reviews can focus on behavior.",
  tests: "Runs automated tests that protect existing behavior from regressions.",
  coverage: "Measures whether tests exercise enough of the code and behavior that matter.",
  "dead-code": "Finds files, exports, and dependencies that nothing in the project uses.",
  duplication: "Finds repeated code that can drift apart when one copy changes.",
  security: "Checks third-party dependencies for publicly known security vulnerabilities.",
  architecture: "Checks whether modules depend on the parts of the application they are allowed to use.",
  bundle: "Checks that shipped JavaScript stays within a deliberate size budget.",
  accessibility: "Checks whether user interfaces can be used by people with different abilities.",
  monorepo: "Checks whether packages in a monorepo follow the project’s shared rules.",
  secrets: "Finds credentials and other sensitive values that should not be committed.",
  licenses: "Checks dependency licenses against the project’s allowed and denied license policy.",
  documentation: "Checks Markdown and public documentation for broken or inconsistent structure.",
  performance: "Protects web and build performance with explicit budgets.",
  release: "Checks versioning, changelog, and release metadata before publishing.",
  ci: "Checks CI workflows for syntax errors and unsafe automation patterns.",
  "package-health": "Checks what consumers receive when an npm package is published.",
};
