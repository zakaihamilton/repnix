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
