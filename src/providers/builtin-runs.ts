import type { DiagnosticLogger } from "../cli/options.js";
import type { RepnixConfig } from "../config/repo-health-config.js";
import type { HealthResult, RepositoryContext } from "../core/types.js";
import {
  runAttw,
  runCoveragePolicy,
  runDependencyCruiser,
  runEslintBoundaries,
  runJscpd,
  runKnip,
  runLicensePolicy,
  runOsvScanner,
  runPublint,
  runSizeLimit,
} from "../runners/health/builtin-providers.js";
import type { ProviderHookContext, ProviderModule } from "./sdk.js";

function bindRun(
  run: (
    context: RepositoryContext,
    config: RepnixConfig,
    logger: DiagnosticLogger,
    timeoutMs?: number,
  ) => Promise<HealthResult>,
) {
  return ({ context, runtime, config }: ProviderHookContext) =>
    run(context, config, runtime.logger, runtime.timeoutMs);
}

function bindSimpleRun(
  run: (context: RepositoryContext, logger: DiagnosticLogger, timeoutMs?: number) => Promise<HealthResult>,
) {
  return ({ context, runtime }: ProviderHookContext) => run(context, runtime.logger, runtime.timeoutMs);
}

const BUILTIN_RUNS: Record<string, NonNullable<ProviderModule["run"]>> = {
  c8: bindRun(runCoveragePolicy),
  knip: bindSimpleRun(runKnip),
  jscpd: bindSimpleRun(runJscpd),
  "osv-scanner": bindSimpleRun(runOsvScanner),
  "eslint-boundaries": bindRun(runEslintBoundaries),
  "dependency-cruiser": bindSimpleRun(runDependencyCruiser),
  "size-limit": bindSimpleRun(runSizeLimit),
  "license-checker": bindRun(runLicensePolicy),
  publint: bindSimpleRun(runPublint),
  attw: bindSimpleRun(runAttw),
};

/** Attach specialist runners without importing them from the detection catalog. */
export function applyBuiltinRuns(providers: readonly ProviderModule[]): ProviderModule[] {
  return providers.map((provider) => {
    const run = BUILTIN_RUNS[provider.id];
    return run ? { ...provider, run } : provider;
  });
}
