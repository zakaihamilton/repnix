import path from "node:path";
import { applyEdits, modify } from "jsonc-parser";
import type { InstallPlan, RepositoryContext } from "../core/types.js";
import { VERSION } from "../core/version.js";
import { installDevCommand } from "../package-manager/package-manager.js";
import { planCiChange } from "./ci-plan.js";
import { fileChange, readOptional } from "./file-plan.js";

export type SetupProviderId = "knip" | "jscpd" | "dependency-cruiser";

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

function quoteScriptArg(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

export async function buildInstallPlan(
  context: RepositoryContext,
  selected: SetupProviderId[],
  includeCi: boolean,
): Promise<InstallPlan> {
  const plan: InstallPlan = { packages: [], files: [], commands: [], warnings: [], conflicts: [] };
  if (!context.packageManager) {
    plan.conflicts.push("A package manager could not be resolved.");
    return plan;
  }
  if (context.packageJson.name !== "repnix" && !context.installedPackages.has("repnix")) {
    plan.packages.push({ name: "repnix", version: `^${VERSION}`, dev: true, reason: "Keep the generated health script locally runnable" });
  }
  for (const provider of selected) {
    if (!context.installedPackages.has(provider)) {
      plan.packages.push({ name: provider, dev: true, reason: `Add ${provider} repository health coverage` });
    }
  }

  const packagePath = path.join(context.root, "package.json");
  const packageBefore = await readOptional(packagePath);
  if (packageBefore === null) throw new Error("package.json disappeared while planning setup");
  let packageAfter = packageBefore;
  const desiredScripts: Record<string, string> = { health: "repnix check" };
  if (selected.includes("knip")) desiredScripts["health:dead-code"] = "knip";
  if (selected.includes("jscpd")) {
    desiredScripts["health:duplication"] = `jscpd ${context.sourceRoots.map(quoteScriptArg).join(" ")}`;
  }
  if (selected.includes("dependency-cruiser")) {
    desiredScripts["health:architecture"] = `depcruise --output-type json --config -- ${context.sourceRoots.map(quoteScriptArg).join(" ")}`;
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
