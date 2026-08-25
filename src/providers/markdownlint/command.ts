/** Directories whose Markdown is generated or vendored, not project documentation. */
export const MARKDOWNLINT_IGNORE_GLOBS = [
  "node_modules",
  "playwright-report",
  "test-results",
  "coverage",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".git",
  "generated",
] as const;

export const MARKDOWNLINT_CLI_ARGS = ["**/*.md", ...MARKDOWNLINT_IGNORE_GLOBS.map((glob) => `#${glob}`)];

export function markdownlintScriptCommand(): string {
  return ["markdownlint-cli2", ...MARKDOWNLINT_CLI_ARGS.map((arg) => `"${arg}"`)].join(" ");
}
