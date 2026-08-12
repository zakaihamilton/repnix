import { categoryModeFor, type RepnixConfig } from "../../config/repo-health-config.js";
import type { HealthCategory } from "../../core/health-category.js";
import type { HealthResult } from "../../core/types.js";
import type { AuditModel } from "../../recommendations/recommendation-engine.js";
import type { DiagnosticLogger } from "../../cli/options.js";
import { PROVIDERS } from "../../providers/catalog.js";
import { BUILTIN_RUNNERS } from "./builtin-providers.js";
import { basicCommands } from "./basic-commands.js";
import { runGenericProvider, runProviderModule, runRunnableCommand, type RunnableCommand } from "./task-executor.js";

export interface HealthTask {
  id: string;
  provider: string;
  name: string;
  category: HealthCategory;
  scope?: string;
  dependsOn?: string;
  run(completed: ReadonlyMap<string, HealthResult>): Promise<HealthResult>;
}

export interface TaskPlannerOptions {
  category?: HealthCategory;
  timeoutMs: number;
  logger: DiagnosticLogger;
}

function enabledCategory(audit: AuditModel, config: RepnixConfig, category: HealthCategory, scope?: string): boolean {
  if (scope !== undefined) return categoryModeFor(config, category, scope) !== "off";
  return audit.coverage.find((entry) => entry.category === category)?.status !== "off";
}

function selected(category: HealthCategory, options: TaskPlannerOptions): boolean {
  return !options.category || options.category === category;
}

function commandTask(command: RunnableCommand, audit: AuditModel, options: TaskPlannerOptions): HealthTask {
  return { id: command.provider, provider: command.provider, name: command.name, category: command.category, ...(command.scope ? { scope: command.scope } : {}), run: () => runRunnableCommand(command, audit.context, options.logger) };
}

function derivedLintTask(provider: string, name: string, category: HealthCategory, lintTask: HealthTask | undefined): HealthTask {
  return {
    id: provider,
    provider,
    name,
    category,
    ...(lintTask ? { dependsOn: lintTask.id } : {}),
    async run(completed) {
      const lint = lintTask ? completed.get(lintTask.id) : undefined;
      return { provider, name, category, status: lint?.status === "pass" ? "pass" : lint?.status === "error" ? "error" : lint?.status === "fail" ? "fail" : "skipped", findings: [], durationMs: 0, ...(lint && lint.status !== "pass" ? { message: category === "architecture" ? "Architecture rules ran through the existing lint command; see the lint result." : "Accessibility rules ran through the existing lint command; see the lint result." } : {}) };
    },
  };
}

export async function planHealthTasks(audit: AuditModel, config: RepnixConfig, options: TaskPlannerOptions): Promise<HealthTask[]> {
  const { context, detections } = audit;
  const tasks: HealthTask[] = [];
  const scheduled = new Set<string>();
  const add = (task: HealthTask) => {
    if (scheduled.has(task.provider)) return;
    scheduled.add(task.provider);
    tasks.push(task);
  };
  for (const command of await basicCommands(context, detections, options.timeoutMs)) {
    if (selected(command.category, options) && enabledCategory(audit, config, command.category, command.scope ?? ".")) add(commandTask(command, audit, options));
  }
  const addBuiltin = (provider: string, dependsOn?: string) => {
    const descriptor = (audit.registry?.get(provider) ?? PROVIDERS.find((entry) => entry.id === provider));
    const runner = BUILTIN_RUNNERS[provider];
    if (!descriptor || !runner || !selected(descriptor.category, options) || !enabledCategory(audit, config, descriptor.category)) return;
    add({ id: provider, provider, name: descriptor.name, category: descriptor.category, ...(dependsOn ? { dependsOn } : {}), run: () => runner(context, config, options.logger, options.timeoutMs) });
  };
  if (detections.get("knip")?.installed) addBuiltin("knip");
  if (detections.get("jscpd")?.installed) addBuiltin("jscpd");
  if (detections.get("osv-scanner")?.activeCapabilities.vulnerabilities) addBuiltin("osv-scanner");
  if (detections.get("dependency-cruiser")?.activeCapabilities.architectureRules) addBuiltin("dependency-cruiser");
  if (detections.get("size-limit")?.activeCapabilities.bundleBudget) addBuiltin("size-limit");
  if (detections.get("publint")?.activeCapabilities.packagePublishing) addBuiltin("publint");
  if (detections.get("attw")?.activeCapabilities.typesCompatibility) addBuiltin("attw");
  const rootTestTask = tasks.find((task) => task.category === "tests" && task.scope === undefined);
  if (detections.get("c8")?.activeCapabilities.testCoverage) addBuiltin("c8", rootTestTask?.id);

  const lintTask = tasks.find((task) => task.category === "lint");
  if (detections.get("eslint-boundaries")?.activeCapabilities.architectureRules && selected("architecture", options) && enabledCategory(audit, config, "architecture")) {
    if (options.category === "architecture" || !lintTask) addBuiltin("eslint-boundaries");
    else add(derivedLintTask("eslint-boundaries", "eslint-plugin-boundaries", "architecture", lintTask));
  }
  if (detections.get("jsx-a11y")?.activeCapabilities.accessibilityRules && selected("accessibility", options) && enabledCategory(audit, config, "accessibility")) add(derivedLintTask("jsx-a11y", "eslint-plugin-jsx-a11y", "accessibility", lintTask));

  for (const descriptor of audit.registry?.providers ?? PROVIDERS) {
    if (BUILTIN_RUNNERS[descriptor.id] || (!descriptor.command && !descriptor.run) || !Object.keys(detections.get(descriptor.id)?.activeCapabilities ?? {}).length || !selected(descriptor.category, options) || !enabledCategory(audit, config, descriptor.category) || scheduled.has(descriptor.id)) continue;
    add({ id: descriptor.id, provider: descriptor.id, name: descriptor.name, category: descriptor.category, run: () => descriptor.run ? runProviderModule(context, descriptor, options.logger, options.timeoutMs) : runGenericProvider(context, descriptor, options.logger, options.timeoutMs) });
  }
  if (detections.get("license-checker")?.activeCapabilities.licenses) addBuiltin("license-checker");
  return tasks;
}
