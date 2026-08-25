---
"repnix": minor
---

Add `repnix fix` command for automated remediation and expand test runner detection.

- **New `repnix fix [category]` command**: Automatically discovers and sequentially executes safe auto-fixable tasks (such as repository `format` scripts, Prettier/Biome formatting, ESLint `--fix`, and markdownlint auto-formatting).
- **Test Runner Detection**: Broadened native test runner signals (including `node --test-reporter`).
- **Compatibility Pilots**: Validated all compatibility pilot test suites across monorepos and library structures.
