import type { DiagnosticLogger } from "../cli/options.js";
import type {
  HealthFinding,
  HealthResult,
  InstallPlan,
  ProviderCapabilities,
  ProviderDetection,
  ProviderRecommendation,
  RepositoryContext,
} from "../core/types.js";
import type { HealthCategory } from "../core/health-category.js";

export const PROVIDER_API_VERSION = 1 as const;

export interface ProviderCommand {
  binary: string;
  args: string[];
  searchPath?: boolean;
}

export interface ProviderSetup {
  packageName: string;
  scriptName: string;
  scriptCommand(context: RepositoryContext): string;
  checks: string[];
  scope?: (context: RepositoryContext) => string;
  caveat?: (context: RepositoryContext) => string | undefined;
  details?: { checks?: string[]; scope?: (context: RepositoryContext) => string; caveat?: (context: RepositoryContext) => string | undefined };
}

export interface ProviderRuntime {
  logger: DiagnosticLogger;
  timeoutMs?: number;
  runCommand(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; maxOutputBytes?: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal?: string | null;
    timedOut?: boolean;
    spawnError?: string;
    durationMs: number;
  }>;
}

export interface ProviderHookContext {
  context: RepositoryContext;
  runtime: ProviderRuntime;
}

export interface RecommendHelpers {
  detections: Map<string, ProviderDetection>;
  coverageStatus?: "covered" | "partial" | "missing" | "not-applicable" | "off";
}

export interface ProviderModule {
  apiVersion?: typeof PROVIDER_API_VERSION;
  id: string;
  name: string;
  category: HealthCategory;
  packages: string[];
  configPatterns: RegExp[];
  scriptPattern: RegExp;
  capabilities: ProviderCapabilities;
  zeroConfig?: boolean;
  binary?: string;
  searchPath?: boolean;
  packageJsonConfigKey?: string;
  activeConfigPattern?: RegExp;
  requiresConfiguration?: boolean;
  scriptNames?: string[];
  scriptKind?: "test" | "quality";
  command?: ProviderCommand;
  runnable?: boolean;
  description?: string;
  documentationUrl?: string;
  nextStep?: string;
  setup?: ProviderSetup;
  /** Schedule after the root task in this category, when one exists. */
  dependsOnCategory?: HealthCategory;
  /** Reuse an already-scheduled task in this category instead of running a second command. */
  deriveFromCategory?: HealthCategory;
  detect?: (context: RepositoryContext) => Promise<ProviderDetection>;
  /** Lower values appear first in audit output. Plugins without an order follow built-ins. */
  recommendOrder?: number;
  recommend?: (context: RepositoryContext, helpers?: RecommendHelpers) => ProviderRecommendation | null;
  planInstall?: (context: RepositoryContext) => Promise<InstallPlan>;
  run?: (input: ProviderHookContext) => Promise<HealthResult>;
  normalize?: (input: { output: string; result: { exitCode: number | null; stderr: string; stdout: string }; context: RepositoryContext }) => HealthFinding[];
}

export interface CategoryModule {
  id: string;
  label: string;
  description: string;
  requiredCapabilities: string[];
  order?: number;
  applicable(context: RepositoryContext): { applicable: boolean; scopes: string[]; evidence: string[] };
}

export interface RepnixProviderPlugin {
  apiVersion: typeof PROVIDER_API_VERSION;
  providers: ProviderModule[];
  categories?: CategoryModule[];
}

export function defineProvider(provider: Omit<ProviderModule, "apiVersion">): ProviderModule {
  return { apiVersion: PROVIDER_API_VERSION, ...provider };
}

export function definePlugin(plugin: Omit<RepnixProviderPlugin, "apiVersion">): RepnixProviderPlugin {
  return { apiVersion: PROVIDER_API_VERSION, ...plugin };
}
