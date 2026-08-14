# Changelog

All notable changes to RepNix are documented here. The project follows semantic versioning.

## Unreleased

_No unreleased changes._

## 0.3.11 - 2026-08-13

### Fixed

- Keep the setup confirmation actions usable in compact terminal layouts.

## 0.3.10 - 2026-08-13

### Fixed

- Support npm pack report formats used by different npm releases during package-health checks.

## 0.3.9 - 2026-08-13

### Changed

- Use the local RepNix checkout when setup is run from an unreleased build.
- Guard Changesets CI branch preparation on non-main refs.

## 0.3.8 - 2026-08-13

### Added

- Document the AI-ready health report handoff for repository fixes.

## 0.3.7 - 2026-08-12

### Changed

- Move built-in setup recommendations onto the provider `recommend` hook so plugins and built-ins share the same audit path.

### Fixed

- Parse markdownlint-cli2 violations into per-file findings instead of a generic command failure, and ignore generated Markdown such as Playwright reports.

## 0.3.6 - 2026-08-12

### Fixed

- Show the underlying repository detection error and remediation instructions in the setup TUI.

## 0.3.5 - 2026-08-12

### Changed

- Bump the package and CLI version to `0.3.5`.

## 0.3.4 - 2026-08-12

### Added

- Add reproducible checked-in and public-OSS compatibility-pilot corpora for CLI, Node, library, React, Next.js, and pnpm-workspace repository shapes. Audit and read-only setup plans are asserted for both the built and packed CLI; a scheduled workflow validates pinned third-party repositories.
- Add evidence-backed CLI, library, web application, Node application, and tooling roles per repository scope.
- Add stable finding fingerprints, committed debt baselines, new/existing/resolved finding counts, and fail-on-new CI policy.
- Add JSON audit output, serializable setup plans, bounded concurrent execution, detailed remediation, and SARIF reporting.
- Add a typed built-in provider registry that supplies setup metadata, support levels, descriptions, and documentation.
- Add the versioned provider SDK, registry-backed categories, generic provider hooks, and external `repnix-provider-*` discovery.

### Changed

- Reduce the product workflow to `audit`, `setup`, and `check`; detailed findings now use `repnix check --details` without a separate rerun command.
- Rebuild and compare saved setup plans before applying them, including their selected providers and CI option; saved plans can no longer supply arbitrary commands or file paths.
- Update the existing repository, audit, health, finding, result, plan, and configuration models in place without parallel version-suffixed types.
- Limit default audit output to the three highest-priority actionable recommendations and hide categories that do not apply.
- Make setup create an explicit repository-health configuration and re-audit coverage after applying changes.
- Remove per-provider enablement configuration; category modes now control provider coverage policy.

### Removed

- Remove the standalone `repnix explain` command and the legacy `repnix check --json` shortcut in favor of `--format`.

## 0.3.3 - 2026-08-12

### Added

- Add a reproducible under-protected TypeScript launch demo, a security reporting policy, and GitHub issue forms for bugs and provider requests.

### Changed

- Clarify the README first-run path and document that audits are local read-only inspections after installation.

## 0.3.2 - 2026-08-11

- Publish new package versions automatically after pushes to `main`, while skipping versions already present on npm.
- Add configurable command timeouts with process-group termination for repository checks and setup installation.
- Roll back planned files and package-manager lockfiles when setup installation fails.
- Avoid treating workspace-only dependencies as root-installed providers and recognize CI install commands with lockfile flags.
- Skip existing quality scripts that contain common mutating or publishing commands.

## 0.3.1 - 2026-08-11

### Added

- Add consistent `--verbose`, `--quiet`, `--log-level`, and `--log-format` diagnostics to every command.
- Add structured JSON debug records for repository detection, provider output, and child-process execution.

### Fixed

- Include the exact command, exit status, duration, and output context in execution diagnostics.
- Preserve machine-readable health reports on stdout while all diagnostics remain on stderr.

## 0.3.0 - 2026-08-11

### Added

- Detect, recommend, install, and run Publint for npm package manifest and published-file validation.
- Detect, recommend, install, and run Are The Types Wrong? for typed package consumer-resolution validation.
- Normalize both package-health providers from machine-readable output against an offline local tarball.
- Add packaged Phase 3 acceptance coverage for audit, category-filtered JSON checks, and provider-attributed explain output.

## 0.2.1 - 2026-08-11

### Added

- Detect Oxfmt as active formatting coverage and run its non-mutating check mode.

### Fixed

- Parse valid `package.json` files that begin with a UTF-8 byte-order mark.
- Credit safe repository test scripts without mistaking formatting-only scripts for tests.
- Suppress redundant generic test-script evidence when Jest or Vitest already provides coverage.

## 0.2.0 - 2026-08-11

### Added

- Phase 2 detection and execution for OSV-Scanner, dependency-cruiser, eslint-plugin-boundaries, and Size Limit.
- Offline OSV vulnerability normalization and dependency-cruiser architecture findings.
- Optional dependency-cruiser setup with conservative starter rules.
- Real packaged acceptance coverage for architecture and bundle providers.
- Automated npm trusted publishing through GitHub Actions.

## 0.1.0 - 2026-08-10

### Added

- Initial local-first CLI with `audit`, interactive `setup`, normalized `check`, and `explain`.
- Repository, framework, package-manager, monorepo, CI, and existing-tool detection.
- Knip and jscpd setup, execution, normalization, and JSON reporting.
- npm, pnpm, Yarn, and Bun support with protected GitHub Actions validation.
