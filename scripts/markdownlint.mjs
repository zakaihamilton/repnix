import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "markdownlint/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  ".changeset",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "playwright-report",
  "test-results",
]);

async function collectMarkdownFiles(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith(".")) {
        files.push(
          ...(await collectMarkdownFiles(
            path.join(directory, entry.name),
            path.posix.join(relativeDirectory, entry.name),
          )),
        );
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
      files.push(path.posix.join(relativeDirectory, entry.name));
    }
  }

  return files;
}

const files = await collectMarkdownFiles(root);
const config = JSON.parse(await readFile(path.join(root, ".markdownlint.json"), "utf8"));
const results = await lint({
  files: files.map((file) => path.join(root, file)),
  config,
});
let issueCount = 0;

for (const [file, issues] of Object.entries(results)) {
  for (const issue of issues) {
    const rule = issue.ruleNames.join(", ");
    const detail = issue.errorDetail ? `: ${issue.errorDetail}` : "";
    console.error(`${path.relative(root, file)}:${issue.lineNumber} ${rule} ${issue.ruleDescription}${detail}`);
    issueCount += 1;
  }
}

if (issueCount > 0) process.exitCode = 1;
