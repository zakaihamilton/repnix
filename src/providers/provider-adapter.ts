import type {
  HealthProvider,
  HealthResult,
  InstallPlan,
  ProviderRecommendation,
  RepositoryContext,
} from "../core/types.js";
import { runDependencyCruiser, runJscpd, runKnip, runOsvScanner, runSizeLimit } from "../runners/health-runner.js";
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
    if (detection.installed || !["knip", "jscpd", "dependency-cruiser"].includes(this.id)) return null;
    if (this.id === "knip" && context.sourceFiles.length > 0) {
      return { recommended: true, priority: "baseline", actionable: true, reason: "Unused files, exports, and dependencies are not covered." };
    }
    if (this.id === "jscpd" && context.sourceFiles.length >= 2) {
      return { recommended: true, priority: "baseline", actionable: true, reason: "Duplication detection is not covered." };
    }
    if (this.id === "dependency-cruiser" && context.sourceFiles.length >= 2) {
      return { recommended: true, priority: "optional", actionable: true, reason: "Architecture rules are not covered." };
    }
    return null;
  }

  async planInstall(context: RepositoryContext): Promise<InstallPlan> {
    return ["knip", "jscpd", "dependency-cruiser"].includes(this.id)
      ? await buildInstallPlan(context, [this.id as SetupProviderId], false)
      : emptyPlan();
  }

  async run(context: RepositoryContext): Promise<HealthResult> {
    if (this.id === "knip") return await runKnip(context, false);
    if (this.id === "jscpd") return await runJscpd(context, false);
    if (this.id === "osv-scanner") return await runOsvScanner(context, false);
    if (this.id === "dependency-cruiser") return await runDependencyCruiser(context, false);
    if (this.id === "size-limit") return await runSizeLimit(context, false);
    return {
      provider: this.id,
      name: this.name,
      category: this.category,
      status: "skipped",
      findings: [],
      durationMs: 0,
      message: this.id === "eslint-boundaries" ? "Architecture rules run through the existing ESLint command." : "Detection-only provider.",
    };
  }
}

export function createProviderAdapters(): HealthProvider[] {
  return PROVIDERS.map((descriptor) => new ExternalToolAdapter(descriptor));
}
