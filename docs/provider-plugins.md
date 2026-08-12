# Provider plugins

RepNix providers are versioned modules. Built-in providers and external packages use the same contract, so a new tool can supply only the behavior it needs.

## Minimal provider

Use the SDK types from `src/providers/sdk.ts` for built-in development or import them from `repnix/provider-sdk` in an external plugin:

```ts
export default {
  apiVersion: 1,
  providers: [{
    id: "example-tool",
    name: "Example Tool",
    category: "documentation",
    packages: ["example-tool"],
    configPatterns: [/^example-tool\.config\./],
    scriptPattern: /(^|\s)example-tool(?:\s|$)/,
    capabilities: { documentation: true },
    command: { binary: "example-tool", args: ["check", "."] },
    setup: {
      packageName: "example-tool",
      scriptName: "health:documentation",
      scriptCommand: () => "example-tool check .",
      checks: ["Documentation structure and links."],
    },
  }],
};
```

The provider must expose all descriptor fields, use a stable lowercase ID, and report only capabilities that are active after detection. Generic command execution, safe script handling, exit-status findings, setup scripts, and report attribution are supplied automatically.

## Hooks

Use hooks only when the generic behavior is insufficient:

- `detect(context)` for non-standard configuration or activation rules;
- `recommend(context)` for repository-specific setup recommendations;
- `planInstall(context)` for a custom safe setup plan;
- `run({ context, runtime })` for multi-command or policy-driven checks;
- `normalize({ output, result, context })` for machine-readable or provider-specific output;
- `setup.details` for provider-specific review text.

Custom runners must use the supplied runtime, respect the timeout, avoid network access unless the tool explicitly requires a prepared local database, and return normalized `HealthResult` data.

## External packages

External providers are loaded only from direct `dependencies`, `devDependencies`, or `optionalDependencies` whose package name starts with `repnix-provider-`. The package must expose a `./repnix-provider` export whose default export is:

```ts
{ apiVersion: 1, providers: [...], categories?: [...] }
```

Provider IDs and category IDs must be unique. Invalid exports, duplicate IDs, unsupported API versions, or missing exports stop audit with an actionable error instead of silently omitting a provider.

## Categories

Plugins may register categories with a label, description, required capability IDs, ordering, and an applicability function. Category modes remain the configuration boundary: use `required`, `optional`, or `off`. Per-provider enablement is intentionally not supported.

## Tests

Every provider should have contract tests for detection, recommendation, setup, execution, and normalization as applicable. Add an external-package fixture when changing plugin loading, and verify `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, and `pnpm build` before submitting.
