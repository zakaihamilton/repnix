import type {
  HealthProvider,
  HealthResult,
  InstallPlan,
  ProviderRecommendation,
  RepositoryContext,
} from "../core/types.js";
import { resolveDiagnosticLogger } from "../cli/options.js";
import { runCommand } from "../runners/command-runner.js";
import { buildInstallPlan, type SetupProviderId } from "../setup/install-plan.js";
import { runProviderModule } from "../runners/health/task-executor.js";
import { detectProvider, type ProviderDescriptor } from "./catalog.js";
import { createBuiltinRegistry, type ProviderRegistry } from "./registry.js";

function emptyPlan(): InstallPlan {
  return { schemaVersion: 1, packages: [], files: [], commands: [], warnings: [], conflicts: [] };
}

class ExternalToolAdapter implements HealthProvider {
  readonly id: string;
  readonly name: string;
  readonly category: ProviderDescriptor["category"];
  readonly capabilities: ProviderDescriptor["capabilities"];

  constructor(private readonly descriptor: ProviderDescriptor) {
    this.id = descriptor.id;
    this.name = descriptor.name;
    this.category = descriptor.category;
    this.capabilities = descriptor.capabilities;
  }

  async detect(context: RepositoryContext) {
    return this.descriptor.detect ? this.descriptor.detect(context) : detectProvider(this.descriptor, context);
  }

  async recommend(context: RepositoryContext): Promise<ProviderRecommendation | null> {
    return this.descriptor.recommend?.(context) ?? null;
  }

  async planInstall(context: RepositoryContext): Promise<InstallPlan> {
    if (this.descriptor.planInstall) return this.descriptor.planInstall(context);
    return this.descriptor.setup ? buildInstallPlan(context, [this.id as SetupProviderId], false) : emptyPlan();
  }

  async run(context: RepositoryContext): Promise<HealthResult> {
    const logger = resolveDiagnosticLogger(false);
    if (this.descriptor.run) {
      return runProviderModule(context, this.descriptor, logger);
    }
    if (!this.descriptor.command) {
      return {
        provider: this.id,
        name: this.name,
        category: this.category,
        status: "skipped",
        findings: [],
        durationMs: 0,
        message: "Detection-only provider.",
      };
    }
    const result = await runCommand(this.descriptor.command.binary, this.descriptor.command.args, {
      cwd: context.root,
      logger,
    });
    return {
      provider: this.id,
      name: this.name,
      category: this.category,
      status: result.exitCode === 0 ? "pass" : result.spawnError || result.timedOut ? "error" : "fail",
      findings: [],
      durationMs: result.durationMs,
      ...(result.spawnError ? { message: result.spawnError } : {}),
    };
  }
}

export function createProviderAdapters(registry: ProviderRegistry = createBuiltinRegistry()): HealthProvider[] {
  return registry.providers.map((descriptor) => new ExternalToolAdapter(descriptor));
}
