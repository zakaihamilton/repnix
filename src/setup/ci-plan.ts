import path from "node:path";
import { parseDocument } from "yaml";
import type { FileChange, PackageManagerId, RepositoryContext } from "../core/types.js";
import { fileChange, readOptional } from "./file-plan.js";

type YamlRange = [number, number, number];

interface YamlScalarNode {
  value?: unknown;
}

interface YamlPair {
  key?: YamlScalarNode;
  value?: unknown;
}

interface YamlMapNode {
  items: YamlPair[];
  range?: YamlRange | null;
  get(key: string, keepScalar?: boolean): unknown;
}

interface YamlSeqNode {
  items: unknown[];
}

interface CiCandidate {
  file: string;
  content: string;
  step: YamlMapNode;
  jobId: string;
  installManager: PackageManagerId;
  score: number;
}

const PACKAGE_MANAGERS: PackageManagerId[] = ["npm", "pnpm", "yarn", "bun"];

function asYamlMap(value: unknown): YamlMapNode | null {
  if (!value || typeof value !== "object" || !("items" in value) || !("get" in value)) return null;
  return value as YamlMapNode;
}

function asYamlSeq(value: unknown): YamlSeqNode | null {
  if (!value || typeof value !== "object" || !("items" in value)) return null;
  return value as YamlSeqNode;
}

function scalarValue(value: unknown): unknown {
  if (value && typeof value === "object" && "value" in value) return (value as YamlScalarNode).value;
  return value;
}

function commandValue(value: unknown): string | undefined {
  const command = scalarValue(value);
  return typeof command === "string" ? command.trim() : undefined;
}

function isAction(value: unknown, action: string): boolean {
  const uses = commandValue(value);
  return uses?.startsWith(`${action}@`) === true;
}

function isInstallCommand(command: string | undefined, manager: PackageManagerId): boolean {
  if (!command) return false;
  const normalized = command.replace(/^corepack\s+/, "");
  if (manager === "npm") return /^(?:npm\s+(?:ci|install|i))(?:\s|$)/.test(normalized);
  if (manager === "pnpm") return /^pnpm\s+(?:install|i)(?:\s|$)/.test(normalized);
  if (manager === "yarn") return /^(?:yarn|yarnpkg)(?:\s+install|\s+--(?:frozen-lockfile|immutable(?:-[\w-]+)?))(?:\s|$)/.test(normalized) || normalized === "yarn" || normalized === "yarnpkg";
  return /^bun\s+install(?:\s|$)/.test(normalized);
}

function jobScore(jobId: string, job: YamlMapNode, manager: PackageManagerId): number {
  const normalizedId = jobId.toLowerCase();
  const steps = asYamlSeq(job.get("steps", true));
  const commands = steps?.items.map(asYamlMap).filter((step): step is YamlMapNode => step !== null)
    .map((step) => commandValue(step.get("run", true)) ?? "") ?? [];
  let score = 0;
  if (/^(?:test|tests|ci|check|checks|quality|verify)$/.test(normalizedId)) score += 20;
  else if (/(?:test|ci|check|quality|verify)/.test(normalizedId)) score += 10;
  if (commands.some((command) => new RegExp(`^(?:${manager}|corepack\\s+${manager})\\s+(?:run\\s+)?(?:test|check|health)\\b`).test(command))) score += 5;
  if (commands.some((command) => /\b(?:test|check|health)\b/.test(command))) score += 2;
  return score;
}

function jobInstallCandidate(job: YamlMapNode, preferredManager: PackageManagerId): { step: YamlMapNode; manager: PackageManagerId } | null {
  const steps = asYamlSeq(job.get("steps", true));
  if (!steps) return null;
  const stepMaps = steps.items.map(asYamlMap).filter((step): step is YamlMapNode => step !== null);
  const hasCheckout = stepMaps.some((step) => isAction(step.get("uses", true), "actions/checkout"));
  if (!hasCheckout) return null;
  const installSteps = stepMaps.flatMap((step) => {
    const command = commandValue(step.get("run", true));
    const managers = PACKAGE_MANAGERS.filter((manager) => isInstallCommand(command, manager));
    return managers.length === 1 ? [{ step, manager: managers[0]! }] : [];
  });
  const preferredSteps = installSteps.filter(({ manager }) => manager === preferredManager);
  if (preferredSteps.length === 1) return preferredSteps[0]!;
  return installSteps.length === 1 ? installSteps[0]! : null;
}

