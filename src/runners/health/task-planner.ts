import { categoryModeFor, type RepnixConfig } from "../../config/repo-health-config.js";
import type { HealthCategory } from "../../core/health-category.js";
import type { HealthResult } from "../../core/types.js";
import type { AuditModel } from "../../recommendations/recommendation-engine.js";
import type { DiagnosticLogger } from "../../cli/options.js";
import type { ProviderModule } from "../../providers/sdk.js";
import { PROVIDERS } from "../../providers/catalog.js";
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
  return {
    id: command.provider,
    provider: command.provider,
    name: command.name,
    category: command.category,
    ...(command.scope ? { scope: command.scope } : {}),
    run: () => runRunnableCommand(command, audit.context, options.logger),
  };
}

function derivedLintTask(
  provider: string,
  name: string,
  category: HealthCategory,
  lintTask: HealthTask | undefined,
): HealthTask {
  return {
    id: provider,
    provider,
    name,
    category,
    ...(lintTask ? { dependsOn: lintTask.id } : {}),
    async run(completed) {
      const lint = lintTask ? completed.get(lintTask.id) : undefined;
      return {
        provider,
        name,
        category,
        status:
          lint?.status === "pass"
            ? "pass"
            : lint?.status === "error"
              ? "error"
              : lint?.status === "fail"
                ? "fail"
                : "skipped",
        findings: [],
        durationMs: 0,
        ...(lint && lint.status !== "pass"
          ? {
              message:
                category === "architecture"
                  ? "Architecture rules ran through the existing lint command; see the lint result."
                  : "Accessibility rules ran through the existing lint command; see the lint result.",
            }
          : {}),
      };
    },
  };
}

function hasActiveCapabilities(audit: AuditModel, providerId: string): boolean {
  return Object.keys(audit.detections.get(providerId)?.activeCapabilities ?? {}).length > 0;
}

function scheduleProvider(
  descriptor: ProviderModule,
  audit: AuditModel,
  config: RepnixConfig,
  options: TaskPlannerOptions,
  tasks: HealthTask[],
  add: (task: HealthTask) => void,
): void {
  if (
    !selected(descriptor.category, options) ||
    !enabledCategory(audit, config, descriptor.category) ||
    !hasActiveCapabilities(audit, descriptor.id)
  )
    return;
  const derivedCategory = descriptor.deriveFromCategory;
  const parent = derivedCategory ? tasks.find((task) => task.category === derivedCategory) : undefined;
  if (derivedCategory && parent) {
    add(derivedLintTask(descriptor.id, descriptor.name, descriptor.category, parent));
    return;
  }
  const dependsOn = descriptor.dependsOnCategory
    ? tasks.find((task) => task.category === descriptor.dependsOnCategory && task.scope === undefined)?.id
    : undefined;
  if (descriptor.run) {
    add({
      id: descriptor.id,
      provider: descriptor.id,
      name: descriptor.name,
      category: descriptor.category,
      ...(dependsOn ? { dependsOn } : {}),
      run: () => runProviderModule(audit.context, descriptor, options.logger, options.timeoutMs, config),
    });
    return;
  }
  if (descriptor.command) {
    add({
      id: descriptor.id,
      provider: descriptor.id,
      name: descriptor.name,
      category: descriptor.category,
      ...(dependsOn ? { dependsOn } : {}),
      run: () => runGenericProvider(audit.context, descriptor, options.logger, options.timeoutMs),
    });
    return;
  }
  if (derivedCategory) add(derivedLintTask(descriptor.id, descriptor.name, descriptor.category, parent));
}

export async function planHealthTasks(
  audit: AuditModel,
  config: RepnixConfig,
  options: TaskPlannerOptions,
): Promise<HealthTask[]> {
  const { context, detections } = audit;
  const tasks: HealthTask[] = [];
  const scheduled = new Set<string>();
  const add = (task: HealthTask) => {
    if (scheduled.has(task.provider)) return;
    scheduled.add(task.provider);
    tasks.push(task);
  };
  for (const command of await basicCommands(
    context,
    detections,
    options.timeoutMs,
    audit.registry?.providers ?? PROVIDERS,
  )) {
    if (selected(command.category, options) && enabledCategory(audit, config, command.category, command.scope ?? "."))
      add(commandTask(command, audit, options));
  }
  for (const descriptor of audit.registry?.providers ?? PROVIDERS) {
    scheduleProvider(descriptor, audit, config, options, tasks, add);
  }
  return tasks;
}
