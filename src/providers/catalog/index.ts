import type { ProviderModule } from "../sdk.js";
import { ANALYSIS_AND_SECURITY_PROVIDERS } from "./analysis-and-security.js";
import { CORE_QUALITY_PROVIDERS } from "./core-quality.js";
import { DOCS_RELEASE_PACKAGE_PROVIDERS } from "./docs-release-package.js";
import { TESTING_AND_COVERAGE_PROVIDERS } from "./testing-and-coverage.js";
import { UI_AND_A11Y_PROVIDERS } from "./ui-and-a11y.js";

export type ProviderDescriptor = ProviderModule;

/** Complete built-in provider catalog across all health categories. */
export const PROVIDERS: ProviderDescriptor[] = [
  ...CORE_QUALITY_PROVIDERS,
  ...TESTING_AND_COVERAGE_PROVIDERS,
  ...ANALYSIS_AND_SECURITY_PROVIDERS,
  ...UI_AND_A11Y_PROVIDERS,
  ...DOCS_RELEASE_PACKAGE_PROVIDERS,
];
