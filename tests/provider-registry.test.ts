import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBuiltinRegistry, createProviderRegistry, ProviderRegistry, builtinProvider } from "../src/providers/registry.js";
import { defineProvider } from "../src/providers/sdk.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { readConfig } from "../src/config/repo-health-config.js";
import { buildAuditModel } from "../src/recommendations/recommendation-engine.js";
import { detectAllProviders } from "../src/providers/catalog.js";
import { runHealth } from "../src/runners/health-runner.js";
import { resolveDiagnosticLogger } from "../src/cli/options.js";

describe("provider registry contract", () => {
  it("derives installability from setup metadata and keeps recommend on the module", () => {
    expect(builtinProvider("knip")?.support).toEqual(["detectable", "runnable", "installable"]);
    expect(builtinProvider("eslint")?.support).toEqual(["detectable"]);
    expect(builtinProvider("knip")?.recommend).toEqual(expect.any(Function));
    expect(builtinProvider("knip")?.documentationUrl).toBe("https://knip.dev/");
  });

  it("uses only built-in providers", () => {
    const registry = createProviderRegistry();

    expect(registry.get("repnix-provider-example")).toBeUndefined();
    expect(registry.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "knip" })]));
  });

  it("accepts a self-contained provider module and rejects duplicate IDs", () => {
    const provider = defineProvider({
      id: "synthetic-tool",
      name: "Synthetic Tool",
      category: "documentation",
      packages: [],
      configPatterns: [],
      scriptPattern: /synthetic-tool/,
      capabilities: { documentation: true },
    });
    const registry = new ProviderRegistry([...createBuiltinRegistry().providers, provider], createBuiltinRegistry().categories);
    expect(registry.get("synthetic-tool")?.name).toBe("Synthetic Tool");
    expect(() => new ProviderRegistry([provider, provider])).toThrow("Duplicate provider id 'synthetic-tool'");
    const category = { id: "synthetic-health", label: "Synthetic", description: "Synthetic", requiredCapabilities: ["documentation"], applicable: () => ({ applicable: true, scopes: ["."], evidence: [] }) };
    expect(() => new ProviderRegistry([provider], [category, category])).toThrow("Duplicate category id 'synthetic-health'");
  });

  it("runs a custom provider hook in a custom category", async () => {
    const context = await detectRepository(path.resolve("fixtures/minimal-js"));
    const builtin = createBuiltinRegistry();
    const provider = defineProvider({
      id: "synthetic-runner",
      name: "Synthetic runner",
      category: "synthetic-health",
      packages: [],
      configPatterns: [],
      scriptPattern: /synthetic-runner/,
      capabilities: { syntheticCheck: true },
      detect: async () => ({ installed: true, configured: true, configFiles: [], evidence: ["test"], availableCapabilities: { syntheticCheck: true }, activeCapabilities: { syntheticCheck: true } }),
      run: async ({ context: providerContext }) => ({ provider: "synthetic-runner", name: "Synthetic runner", category: "synthetic-health", status: "pass", findings: [], durationMs: providerContext.root.length }),
    });
    const registry = new ProviderRegistry([...builtin.providers, provider], [...builtin.categories, { id: "synthetic-health", label: "Synthetic health", description: "Test-only category", requiredCapabilities: ["syntheticCheck"], applicable: () => ({ applicable: true, scopes: ["."], evidence: ["test"] }) }]);
    const { config } = await readConfig(context.root);
    const audit = buildAuditModel(context, await detectAllProviders(context, registry.providers), config, registry);
    const result = await runHealth(audit, config, { category: "synthetic-health", logger: resolveDiagnosticLogger({ quiet: true }) });
    expect(result.results).toContainEqual(expect.objectContaining({ provider: "synthetic-runner", category: "synthetic-health", status: "pass" }));
  });

});
