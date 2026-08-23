# Configuration and automation

Configuration is optional. Add `repnix.config.json` when your team wants to make a category required, change which findings fail CI, or intentionally disable a category:

```json
{
  "schemaVersion": 1,
  "scopes": {
    ".": {
      "roles": ["cli", "library"]
    },
    "apps/web": {
      "roles": ["web-app"],
      "categories": {
        "performance": { "mode": "required" }
      }
    }
  },
  "categories": {
    "dead-code": { "mode": "required" },
    "duplication": { "mode": "optional" },
    "architecture": { "mode": "off" }
  },
  "severityThreshold": "warning",
  "execution": {
    "jobs": 2,
    "timeoutSeconds": 300
  },
  "baseline": {
    "path": ".repnix-baseline.json",
    "failOn": "new"
  },
  "policies": {
    "licenses": {
      "allow": ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"],
      "deny": ["GPL-3.0-only"]
    },
    "coverage": {
      "lines": 80,
      "functions": 80,
      "branches": 75,
      "statements": 80
    },
    "performance": {
      "maxLcpMs": 2500,
      "maxCls": 0.1,
      "maxTbtMs": 300
    }
  }
}
```

Category modes are:

- `required` — the category must have an active provider; otherwise the check fails with exit code `2`.
- `optional` — run the category when a provider is active, but do not require setup.
- `off` — skip the category intentionally.

Severity thresholds are `info`, `warning`, and `error`. A finding at or above the threshold produces exit code `1`. Configuration is strict, so misspelled category names fail with a correction tip.

Policies are optional and provider-aware. License `allow` and `deny` lists are enforced by license-checker; coverage thresholds are used when RepNix runs c8 around the configured test command. Performance values document the budgets expected by a configured Lighthouse CI provider; RepNix does not invent a URL or build command.

Use `required` for coverage that must exist and `off` for categories that do not apply to your repository. Providers are selected exclusively from Repnix's built-in registry.

Scope roles normally come from repository evidence such as `package.json#bin`, publishable exports, framework configuration, source layout, and scripts. Add a scope override only when the repository intentionally differs from those signals.

## Baseline existing findings

For a repository with existing debt, review the current detailed report and then run:

```bash
npx repnix check --write-baseline
```

This writes `.repnix-baseline.json` and enables it in `repnix.config.json`. Findings are then classified as `new`, `existing`, or `resolved`, and only new findings fail by default. Provider errors and missing required coverage can never be hidden by a baseline. Ordinary checks never rewrite the file.

## Exit codes and machine-readable output

RepNix uses predictable exit codes so both people and CI can understand the result:

- `0` — all configured checks passed at the configured severity threshold.
- `1` — one or more new findings reached the configured threshold; run `repnix check --details` to understand them.
- `2` — RepNix could not complete a check because of configuration, repository detection, or tool execution; this is different from a code finding.

`repnix check --format json` writes the normalized report to stdout, while `--format sarif` produces SARIF 2.1.0. With debug diagnostics (`--verbose` or `--log-level debug`), child provider output goes to stderr so stdout remains machine-readable.

All commands accept the diagnostic options. `--verbose` is shorthand for `--log-level debug`; `--quiet` takes precedence over the other level switches. Use `--log-format json` when a log collector needs stable event names and context fields. If an unexpected error occurs, verbose mode includes its stack trace.

## GitHub Actions

After installing dependencies, add the unified check to an existing GitHub Actions job:

```yaml
- name: Check repository health
  run: npm run health
```

When `repnix setup` is asked to update CI, it looks for a workflow job with a checkout step and a supported package-manager install step, then inserts the health step immediately after that install using the job's package manager. It prefers a uniquely identified test, check, or CI job when several jobs qualify; ties are left unchanged and the candidate job locations are shown for manual review.

For machine-readable CI integrations, use `npx repnix check --format json` or upload `--format sarif` output to a compatible code-scanning service.
