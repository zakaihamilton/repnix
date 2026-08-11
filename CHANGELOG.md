# Changelog

All notable changes to RepNix are documented here. The project follows semantic versioning.

## Unreleased

- Publish new package versions automatically after pushes to `main`, while skipping versions already present on npm.

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
