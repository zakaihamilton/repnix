import path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import type { InstallPlan, RepositoryContext } from "../core/types.js";
import { fileChange, readOptional } from "../setup/file-plan.js";
import { setJsonValue } from "../setup/json-edit.js";

function emptyPlan(): InstallPlan {
  return { schemaVersion: 1, packages: [], files: [], commands: [], warnings: [], conflicts: [] };
}

function stringList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : null;
}

function installedAtRoot(context: RepositoryContext, name: string): boolean {
  return context.installedPackageOrigins.get(name)?.includes("package.json") === true;
}

function changesetsConfig(baseBranch: string): string {
  return `${JSON.stringify({
    changelog: "@changesets/cli/changelog",
    commit: false,
    fixed: [],
    linked: [],
    access: "restricted",
    baseBranch,
    updateInternalDependencies: "patch",
    ignore: [],
    bumpVersionsWithWorkspaceProtocolOnly: false,
    changedFilePatterns: ["**"],
    format: "auto",
    privatePackages: { version: false, tag: false },
  }, null, 2)}\n`;
}

export async function planJsxA11yInstall(context: RepositoryContext): Promise<InstallPlan> {
  const plan = emptyPlan();
  const eslintPath = ".eslintrc.json";
  const eslintBefore = context.files.has(eslintPath) ? await readOptional(path.join(context.root, eslintPath)) : null;
  if (eslintBefore === null) {
    plan.conflicts.push("eslint-plugin-jsx-a11y requires a root .eslintrc.json configuration, which was not found.");
    return plan;
  }
  const errors: ParseError[] = [];
  const parsed = parse(eslintBefore, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    plan.conflicts.push(".eslintrc.json is not a valid JSON object and was preserved.");
    return plan;
  }
  const config = parsed as Record<string, unknown>;
  const plugins = stringList(config.plugins);
  const extendsEntries = stringList(config.extends);
  if (!plugins || !extendsEntries) {
    plan.conflicts.push(".eslintrc.json has non-string plugins or extends entries and was preserved.");
    return plan;
  }
  const afterPlugins = [...new Set([...plugins, "jsx-a11y"])];
  const afterExtends = [...new Set([...extendsEntries, "plugin:jsx-a11y/recommended"])];
  let eslintAfter = setJsonValue(eslintBefore, ["plugins"], afterPlugins);
  eslintAfter = setJsonValue(eslintAfter, ["extends"], afterExtends);
  const change = fileChange(eslintPath, eslintBefore, eslintAfter, "Enable jsx-a11y recommended accessibility rules");
  if (change) plan.files.push(change);
  if (!installedAtRoot(context, "eslint-plugin-jsx-a11y")) {
    plan.packages.push({ name: "eslint-plugin-jsx-a11y", dev: true, reason: "Add JSX accessibility health coverage" });
  }
  return plan;
}

export async function planChangesetsInstall(context: RepositoryContext): Promise<InstallPlan> {
  const plan = emptyPlan();
  const configPath = ".changeset/config.json";
  if (context.files.has(configPath)) {
    plan.warnings.push(`${configPath} was preserved; its existing release policy will be used.`);
    return plan;
  }
  if (!context.gitDefaultBranch) {
    plan.conflicts.push("Changesets needs the Git remote default branch, which could not be resolved safely.");
    return plan;
  }
  const change = fileChange(configPath, null, changesetsConfig(context.gitDefaultBranch), "Create standard Changesets release configuration");
  if (change) plan.files.push(change);
  return plan;
}
