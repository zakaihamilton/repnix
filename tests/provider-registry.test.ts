import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProviderRegistry, createBuiltinRegistry, ProviderRegistry } from "../src/providers/registry.js";
import { defineProvider } from "../src/providers/sdk.js";
import { detectRepository } from "../src/repository/detect-repository.js";
import { readConfig } from "../src/config/repo-health-config.js";
import { buildAuditModel } from "../src/recommendations/recommendation-engine.js";
import { detectAllProviders } from "../src/providers/catalog.js";
import { runHealth } from "../src/runners/health-runner.js";
import { resolveDiagnosticLogger } from "../src/cli/options.js";

describe("provider registry contract", () => {
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

  it("discovers direct repnix-provider dependencies and custom categories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-provider-plugin-"));
    try {
      await mkdir(path.join(root, "node_modules", "repnix-provider-demo"), { recursive: true });
      await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "plugin-host", devDependencies: { "repnix-provider-demo": "1.0.0" } }));
      await writeFile(path.join(root, "node_modules", "repnix-provider-demo", "package.json"), JSON.stringify({ name: "repnix-provider-demo", type: "module", exports: { "./repnix-provider": "./repnix-provider.js" } }));
      await writeFile(path.join(root, "node_modules", "repnix-provider-demo", "repnix-provider.js"), `export default { apiVersion: 1, providers: [{ id: "demo-tool", name: "Demo Tool", category: "demo-health", packages: [], configPatterns: [], scriptPattern: /demo-tool/, capabilities: { documentation: true } }], categories: [{ id: "demo-health", label: "Demo health", description: "A plugin category", requiredCapabilities: ["documentation"], applicable: () => ({ applicable: true, scopes: ["."], evidence: ["plugin test"] }) }] }`);
      const context = await detectRepository(root);
      const registry = await createProviderRegistry(context);
      expect(registry.get("demo-tool")?.category).toBe("demo-health");
      expect(registry.categoryRegistry.get("demo-health")?.label).toBe("Demo health");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an unsupported plugin API version", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "repnix-provider-invalid-"));
    try {
      await mkdir(path.join(root, "node_modules", "repnix-provider-invalid"), { recursive: true });
      await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "plugin-host", dependencies: { "repnix-provider-invalid": "1.0.0" } }));
      await writeFile(path.join(root, "node_modules", "repnix-provider-invalid", "package.json"), JSON.stringify({ name: "repnix-provider-invalid", type: "module", exports: { "./repnix-provider": "./repnix-provider.js" } }));
      await writeFile(path.join(root, "node_modules", "repnix-provider-invalid", "repnix-provider.js"), "export default { apiVersion: 99, providers: [] };");
      await expect(createProviderRegistry(await detectRepository(root))).rejects.toThrow("supported version is 1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
