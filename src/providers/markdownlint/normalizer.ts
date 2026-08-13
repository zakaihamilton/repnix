import path from "node:path";
import { createFinding } from "../../core/finding.js";
import type { HealthFinding } from "../../core/types.js";

const MARKDOWNLINT_LINE = /^(.+?):(\d+)(?::(\d+))?\s+(error|warning)\s+(MD\d+(?:\/[\w-]+)*)\s+(.+)$/;

export function normalizeMarkdownlint(output: string, root = process.cwd()): HealthFinding[] {
  const findings: HealthFinding[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = MARKDOWNLINT_LINE.exec(line.trim());
    if (!match) continue;
    const file = path.isAbsolute(match[1]!) ? path.relative(root, match[1]!) : match[1]!;
    const ruleId = match[5]!;
    const rule = ruleId.split("/")[0]!;
    findings.push(createFinding({
      provider: "markdownlint",
      category: "documentation",
      type: "markdown-style",
      ruleId,
      title: ruleId,
      severity: match[4] === "warning" ? "warning" : "error",
      message: match[6]!,
      file,
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
      remediation: `Correct the ${ruleId} Markdown issue or configure the rule intentionally.`,
      documentationUrl: `https://github.com/DavidAnson/markdownlint/blob/main/doc/${rule.toLowerCase()}.md`,
    }));
  }
  return findings;
}

export function normalizeMarkdownlintResult(input: {
  output: string;
  result: { stdout: string; stderr: string };
  context: { root: string };
}): HealthFinding[] {
  return normalizeMarkdownlint(`${input.result.stdout}\n${input.result.stderr}`.trim() || input.output, input.context.root);
}