function workflowCandidates(content: string, file: string, manager: PackageManagerId): CiCandidate[] {
  const parsed = parseDocument(content);
  if (parsed.errors.length) return [];
  const jobs = asYamlMap(parsed.get("jobs", true));
  if (!jobs) return [];
  const candidates: CiCandidate[] = [];
  for (const pair of jobs.items) {
    const job = asYamlMap(pair.value);
    if (!job) continue;
    const installCandidate = jobInstallCandidate(job, manager);
    const jobId = commandValue(pair.key) ?? "unnamed";
    if (installCandidate) {
      candidates.push({
        file,
        content,
        step: installCandidate.step,
        jobId,
        installManager: installCandidate.manager,
        score: jobScore(jobId, job, installCandidate.manager),
      });
    }
  }
  return candidates;
}

function insertAfterStep(content: string, step: YamlMapNode, manager: PackageManagerId): string | null {
  const range = step.range;
  if (!range) return null;
  const lineStart = content.lastIndexOf("\n", range[0] - 1) + 1;
  const sequencePrefix = content.slice(lineStart, range[0]).replace(/\r$/, "");
  const indentMatch = /^(\s*)-\s*$/.exec(sequencePrefix);
  if (!indentMatch) return null;
  const indent = indentMatch[1]!;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lineEnd = content.indexOf("\n", Math.max(range[2] - 1, 0));
  const insertAt = lineEnd === -1 ? content.length : lineEnd + 1;
  const suffix = content.slice(insertAt);
  const leadingEol = lineEnd === -1 && !content.endsWith("\n") ? eol : "";
  const trailingEol = suffix ? eol : "";
  const addition = `${leadingEol}${indent}- name: Repository health${eol}${indent}  run: ${manager} run health${trailingEol}`;
  return `${content.slice(0, insertAt)}${addition}${suffix}`;
}

function manualCiWarning(manager: PackageManagerId, candidates: CiCandidate[]): string {
  const locations = candidates.length
    ? ` Candidates: ${candidates.map((candidate) => `${candidate.file}#${candidate.jobId} (${candidate.installManager})`).join(", ")}.`
    : "";
  return `RepNix could not find one unambiguous GitHub Actions job with a ${manager} install step.${locations} Add this step manually after dependencies are installed:\n- name: Repository health\n  run: ${manager} run health`;
}

export async function planCiChange(
  context: RepositoryContext,
  manager: PackageManagerId,
): Promise<{ change: FileChange | null; warning?: string }> {
  const workflows = [...context.files].filter((file) => /^\.github\/workflows\/.*\.ya?ml$/.test(file));
  const candidates: CiCandidate[] = [];
  let hasExistingHealth = false;
  for (const file of workflows) {
    const content = await readOptional(path.join(context.root, file));
    if (!content) continue;
    if (/(?:repnix\s+check|(?:npm|pnpm|yarn|bun)\s+run\s+health)/.test(content)) {
      hasExistingHealth = true;
      continue;
    }
    candidates.push(...workflowCandidates(content, file, manager));
  }
  if (hasExistingHealth) return { change: null };
  if (!candidates.length) return { change: null, warning: manualCiWarning(manager, candidates) };
  const sorted = [...candidates].sort((left, right) => right.score - left.score);
  const candidate = sorted[0]!;
  if (sorted.length > 1 && candidate.score === sorted[1]!.score) {
    return { change: null, warning: manualCiWarning(manager, candidates) };
  }
  const after = insertAfterStep(candidate.content, candidate.step, candidate.installManager);
  if (after === null) return { change: null, warning: manualCiWarning(manager, candidates) };
  return {
    change: fileChange(candidate.file, candidate.content, after, "Add repository health to GitHub Actions"),
  };
}
