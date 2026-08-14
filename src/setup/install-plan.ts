import path from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyEdits, modify } from "jsonc-parser";
import type { InstallPlan, RepositoryContext } from "../core/types.js";
import { VERSION } from "../core/version.js";
import { installDevCommand } from "../package-manager/package-manager.js";
import { planCiChange } from "./ci-plan.js";
import { fileChange, readOptional } from "./file-plan.js";
import { markdownlintScriptCommand } from "../providers/markdownlint/command.js";
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

const MARKDOWNLINT_SCRIPT = markdownlintScriptCommand();
const GENERATED_SCRIPT_MIGRATIONS: Record<string, Record<string, string>> = {
  "health:documentation": {
    "markdownlint-cli2 \"**/*.md\"": MARKDOWNLINT_SCRIPT,
    "markdownlint-cli2 \"**/*.md\" \"#node_modules\"": MARKDOWNLINT_SCRIPT,
  },
};

async function localRepnixPackageSpec(): Promise<string | undefined> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    await access(path.join(packageRoot, ".git"));
    await access(path.join(packageRoot, "package.json"));
    return pathToFileURL(packageRoot).href;
  } catch {
    return undefined;
  }
}

function formattingOptions(raw: string) {
  const indent = raw.match(/\n([\t ]+)\S/)?.[1] ?? "  ";
  return { insertSpaces: !indent.includes("\t"), tabSize: indent.includes("\t") ? 1 : indent.length, eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

function setJsonValue(raw: string, jsonPath: (string | number)[], value: unknown): string {
  return applyEdits(raw, modify(raw, jsonPath, value, { formattingOptions: formattingOptions(raw) }));
}

function addRepnixIgnore(before: string | null): string | null {
  const entry = ".repnix/";
  if (before === null || before.trim() === "") return `${entry}\n`;
  if (before.split(/\r?\n/).some((line) => /^\/?\.repnix\/?$/.test(line.trim()))) return null;
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  return `${before.endsWith("\n") ? before : `${before}${eol}`}${entry}${eol}`;
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
  const skipGenericSetup = new Set<string>();
  const customPackages = new Map<string, InstallPlan["packages"]>();
  for (const providerId of selected) {
    const definition = providerRegistry.get(providerId);
    if (!definition?.planInstall) continue;
    const customPlan = await definition.planInstall(context);
    customPackages.set(providerId, customPlan.packages);
    plan.files.push(...customPlan.files);
    plan.commands.push(...customPlan.commands);
    plan.warnings.push(...customPlan.warnings);
    plan.conflicts.push(...customPlan.conflicts);
    if (!definition.setup || (customPlan.conflicts.length > 0 && customPlan.files.length === 0 && customPlan.packages.length === 0)) {
      skipGenericSetup.add(providerId);
    }
  }
  const installedAtRoot = (name: string) => context.installedPackageOrigins.get(name)?.includes("package.json") === true;
  if (context.packageJson.name !== "repnix" && !installedAtRoot("repnix")) {
    const version = await localRepnixPackageSpec() ?? `^${VERSION}`;
    plan.packages.push({ name: "repnix", version, dev: true, reason: "Keep the generated health script locally runnable" });
  }
  for (const provider of selected) {
    plan.packages.push(...(customPackages.get(provider) ?? []));
    if (skipGenericSetup.has(provider)) continue;
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
  const desiredScripts: Record<string, string> = { health: "repnix check" };
  for (const provider of selected) {
    if (skipGenericSetup.has(provider)) continue;
    const setup = providerRegistry.get(provider)?.setup;
    if (!setup) continue;
    desiredScripts[setup.scriptName] = setup.scriptCommand(context);
  }
  for (const [name, command] of Object.entries(desiredScripts)) {
    const existing = context.scripts[name];
    if (existing && existing !== command) {
      // Update only a byte-for-byte match of an older RepNix-generated script.
      // Any user-customized command remains a conflict and is never overwritten.
      if (GENERATED_SCRIPT_MIGRATIONS[name]?.[existing] === command) {
        packageAfter = setJsonValue(packageAfter, ["scripts", name], command);
        continue;
      }
      plan.conflicts.push(`package.json script '${name}' already exists and was preserved.`);
      continue;
    }
    if (!existing) packageAfter = setJsonValue(packageAfter, ["scripts", name], command);
  }
  const packageChange = fileChange("package.json", packageBefore, packageAfter, "Add RepNix health scripts");
  if (packageChange) plan.files.push(packageChange);

  const gitignorePath = path.join(context.root, ".gitignore");
  const gitignoreBefore = await readOptional(gitignorePath);
  const gitignoreAfter = addRepnixIgnore(gitignoreBefore);
  if (gitignoreAfter !== null) {
    const change = fileChange(".gitignore", gitignoreBefore, gitignoreAfter, "Ignore generated RepNix setup reports");
    if (change) plan.files.push(change);
  }

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
