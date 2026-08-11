# RepNix

[![npm version](https://img.shields.io/npm/v/repnix.svg)](https://www.npmjs.com/package/repnix)
[![CI](https://github.com/zakaihamilton/repnix/actions/workflows/ci.yml/badge.svg)](https://github.com/zakaihamilton/repnix/actions/workflows/ci.yml)
[![End-to-end](https://github.com/zakaihamilton/repnix/actions/workflows/e2e.yml/badge.svg)](https://github.com/zakaihamilton/repnix/actions/workflows/e2e.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Discover the health checks your JavaScript or TypeScript repository needs.**

RepNix is a local-first CLI that audits the guardrails you already have, identifies important gaps, and helps you add a focused set of complementary tools. It then gives your team one normalized command for running repository health checks locally and in CI.

RepNix orchestrates the tools you choose. It does not replace your existing TypeScript, ESLint, Biome, Prettier, Vitest, Jest, Knip, OSV-Scanner, dependency-cruiser, or package-quality workflows.

![RepNix auditing repository health and recommending missing checks](docs/repnix-audit.svg)

## Get started

Requirements: **Node.js 20+** and one of **npm, pnpm, Yarn, or Bun**.

Install RepNix as a development dependency:

```bash
npm install --save-dev repnix
```

Then inspect your repository and choose the missing guardrails you want to add:

```bash
npx repnix audit
npx repnix setup
```

Setup is interactive. It previews every package, script, configuration file, and CI change before applying anything.

Once setup is complete, run the unified health check:

```bash
npm run health
```

Or use RepNix directly:

```bash
npx repnix check
npx repnix explain
```

## Why RepNix?

Most repositories accumulate quality tools one at a time. That makes it easy to miss important coverage, add overlapping analyzers, or leave CI with a collection of unrelated commands.

RepNix gives you a clear inventory and a deliberate next step:

- **Works with your repository.** Detects the package manager, framework, language, monorepo layout, CI, scripts, configuration, and installed providers already in use.
- **Measures active coverage.** An installed package is not treated as a health check unless it is configured and actually contributes a capability.
- **Adds only useful gaps.** Recommendations are based on the repository’s shape and existing tools, with baseline, optional, and advanced priorities.
- **Preserves your choices.** Setup keeps existing scripts and configuration, creates only the files it needs, and shows conflicts instead of overwriting them blindly.
- **Stays local-first.** `audit`, `check`, and `explain` do not install packages or access a package registry. Security and package-health checks use local/offline execution paths.
- **Produces one report.** Human-readable output groups findings by category and provider; `--json` emits a versioned normalized report for automation.

## The workflow

```text
audit → choose recommendations → setup → check → explain
```

![RepNix workflow from repository detection to explained findings](docs/repnix-workflow.svg)

1. **Audit** the repository without modifying it.
2. **Choose** the providers that fit your project.
3. **Set up** packages, scripts, configuration, and optional CI integration through a previewed plan.
4. **Check** all active health providers with one command.
5. **Explain** findings with normalized messages, locations, severity, and source provider.

## See it in action

```text
$ npx repnix audit

Repository

typescript
react
pnpm (lockfile)
GitHub Actions

Repository Guardrails
────────────────────────────────────────────────
Type safety                 ✓ TypeScript
Linting                     ✓ ESLint
Formatting                  ✓ Prettier
Tests                       ✓ Vitest
Dead code                   ✗ Missing
Duplication                 ✗ Missing
Dependency security         ✗ Missing

Recommended baseline
────────────────────────────────────────────────
+ Knip
  Unused files, exports, and dependencies are not fully covered.

+ jscpd
  No duplication provider is active.
```

After setup, the unified check stays intentionally small:

```text
$ npx repnix check

Repository Health

Type safety            ✓  TypeScript
Linting                ✓  ESLint
Formatting             ✓  Prettier
Tests                  ✓  Vitest
Dead code              ⚠  2  Knip
Duplication            ✓  jscpd

2 findings
Run: repnix explain
```

## Commands

| Command | Purpose | Changes files? |
| --- | --- | :---: |
| `repnix audit` | Inspect repository health coverage and recommendations. | No |
| `repnix setup` | Interactively preview and apply recommended provider setup. | Yes, after confirmation |
| `repnix check` | Run all active health checks. | No |
| `repnix check <category>` | Run one health category, such as `dead-code` or `security`. | No |
| `repnix check --json` | Emit a versioned normalized report to stdout. | No |
| `repnix <command> --verbose` | Show debug diagnostics and stream provider output to stderr. | No |
| `repnix <command> --quiet` | Suppress diagnostic output while keeping the command report. | No |
| `repnix <command> --log-level <level>` | Set diagnostics to `silent`, `error`, `warn`, `info`, or `debug`. | No |
| `repnix <command> --log-format json` | Emit newline-delimited structured diagnostics on stderr. | No |
| `repnix <command> --timeout <seconds>` | Set the maximum runtime for each repository command; the default is five minutes. | No |
| `repnix explain` | Rerun checks and show detailed normalized findings. | No |

Examples:

```bash
# Read-only inventory of existing coverage
npx repnix audit

# Interactive setup for recommended providers
npx repnix setup

# Run everything currently configured
npx repnix check

# Run one category
npx repnix check dead-code
npx repnix check package-health

# Send machine-readable output to another tool
npx repnix check --json > repnix-report.json

# Inspect locations and provider-specific explanations
npx repnix explain
```

## What RepNix can cover

RepNix separates repository health into categories so each capability has a clear home.

| Health category | Existing project tools | Specialist providers |
| --- | --- | --- |
| Type safety | TypeScript | — |
| Linting | ESLint, Oxlint, Biome | — |
| Formatting | Prettier, Oxfmt, Biome | — |
| Tests | Jest, Vitest, safe test scripts | — |
| Dead code | — | Knip |
| Duplication | — | jscpd |
| Dependency security | — | OSV-Scanner |
| Architecture | ESLint | dependency-cruiser, `eslint-plugin-boundaries` |
| Bundle size | — | Size Limit |
| Package publishing | — | Publint, Are The Types Wrong? |

### Existing project checks

RepNix detects and runs the safe commands your repository already uses for:

- Type safety — TypeScript.
- Linting — ESLint, Oxlint, or Biome.
- Formatting — Prettier, Oxfmt, or Biome.
- Tests — Jest, Vitest, or a safe existing test script.

### Specialist checks

When the repository needs additional coverage, RepNix can recommend and orchestrate:

- **Dead code:** Knip for unused files, exports, and dependencies.
- **Duplication:** jscpd for copy/paste drift.
- **Dependency security:** OSV-Scanner using its offline vulnerability database.
- **Architecture:** dependency-cruiser or active `eslint-plugin-boundaries` rules.
- **Bundle size:** Size Limit when an explicit budget already exists.

### Package publishing

Publishable npm packages can also use:

- **Publint** for exports, entry points, module formats, package metadata, and published files.
- **Are The Types Wrong?** for TypeScript consumer compatibility across Node and bundler resolution modes.

Package-health checks analyze a local packed artifact with lifecycle scripts disabled. They do not implicitly run a repository `prepack` script or fetch registry data.

## Configuration

Configuration is optional. Add `repnix.config.json` to make important categories required, adjust the failure threshold, or disable a provider intentionally:

```json
{
  "categories": {
    "dead-code": "required",
    "duplication": "optional",
    "architecture": "off"
  },
  "severityThreshold": "warning",
  "providers": {
    "jscpd": { "enabled": true },
    "osv-scanner": { "enabled": true },
    "dependency-cruiser": { "enabled": true },
    "publint": { "enabled": true },
    "attw": { "enabled": true }
  }
}
```

Category modes are `required`, `optional`, and `off`. Severity thresholds are `info`, `warning`, and `error`. Configuration is strict, so misspelled categories and provider names fail visibly.

Use `required` for coverage that must exist, `off` for categories that do not apply to your repository, and provider flags when you want to keep a detected tool out of the RepNix run.

## Exit codes and automation

RepNix uses predictable exit codes:

- `0` — healthy at the configured severity threshold.
- `1` — findings at or above the configured threshold.
- `2` — configuration, detection, or tool execution failure.

`repnix check --json` writes the versioned report to stdout. With debug diagnostics (`--verbose` or `--log-level debug`), child provider output goes to stderr so stdout remains machine-readable.
All commands accept the diagnostic options. `--verbose` is shorthand for `--log-level debug`; `--quiet` takes precedence over the other level switches. Use `--log-format json` when a log collector needs stable event names and context fields. If an unexpected error occurs, verbose mode includes its stack trace.

### GitHub Actions

After installing dependencies, add the unified check to an existing GitHub Actions job:

```yaml
- name: Check repository health
  run: npm run health
```

For machine-readable CI integrations, use `npx repnix check --json` and redirect or collect stdout as an artifact.

## How it works

RepNix follows a detect → recommend → plan → run model:

1. Detect repository type, package manager, source roots, scripts, CI, configuration, and active provider capabilities.
2. Compare those capabilities with the health categories that apply to the repository.
3. Build a minimal installation plan that preserves existing project choices.
4. Run active providers and normalize their findings into a shared report with category, severity, source, and location.

The audit and reporting pipeline is designed to be safe to run locally and in CI. `setup` is the only command that can make changes, and it requires an explicit confirmation after showing the planned commands and file changes.

## Notes and current limits

- Monorepos use their existing root orchestration scripts; RepNix does not independently traverse every workspace.
- Existing repository scripts are only run when they look like non-mutating quality checks. Scripts containing fix, write, watch, install, publish, deployment, or other mutating commands are skipped and the configured provider fallback is used where available.
- Setup applies planned files atomically and restores planned files plus package-manager lockfiles if dependency installation fails. Package-manager lifecycle scripts can still run during a normal dependency installation.
- Specialist lint, type, formatting, test, `eslint-plugin-boundaries`, and Size Limit output is represented as a provider-attributed command finding. Knip, jscpd, OSV-Scanner, dependency-cruiser, Publint, and Are The Types Wrong? receive detailed normalization.
- Accessibility and monorepo-consistency providers are not yet available in the MVP.
- OSV-Scanner must be installed separately with its local vulnerability database prepared before security coverage can be required.
- Architecture rules and bundle budgets are repository-specific. RepNix does not invent boundary policies or size budgets.

## Development

```bash
pnpm install
pnpm verify
```

The package uses Node.js ESM, strict TypeScript, and Vitest. See [CONTRIBUTING.md](CONTRIBUTING.md) for the provider-adapter workflow and pull-request guidelines.

Run the packaged smoke test locally after building:

```bash
pnpm build
pnpm test:package
```

The disposable consumer and provider acceptance tests are available through:

```bash
pnpm test:e2e
pnpm test:phase2
pnpm test:phase3
```

## Learn more

- [npm package](https://www.npmjs.com/package/repnix)
- [GitHub repository](https://github.com/zakaihamilton/repnix)
- [Report an issue](https://github.com/zakaihamilton/repnix/issues)
- [Contributing guide](CONTRIBUTING.md)
- [Release history](CHANGELOG.md)
- [MIT license](LICENSE)

## Releases

Every push to `main` triggers the publish workflow. It runs the full project verification, checks whether the package version is already on npm, and publishes only new versions through npm trusted publishing. The workflow can also be started manually from GitHub Actions.
