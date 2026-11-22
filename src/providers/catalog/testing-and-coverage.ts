import type { RepositoryContext } from "../../core/types.js";
import { safeTestScript } from "../../repository/script-detection.js";
import { recommendC8, recommendStryker } from "../recommend.js";
import type { ProviderModule } from "../sdk.js";

function packageManagerRun(context: RepositoryContext, script: string): string {
  if (!context.packageManager) return `run ${script}`;
  return context.packageManager === "yarn"
    ? `${context.packageManager} ${script}`
    : `${context.packageManager} run ${script}`;
}

/** Testing, coverage, and mutation testing providers. */
export const TESTING_AND_COVERAGE_PROVIDERS: ProviderModule[] = [
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
];
