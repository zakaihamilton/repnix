import type { DiagnosticLogger } from "../../../cli/options.js";
import type { RepnixConfig } from "../../../config/repo-health-config.js";
import { createFinding } from "../../../core/finding.js";
import type { HealthFinding, HealthResult, RepositoryContext } from "../../../core/types.js";
import { normalizeOsv } from "../../../providers/osv/normalizer.js";
import {
  missingLocalBinaryResult,
  type ProviderMeta,
  providerErrorResult,
  runJsonProviderCommand,
} from "../runner-helpers.js";
import { executableBinary, localBinary, resolveLogger } from "../task-executor.js";

const LICENSE_META: ProviderMeta = {
  provider: "license-checker",
  name: "license-checker",
  category: "licenses",
};

const OSV_META: ProviderMeta = {
  provider: "osv-scanner",
  name: "OSV-Scanner",
  category: "security",
};

export async function runLicensePolicy(
  context: RepositoryContext,
  config: RepnixConfig,
  logger: DiagnosticLogger,
  timeoutMs?: number,
): Promise<HealthResult> {
  const binary = await localBinary(context.root, "license-checker");
  if (!binary) return missingLocalBinaryResult(LICENSE_META);
  return runJsonProviderCommand({
    meta: LICENSE_META,
    binary,
    args: ["--json"],
    context,
    logger,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    parseFindings: (report) => {
      const allow = new Set(config.policies?.licenses?.allow ?? []);
      const deny = new Set(config.policies?.licenses?.deny ?? []);
      const findings: HealthFinding[] = [];
      if (report && typeof report === "object") {
        for (const [dependency, value] of Object.entries(report as Record<string, unknown>)) {
          const license =
            value && typeof value === "object" && typeof (value as Record<string, unknown>).licenses === "string"
              ? ((value as Record<string, unknown>).licenses as string)
              : "UNKNOWN";
          if (deny.has(license) || (allow.size > 0 && !allow.has(license))) {
            findings.push(
              createFinding({
                provider: "license-checker",
                category: "licenses",
                type: "license-policy",
                severity: "error",
                message: `${dependency} uses license ${license}, which is outside the configured license policy.`,
                metadata: { dependency, license },
              }),
            );
          }
        }
      }
      return findings;
    },
  });
}

export async function runOsvScanner(
  context: RepositoryContext,
  diagnostics: DiagnosticLogger | boolean,
  timeoutMs?: number,
): Promise<HealthResult> {
  const logger = resolveLogger(diagnostics);
  const binary = await executableBinary(context.root, "osv-scanner", true);
  if (!binary) {
    return providerErrorResult(OSV_META, "OSV-Scanner is configured but its executable is unavailable.");
  }
  return runJsonProviderCommand({
    meta: OSV_META,
    binary,
    args: ["scan", "source", "--offline-vulnerabilities", "--format=json", "--recursive", "."],
    context,
    logger,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    nonZeroMessage: "OSV-Scanner could not complete its offline scan.",
    parseFindings: normalizeOsv,
  });
}
