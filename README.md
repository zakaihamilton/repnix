# RepNix

[![npm version](https://img.shields.io/npm/v/repnix.svg)](https://www.npmjs.com/package/repnix)
[![CI](https://github.com/zakaihamilton/repnix/actions/workflows/ci.yml/badge.svg)](https://github.com/zakaihamilton/repnix/actions/workflows/ci.yml)
[![End-to-end](https://github.com/zakaihamilton/repnix/actions/workflows/e2e.yml/badge.svg)](https://github.com/zakaihamilton/repnix/actions/workflows/e2e.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

RepNix is a local-first CLI that discovers the repository health checks a JavaScript or TypeScript project already has, identifies important gaps, installs a minimal specialist tool stack, and provides one normalized command for running it.

RepNix orchestrates existing tools. It does not replace TypeScript, ESLint, Oxlint, Biome, Prettier, Oxfmt, Jest, Vitest, Knip, jscpd, OSV-Scanner, dependency-cruiser, eslint-plugin-boundaries, or Size Limit.

## Requirements

- Node.js 20 or newer
- npm, pnpm, Yarn, or Bun

## Install

Install RepNix in a repository:

```bash
npm install --save-dev repnix
```

Or run a read-only audit without adding it first:

```bash
npx repnix audit
```

## Usage

```bash
npx repnix audit
npx repnix setup
```

After setup:

```bash
npm run health
repnix check
repnix check dead-code
repnix check --json
repnix explain
```

`audit`, `check`, and `explain` never install packages or access a package registry. `setup` is interactive, previews every command and file change, and applies changes only after confirmation.

## Commands

### `repnix audit`

Detects repository type, package manager, CI, existing providers, category coverage, and baseline recommendations without modifying the repository.

### `repnix setup`

Offers Knip and jscpd as baseline coverage when applicable. It can also offer dependency-cruiser as an optional architecture provider when lint-based boundary rules are absent. Setup preserves existing scripts and configuration, creates only minimal provider configuration when necessary, and can conservatively add a GitHub Actions health step.

### `repnix check [category]`

Runs safe existing type, lint, formatting, and test commands plus active specialist providers. Phase 2 execution includes offline OSV-Scanner checks, dependency-cruiser architecture rules, eslint-plugin-boundaries through the existing lint command, and configured Size Limit budgets. Child output is captured unless `--verbose` is used.

Exit codes:

- `0`: healthy at the configured severity threshold
- `1`: health findings at or above the threshold
- `2`: configuration or tool execution failure

`--json` emits the versioned normalized report to stdout. Verbose provider output is written to stderr so stdout remains machine-readable.

### `repnix explain`

Reruns the health pipeline and displays detailed normalized findings grouped by category with their source providers.

## Configuration

Configuration is optional. Create `repnix.config.json` at the repository root:

```json
{
  "categories": {
    "dead-code": "required",
    "duplication": "optional",
    "architecture": "off"
  },
  "severityThreshold": "warning",
  "providers": {
    "jscpd": {
      "enabled": true
    },
    "osv-scanner": {
      "enabled": true
    },
    "dependency-cruiser": {
      "enabled": true
    },
    "size-limit": {
      "enabled": false
    }
  }
}
```

Category modes are `required`, `optional`, and `off`. Severity thresholds are `info`, `warning`, and `error`. Configuration is strict so misspelled categories or provider names fail visibly.

## Phase 2 providers

- **OSV-Scanner:** detected from the local executable and repository lockfiles. RepNix always invokes it with its offline vulnerability database mode, so `check` cannot fetch data. Install OSV-Scanner and prepare its local cache separately before requiring security coverage.
- **dependency-cruiser:** detected only when a configuration contains active `forbidden` rules. Interactive setup can add the package, a conservative starter configuration, and a health script without replacing an existing configuration.
- **eslint-plugin-boundaries:** credited only when an ESLint configuration contains active `boundaries/*` rules. RepNix uses the repository's existing lint command and does not generate repository-specific boundary rules.
- **Size Limit:** credited only when a configuration contains an explicit `limit`. RepNix runs a known non-mutating Size Limit command but never invents a bundle budget.

An installed package is not considered coverage by itself. Audit distinguishes an available provider from an actively configured capability.

## MVP limits

- Monorepos use their existing root orchestration scripts; RepNix does not independently traverse every workspace.
- Specialist lint, type, formatting, test, eslint-plugin-boundaries, and Size Limit output is represented as a provider-attributed command finding. Knip, jscpd, OSV-Scanner, and dependency-cruiser receive detailed normalization.
- Accessibility, monorepo-consistency, and package-publishing providers remain future adapters.

## Development

```bash
pnpm install
pnpm verify
```

The package uses Node.js ESM, strict TypeScript, and Vitest.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the provider-adapter workflow, validation requirements, and pull-request guidelines. Release history is recorded in [CHANGELOG.md](CHANGELOG.md).

The end-to-end workflow also installs the packed CLI into disposable consumer repositories. It exercises interactive setup, real Knip and jscpd execution, JSON reporting, explain output, and setup idempotence across npm, pnpm, Yarn, and Bun. A separate matrix smoke-tests the published package shape and executable on Linux, macOS, and Windows.

Run the packaged smoke test locally after building:

```bash
pnpm build
pnpm test:package
```

On macOS or Linux, the npm consumer acceptance test can also be run locally. It drives the TTY-only setup flow through a disposable pseudo-terminal and accesses the package registry only inside the disposable setup project.

```bash
pnpm test:e2e
```

The real Phase 2 acceptance test packages RepNix, installs current dependency-cruiser and Size Limit releases into a disposable npm library, and verifies normalized architecture and bundle findings:

```bash
pnpm test:phase2
```

## Releases

Tags matching `v<package-version>` trigger `.github/workflows/release.yml`. The workflow verifies the project and tag before publishing with npm trusted publishing. Configure the npm package's GitHub Actions trusted publisher for owner `zakaihamilton`, repository `repnix`, and workflow `release.yml` before creating a release tag.
