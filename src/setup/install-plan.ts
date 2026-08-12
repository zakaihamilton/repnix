import path from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import type { InstallPlan, RepositoryContext } from "../core/types.js";
import { VERSION } from "../core/version.js";
import { installDevCommand } from "../package-manager/package-manager.js";
import { planCiChange } from "./ci-plan.js";
import { fileChange, readOptional } from "./file-plan.js";
import { createProviderRegistry, type ProviderRegistry } from "../providers/registry.js";

export type SetupProviderId = string;

const JSCPD_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/generated/**",
  "**/*.generated.*",
];

function formattingOptions(raw: string) {
  const indent = raw.match(/\n([\t ]+)\S/)?.[1] ?? "  ";
  return { insertSpaces: !indent.includes("\t"), tabSize: indent.includes("\t") ? 1 : indent.length, eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

function setJsonValue(raw: string, jsonPath: (string | number)[], value: unknown): string {
  return applyEdits(raw, modify(raw, jsonPath, value, { formattingOptions: formattingOptions(raw) }));
}

function stringList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : null;
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

export async function buildInstallPlan(
  context: RepositoryContext,
  selected: SetupProviderId[],
  includeCi: boolean,
  registry?: ProviderRegistry,
): Promise<InstallPlan> {
  const plan: InstallPlan = { schemaVersion: 1, packages: [], files: [], commands: [], warnings: [], conflicts: [] };
  if (!context.packageManager) {
    plan.conflicts.push("A package manager could not be resolved.");
    return plan;
  }
  const providerRegistry = registry ?? await createProviderRegistry(context);
  const customProviders = new Set<string>();
  if (selected.includes("jsx-a11y")) customProviders.add("jsx-a11y");
  if (selected.includes("changesets") && !context.gitDefaultBranch && !context.files.has(".changeset/config.json")) customProviders.add("changesets");
  for (const providerId of selected) {
    const definition = providerRegistry.get(providerId);
    if (!definition?.planInstall) continue;
    const customPlan = await definition.planInstall(context);
    plan.packages.push(...customPlan.packages);
    plan.files.push(...customPlan.files);
    plan.commands.push(...customPlan.commands);
    plan.warnings.push(...customPlan.warnings);
    plan.conflicts.push(...customPlan.conflicts);
    customProviders.add(providerId);
  }
  const installedAtRoot = (name: string) => context.installedPackageOrigins.get(name)?.includes("package.json") === true;
  if (context.packageJson.name !== "repnix" && !installedAtRoot("repnix")) {
    plan.packages.push({ name: "repnix", version: `^${VERSION}`, dev: true, reason: "Keep the generated health script locally runnable" });
  }
  for (const provider of selected) {
    if (customProviders.has(provider)) continue;
    const definition = providerRegistry.get(provider);
    if (!definition?.setup) {
      plan.conflicts.push(`Provider '${provider}' has no safe setup recipe and was not installed.`);
      continue;
    }
    const packageName = definition.setup.packageName;
    if (!installedAtRoot(packageName)) {
      plan.packages.push({ name: packageName, dev: true, reason: `Add ${provider} repository health coverage` });
    }
  }

  const packagePath = path.join(context.root, "package.json");
  const packageBefore = await readOptional(packagePath);
  if (packageBefore === null) throw new Error("package.json disappeared while planning setup");
  let packageAfter = packageBefore;
  if (selected.includes("jsx-a11y")) {
    const eslintPath = ".eslintrc.json";
    const eslintBefore = context.files.has(eslintPath) ? await readOptional(path.join(context.root, eslintPath)) : null;
    if (eslintBefore === null) {
      plan.conflicts.push("eslint-plugin-jsx-a11y requires a root .eslintrc.json configuration, which was not found.");
    } else {
      const errors: ParseError[] = [];
      const parsed = parse(eslintBefore, errors, { allowTrailingComma: true, disallowComments: false });
      if (errors.length || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        plan.conflicts.push(".eslintrc.json is not a valid JSON object and was preserved.");
      } else {
        const config = parsed as Record<string, unknown>;
        const plugins = stringList(config.plugins);
        const extendsEntries = stringList(config.extends);
        if (!plugins || !extendsEntries) {
          plan.conflicts.push(".eslintrc.json has non-string plugins or extends entries and was preserved.");
        } else {
          const afterPlugins = [...new Set([...plugins, "jsx-a11y"])];
          const afterExtends = [...new Set([...extendsEntries, "plugin:jsx-a11y/recommended"])];
          let eslintAfter = setJsonValue(eslintBefore, ["plugins"], afterPlugins);
          eslintAfter = setJsonValue(eslintAfter, ["extends"], afterExtends);
          const change = fileChange(eslintPath, eslintBefore, eslintAfter, "Enable jsx-a11y recommended accessibility rules");
          if (change) plan.files.push(change);
          if (!installedAtRoot("eslint-plugin-jsx-a11y")) {
            plan.packages.push({ name: "eslint-plugin-jsx-a11y", dev: true, reason: "Add JSX accessibility health coverage" });
          }
        }
      }
    }
  }
  const desiredScripts: Record<string, string> = { health: "repnix check" };
  for (const provider of selected) {
    if (customProviders.has(provider)) continue;
    const setup = providerRegistry.get(provider)?.setup;
    if (!setup) continue;
    desiredScripts[setup.scriptName] = setup.scriptCommand(context);
  }
  for (const [name, command] of Object.entries(desiredScripts)) {
    const existing = context.scripts[name];
    if (existing && existing !== command) {
      plan.conflicts.push(`package.json script '${name}' already exists and was preserved.`);
      continue;
    }
    if (!existing) packageAfter = setJsonValue(packageAfter, ["scripts", name], command);
  }
  const packageChange = fileChange("package.json", packageBefore, packageAfter, "Add RepNix health scripts");
  if (packageChange) plan.files.push(packageChange);

  const repnixConfigPath = path.join(context.root, "repnix.config.json");
  const repnixConfigBefore = await readOptional(repnixConfigPath);
  if (repnixConfigBefore === null) {
    const repnixConfigAfter = `${JSON.stringify({
      schemaVersion: 1,
      severityThreshold: "warning",
      execution: { jobs: 2, timeoutSeconds: 300 },
    }, null, 2)}\n`;
    const change = fileChange("repnix.config.json", null, repnixConfigAfter, "Record repository health policy and selected built-in providers");
    if (change) plan.files.push(change);
  }

  if (selected.includes("jscpd")) {
    const configFile = [".jscpd.json", "jscpd.json"].find((file) => context.files.has(file));
    if (configFile) {
      const before = await readOptional(path.join(context.root, configFile));
      if (before !== null) {
        try {
          const parsed = JSON.parse(before) as { ignore?: unknown };
          if (
            parsed.ignore !== undefined &&
            (!Array.isArray(parsed.ignore) || parsed.ignore.some((item) => typeof item !== "string"))
          ) {
            plan.conflicts.push(`${configFile} has a non-array ignore value and was preserved.`);
          } else {
            const ignore = [...new Set([...(parsed.ignore as string[] | undefined ?? []), ...JSCPD_IGNORES])];
            const after = setJsonValue(before, ["ignore"], ignore);
            const change = fileChange(configFile, before, after, "Add safe jscpd exclusions");
            if (change) plan.files.push(change);
          }
        } catch {
          plan.conflicts.push(`${configFile} is not valid JSON and was preserved.`);
        }
      }
    } else if (Object.hasOwn(context.packageJson, "jscpd")) {
      plan.warnings.push("jscpd configuration in package.json was preserved; verify its exclusions manually.");
    } else {
      const after = `${JSON.stringify({ ignore: JSCPD_IGNORES }, null, 2)}\n`;
      const change = fileChange(".jscpd.json", null, after, "Create minimal jscpd exclusions");
      if (change) plan.files.push(change);
    }
  }

  if (selected.includes("dependency-cruiser")) {
    const existingConfig = [
      ".dependency-cruiser.json",
      ".dependency-cruiser.js",
      ".dependency-cruiser.cjs",
      ".dependency-cruiser.mjs",
      ".dependency-cruiser.ts",
    ].find((file) => context.files.has(file));
    if (existingConfig) {
      plan.warnings.push(`${existingConfig} was preserved; its existing architecture rules will be used.`);
    } else {
      const config = `module.exports = {\n  forbidden: [\n    {\n      name: "no-circular",\n      comment: "Prevent dependency cycles.",\n      severity: "error",\n      from: {},\n      to: { circular: true },\n    },\n    {\n      name: "no-source-to-test",\n      comment: "Production source must not depend on tests.",\n      severity: "error",\n      from: { path: "^(src|app|pages)(/|$)" },\n      to: { path: "(^|/)(test|tests|__tests__)(/|$)|\\\\.(spec|test)\\\\.[cm]?[jt]sx?$" },\n    },\n  ],\n  options: {\n    doNotFollow: { path: "node_modules" },\n    exclude: { path: "(^|/)(dist|build|coverage|\\\\.next|generated)(/|$)" },\n  },\n};\n`;
      const change = fileChange(".dependency-cruiser.cjs", null, config, "Create conservative architecture rules");
      if (change) plan.files.push(change);
    }
  }

  if (selected.includes("changesets")) {
    const configPath = ".changeset/config.json";
    if (context.files.has(configPath)) {
      plan.warnings.push(`${configPath} was preserved; its existing release policy will be used.`);
    } else if (!context.gitDefaultBranch) {
      plan.conflicts.push("Changesets needs the Git remote default branch, which could not be resolved safely.");
    } else {
      const change = fileChange(configPath, null, changesetsConfig(context.gitDefaultBranch), "Create standard Changesets release configuration");
      if (change) plan.files.push(change);
    }
  }

  if (includeCi) {
    const ci = await planCiChange(context, context.packageManager);
    if (ci.change && !plan.conflicts.some((conflict) => conflict.includes("script 'health'"))) plan.files.push(ci.change);
    if (ci.warning) plan.warnings.push(ci.warning);
  }
  if (plan.packages.length) {
    const packages = plan.packages.map((item) => `${item.name}${item.version ? `@${item.version}` : ""}`);
    plan.commands.push(installDevCommand(context.packageManager, packages));
  }
  return plan;
}
