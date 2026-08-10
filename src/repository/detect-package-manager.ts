import type { PackageJson, PackageManagerId, RepositoryDiagnostic } from "../core/types.js";

const LOCKFILES: Record<string, PackageManagerId> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
};

export interface PackageManagerDetection {
  packageManager: PackageManagerId | null;
  evidence?: string;
  diagnostics: RepositoryDiagnostic[];
}

export function detectPackageManager(
  packageJson: PackageJson,
  files: Set<string>,
): PackageManagerDetection {
  const diagnostics: RepositoryDiagnostic[] = [];
  const declared = packageJson.packageManager?.split("@")[0];
  if (declared) {
    if (["npm", "pnpm", "yarn", "bun"].includes(declared)) {
      return {
        packageManager: declared as PackageManagerId,
        evidence: `package.json packageManager (${packageJson.packageManager})`,
        diagnostics,
      };
    }
    diagnostics.push({
      code: "unsupported-package-manager",
      severity: "error",
      message: `Unsupported package manager declared in package.json: ${declared}`,
    });
    return { packageManager: null, diagnostics };
  }

  const detected = new Map<PackageManagerId, string[]>();
  for (const [lockfile, manager] of Object.entries(LOCKFILES)) {
    if (files.has(lockfile)) {
      detected.set(manager, [...(detected.get(manager) ?? []), lockfile]);
    }
  }
  if (detected.size === 1) {
    const [manager, lockfiles] = [...detected.entries()][0]!;
    return {
      packageManager: manager,
      evidence: lockfiles.join(", "),
      diagnostics,
    };
  }
  if (detected.size > 1) {
    diagnostics.push({
      code: "ambiguous-package-manager",
      severity: "error",
      message: `Conflicting lockfiles detected: ${[...detected.values()].flat().join(", ")}. Add a packageManager field or remove stale lockfiles.`,
    });
    return { packageManager: null, diagnostics };
  }
  diagnostics.push({
    code: "missing-package-manager",
    severity: "warning",
    message: "No packageManager field or supported lockfile was found; npm is assumed for read-only commands.",
  });
  return {
    packageManager: "npm",
    evidence: "default (no lockfile)",
    diagnostics,
  };
}
