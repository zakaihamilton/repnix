# Contributing to RepNix

RepNix is a local-first orchestrator. Contributions should preserve existing repository choices, avoid overlapping analyzers, and keep audit and check free of network activity.

## Development setup

Requirements:

- Node.js 20 or newer
- pnpm 10.15.0

```bash
pnpm install
pnpm verify
```

Run packaged acceptance tests before submitting changes that affect setup, execution, or publishing:

```bash
pnpm test:package
pnpm test:e2e
pnpm test:phase2
pnpm test:phase3
pnpm test:compatibility
```

These tests use disposable repositories. Registry access is limited to package installation within those fixtures. The compatibility suite is read-only: it verifies `audit` and `setup --plan` against the checked-in pilot corpus without installing a provider or changing a fixture.

## Compatibility pilots

The compatibility corpus in [`fixtures/`](fixtures) represents the repository shapes RepNix supports today: JavaScript CLI/Node applications, TypeScript Node applications, npm libraries, React applications, Next.js web applications, and pnpm workspaces. Each checked-in pilot has explicit assertions for repository detection, recommendations, and the non-interactive setup plan. The scheduled public-OSS pilots in [`fixtures/oss-pilots.json`](fixtures/oss-pilots.json) validate the same commands against pinned third-party repositories.

When correcting a compatibility issue, update the smallest representative pilot or add a new focused fixture. Record why the shape matters and make the expected audit and setup-plan result explicit in [`scripts/compatibility-pilot.mjs`](scripts/compatibility-pilot.mjs). For a public pilot, pin a full commit ID and preserve the audit output needed to review a changed result. Do not loosen an assertion merely to accept an unsafe or irrelevant recommendation; either fix it or add clear unsupported-case guidance.

## Provider changes

A provider module should keep its detection, support level, setup metadata, execution, normalization, remediation, and documentation together under the provider extension contract. See [docs/provider-plugins.md](docs/provider-plugins.md) for the complete template. It should:

1. Declare its category and available capabilities.
2. Credit only capabilities that are actively configured.
3. Explain applicability and overlap decisions.
4. Return an installation plan before any mutation.
5. Use machine-readable output where the provider supports it.
6. Normalize findings conservatively and retain provider attribution.
7. Treat malformed output or unavailable required coverage as exit code `2`.
8. Avoid network access during `audit` and `check`.

Add unit tests for detection, recommendations, normalization, and exit behavior. Add a disposable packaged acceptance test when command-line compatibility is important. Provider enablement belongs in category policy; do not add new `providers.<id>.enabled` configuration.

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Do not rewrite existing repository configuration blindly.
- Include the commands used for validation.
- Update the changelog for user-visible changes.
- Let the protected CI and consumer matrix finish before merging.

## Releases

For a user-visible change, add a Changeset, update the package and CLI version
when preparing the release, and add the matching release heading to
`CHANGELOG.md`. Keep `package.json` and `src/core/version.ts` synchronized.
Run `pnpm verify`, `pnpm health`, and the relevant packaged acceptance tests
before merging. Pushes to `main` publish the synchronized package version
automatically after the release checks pass.
