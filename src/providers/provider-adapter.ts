import type {
  HealthProvider,
  HealthResult,
  InstallPlan,
  ProviderRecommendation,
  RepositoryContext,
} from "../core/types.js";
import { runAttw, runDependencyCruiser, runJscpd, runKnip, runOsvScanner, runPublint, runSizeLimit } from "../runners/health-runner.js";
import { buildInstallPlan, type SetupProviderId } from "../setup/install-plan.js";
import { PROVIDERS, detectProvider, type ProviderDescriptor } from "./catalog.js";

function emptyPlan(): InstallPlan {
  return { packages: [], files: [], commands: [], warnings: [], conflicts: [] };
}

function publishesTypes(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key === "types" || publishesTypes(child));
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
    if (Object.keys(detection.activeCapabilities).length > 0 || !["knip", "jscpd", "dependency-cruiser", "publint", "attw"].includes(this.id)) return null;
    if (this.id === "knip" && context.sourceFiles.length > 0) {
      return { recommended: true, priority: "baseline", actionable: true, reason: "Unused files, exports, and dependencies are not covered." };
    }
    if (this.id === "jscpd" && context.sourceFiles.length >= 2) {
      return { recommended: true, priority: "baseline", actionable: true, reason: "Duplication detection is not covered." };
    }
    if (this.id === "dependency-cruiser" && context.sourceFiles.length >= 2) {
      return { recommended: true, priority: "optional", actionable: true, reason: "Architecture rules are not covered." };
    }
    if (this.id === "publint" && context.kinds.includes("npm-library")) {
      return { recommended: true, priority: "baseline", actionable: true, reason: "Published package metadata and files are not validated." };
    }
    if (this.id === "attw" && context.kinds.includes("npm-library") && (context.packageJson.types || context.packageJson.typings || publishesTypes(context.packageJson.exports))) {
      return { recommended: true, priority: "baseline", actionable: true, reason: "Published TypeScript declarations are not tested across consumer resolution modes." };
    }
    return null;
  }

  async planInstall(context: RepositoryContext): Promise<InstallPlan> {
    return ["knip", "jscpd", "dependency-cruiser", "publint", "attw"].includes(this.id)
      ? await buildInstallPlan(context, [this.id as SetupProviderId], false)
      : emptyPlan();
  }

  async run(context: RepositoryContext): Promise<HealthResult> {
    if (this.id === "knip") return await runKnip(context, false);
    if (this.id === "jscpd") return await runJscpd(context, false);
    if (this.id === "osv-scanner") return await runOsvScanner(context, false);
    if (this.id === "dependency-cruiser") return await runDependencyCruiser(context, false);
    if (this.id === "size-limit") return await runSizeLimit(context, false);
    if (this.id === "publint") return await runPublint(context, false);
    if (this.id === "attw") return await runAttw(context, false);
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
