import path from "node:path";
import { parseDocument } from "yaml";
import type { FileChange, PackageManagerId, RepositoryContext } from "../core/types.js";
import { fileChange, readOptional } from "./file-plan.js";

const INSTALL_PATTERN = /^(\s*)-\s+run:\s+(?:npm\s+(?:ci|install)|pnpm\s+install|yarn\s+install|bun\s+install)\s*$/gm;

export async function planCiChange(
  context: RepositoryContext,
  manager: PackageManagerId,
): Promise<{ change: FileChange | null; warning?: string }> {
  const workflows = [...context.files].filter((file) => /^\.github\/workflows\/.*\.ya?ml$/.test(file));
  const candidates: Array<{ file: string; content: string; match: RegExpExecArray }> = [];
  for (const file of workflows) {
    const content = await readOptional(path.join(context.root, file));
    if (!content || /(?:repnix\s+check|(?:npm|pnpm|yarn|bun)\s+run\s+health)/.test(content)) continue;
    const parsed = parseDocument(content);
    if (parsed.errors.length) continue;
    const workflow = parsed.toJS() as { jobs?: Record<string, { steps?: Array<{ uses?: string; run?: string }> }> };
    const managerInstall = new RegExp(`^${manager}\\s+${manager === "npm" ? "(?:ci|install)" : "install"}(?:\\s|$)`);
    const eligibleJobs = Object.values(workflow.jobs ?? {}).filter((job) => {
      const steps = Array.isArray(job.steps) ? job.steps : [];
      return (
        steps.some((step) => typeof step.uses === "string" && step.uses.startsWith("actions/checkout@")) &&
        steps.some((step) => typeof step.uses === "string" && step.uses.startsWith("actions/setup-node@")) &&
        steps.filter((step) => typeof step.run === "string" && managerInstall.test(step.run.trim())).length === 1
      );
    });
    if (eligibleJobs.length !== 1) continue;
    const matches = [...content.matchAll(INSTALL_PATTERN)];
    if (matches.length === 1) candidates.push({ file, content, match: matches[0]! });
  }
  if (candidates.length !== 1) {
    return {
      change: null,
      warning: `GitHub Actions was not modified safely. Add this step manually:\n- name: Repository health\n  run: ${manager} run health`,
    };
  }
  const candidate = candidates[0]!;
  const indent = candidate.match[1] ?? "";
  const insertAt = candidate.match.index! + candidate.match[0].length;
  const addition = `\n${indent}- name: Repository health\n${indent}  run: ${manager} run health`;
  const after = `${candidate.content.slice(0, insertAt)}${addition}${candidate.content.slice(insertAt)}`;
  return {
    change: fileChange(candidate.file, candidate.content, after, "Add repository health to GitHub Actions"),
  };
}
