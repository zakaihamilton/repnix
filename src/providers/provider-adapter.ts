import type {
  HealthProvider,
  HealthResult,
  InstallPlan,
  ProviderRecommendation,
  RepositoryContext,
} from "../core/types.js";
import { runJscpd, runKnip } from "../runners/health-runner.js";
import { buildInstallPlan, type SetupProviderId } from "../setup/install-plan.js";
import { PROVIDERS, detectProvider, type ProviderDescriptor } from "./catalog.js";

function emptyPlan(): InstallPlan {
  return { packages: [], files: [], commands: [], warnings: [], conflicts: [] };
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
    return detectProvider(this.descriptor, context);
  }

  async recommend(context: RepositoryContext): Promise<ProviderRecommendation | null> {
    const detection = await this.detect(context);
    if (detection.installed || !["knip", "jscpd"].includes(this.id)) return null;
    if (this.id === "knip" && context.sourceFiles.length > 0) {
      return { recommended: true, priority: "baseline", reason: "Unused files, exports, and dependencies are not covered." };
    }
    if (this.id === "jscpd" && context.sourceFiles.length >= 2) {
      return { recommended: true, priority: "baseline", reason: "Duplication detection is not covered." };
    }
    return null;
  }

  async planInstall(context: RepositoryContext): Promise<InstallPlan> {
    return ["knip", "jscpd"].includes(this.id)
      ? await buildInstallPlan(context, [this.id as SetupProviderId], false)
      : emptyPlan();
  }

  async run(context: RepositoryContext): Promise<HealthResult> {
    if (this.id === "knip") return await runKnip(context, false);
    if (this.id === "jscpd") return await runJscpd(context, false);
    return {
      provider: this.id,
      name: this.name,
      category: this.category,
      status: "skipped",
      findings: [],
      durationMs: 0,
      message: "Detection-only provider in the MVP.",
    };
  }
}

export function createProviderAdapters(): HealthProvider[] {
  return PROVIDERS.map((descriptor) => new ExternalToolAdapter(descriptor));
}
