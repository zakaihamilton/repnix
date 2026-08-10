# RepNix

RepNix is a local-first CLI that discovers the repository health checks a JavaScript or TypeScript project already has, identifies important gaps, installs a minimal specialist tool stack, and provides one normalized command for running it.

RepNix orchestrates existing tools. It does not replace TypeScript, ESLint, Oxlint, Biome, Prettier, Jest, Vitest, Knip, or jscpd.

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

Offers Knip and jscpd when applicable. Setup preserves existing scripts and configuration, creates only a minimal `.jscpd.json` when necessary, and can conservatively add a GitHub Actions health step.

### `repnix check [category]`

Runs safe existing type, lint, formatting, and test commands plus installed Knip and jscpd providers. Child output is captured unless `--verbose` is used.

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
    }
  }
}
```

Category modes are `required`, `optional`, and `off`. Severity thresholds are `info`, `warning`, and `error`. Configuration is strict so misspelled categories or provider names fail visibly.

## MVP limits

- Monorepos use their existing root orchestration scripts; RepNix does not independently traverse every workspace.
- Specialist lint, type, formatting, and test output is represented as a provider-attributed command finding. Knip and jscpd receive detailed normalization.
- Security, architecture, bundle, accessibility, monorepo-consistency, and package-publishing providers are reserved for later adapters.

## Development

```bash
pnpm install
pnpm verify
```

The package uses Node.js ESM, strict TypeScript, and Vitest.

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
