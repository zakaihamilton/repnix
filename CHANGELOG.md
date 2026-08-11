# Changelog

All notable changes to RepNix are documented here. The project follows semantic versioning.

## Unreleased

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
