import type { HealthCategory } from "./health-category.js";

export type PackageManagerId = "npm" | "pnpm" | "yarn" | "bun";
export type RepositoryKind =
  | "typescript"
  | "react"
  | "nextjs"
  | "node-application"
  | "npm-library"
  | "monorepo";

export type RepositoryRole = "cli" | "library" | "web-app" | "node-app" | "tooling";

export interface RoleEvidence {
  role: RepositoryRole;
  confidence: "high" | "medium" | "configured";
  signals: string[];
}

export interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  exports?: unknown;
  files?: string[];
  bin?: unknown;
  publishConfig?: unknown;
  [key: string]: unknown;
}

export interface WorkspaceManifest {
  path: string;
  packageJson: PackageJson;
}

export interface RepositoryScope {
  path: string;
  manifestPath: string;
  packageJson: PackageJson;
  roles: RepositoryRole[];
  roleEvidence: RoleEvidence[];
  frameworks: string[];
  languages: string[];
  sourceFiles: string[];
  sourceRoots: string[];
}

export interface RepositoryDiagnostic {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface RepositoryContext {
  root: string;
  packageManager: PackageManagerId | null;
  packageManagerEvidence?: string;
  frameworks: string[];
  languages: string[];
  kinds: RepositoryKind[];
  isMonorepo: boolean;
  packageCount: number;
  hasCI: boolean;
  ciProvider?: "github-actions";
  /** Default branch advertised by the origin remote, when Git can resolve it locally. */
  gitDefaultBranch?: string;
  /** True when the root legacy ESLint JSON configuration can be safely extended. */
  editableLegacyEslintConfig?: boolean;
  packageJson: PackageJson;
  manifests: WorkspaceManifest[];
  installedPackages: Map<string, string>;
  installedPackageOrigins: Map<string, string[]>;
  scripts: Record<string, string>;
  files: Set<string>;
  sourceFiles: string[];
  sourceRoots: string[];
  workspaceRoots?: string[];
  workspaceSourceFiles?: Record<string, string[]>;
  scopes: RepositoryScope[];
  diagnostics: RepositoryDiagnostic[];
}

export interface ProviderCapabilities {
  [capability: string]: boolean | undefined;
  typeChecking?: boolean;
  linting?: boolean;
  formatting?: boolean;
  testing?: boolean;
  accessibilityRules?: boolean;
  workspaceConsistency?: boolean;
  testCoverage?: boolean;
  mutationTesting?: boolean;
  unusedFiles?: boolean;
  unusedExports?: boolean;
  unusedDependencies?: boolean;
  dependencyCycles?: boolean;
  architectureRules?: boolean;
  vulnerabilities?: boolean;
  supplyChainRisk?: boolean;
  duplication?: boolean;
  bundleBudget?: boolean;
  packagePublishing?: boolean;
  typesCompatibility?: boolean;
  secrets?: boolean;
  licenses?: boolean;
  documentation?: boolean;
  performance?: boolean;
  release?: boolean;
  ciWorkflow?: boolean;
  codeSecurity?: boolean;
  dependencyUpdates?: boolean;
}

export interface ProviderDetection {
  installed: boolean;
  configured: boolean;
  version?: string;
  configFiles: string[];
  evidence: string[];
  availableCapabilities: ProviderCapabilities;
  activeCapabilities: ProviderCapabilities;
}

export interface ProviderRecommendation {
  recommended: boolean;
  priority: "baseline" | "optional" | "advanced";
  actionable: boolean;
  reason: string;
}

export interface PackageInstall {
  name: string;
  version?: string;
  dev: true;
  reason: string;
}

export interface FileChange {
  path: string;
  kind: "create" | "modify";
  before: string | null;
  after: string;
  expectedHash: string | null;
  reason: string;
}

export interface PlannedCommand {
  command: string;
  args: string[];
  reason: string;
}

export interface InstallPlan {
  schemaVersion: 1;
  packages: PackageInstall[];
  files: FileChange[];
  commands: PlannedCommand[];
  warnings: string[];
  conflicts: string[];
}

export interface InstallProgress {
  phase: "writing-files" | "running-command" | "rollback" | "complete";
  current?: number;
  total?: number;
  label?: string;
}

export type FindingSeverity = "info" | "warning" | "error";
export type HealthStatus = "pass" | "warn" | "fail" | "error" | "skipped";

export interface HealthFinding {
  id: string;
  fingerprint: string;
  type: string;
  ruleId?: string;
  title?: string;
  provider: string;
  category: HealthCategory;
  severity: FindingSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  scope?: string;
  remediation?: string;
  documentationUrl?: string;
  baselineState?: "new" | "existing";
  metadata?: Record<string, unknown>;
}

export interface HealthResult {
  provider: string;
  name: string;
  category: HealthCategory;
  status: HealthStatus;
  findings: HealthFinding[];
  durationMs: number;
  message?: string;
  scope?: string;
}

export interface HealthRun {
  schemaVersion: 1;
  generatedAt: string;
  repository: {
    root: string;
    packageManager: PackageManagerId | null;
    kinds: RepositoryKind[];
    frameworks: string[];
    languages: string[];
    workspaces?: string[];
    scopes: Array<{ path: string; roles: RepositoryRole[] }>;
    categories?: Array<{ id: string; label: string; description: string }>;
  };
  summary: {
    status: "healthy" | "findings" | "error";
    findings: number;
    newFindings: number;
    existingFindings: number;
    resolvedFindings: number;
    errors: number;
    exitCode: 0 | 1 | 2;
  };
  results: HealthResult[];
}

export interface BaselineEntry {
  fingerprint: string;
  provider: string;
  category: HealthCategory;
  type: string;
  scope?: string;
  file?: string;
  line?: number;
}

export interface BaselineFile {
  schemaVersion: 1;
  generatedAt: string;
  entries: BaselineEntry[];
}

export interface HealthProvider {
  id: string;
  name: string;
  category: HealthCategory;
  capabilities: ProviderCapabilities;
  detect(context: RepositoryContext): Promise<ProviderDetection>;
  recommend(context: RepositoryContext): Promise<ProviderRecommendation | null>;
  planInstall(context: RepositoryContext): Promise<InstallPlan>;
  run(context: RepositoryContext): Promise<HealthResult>;
}
