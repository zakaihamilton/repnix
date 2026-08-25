# Health categories

RepNix separates repository health into categories so each capability has a clear home. The category name is also the value you can pass to `repnix check <category>`.

| Category                                 | What it protects                                                               | Typical tools                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `types` — Type safety                    | Catches mismatched values before runtime.                                      | TypeScript                                     |
| `lint` — Linting                         | Finds suspicious or inconsistent code patterns.                                | ESLint, Oxlint, Biome                          |
| `format` — Formatting                    | Keeps code style consistent.                                                   | Prettier, Oxfmt, Biome                         |
| `tests` — Tests                          | Protects existing behavior from regressions.                                   | Jest, Vitest, safe test scripts                |
| `coverage` — Test coverage               | Measures test reach and optional coverage thresholds.                          | c8, Stryker                                    |
| `dead-code` — Dead code                  | Finds unused files, exports, and dependencies.                                 | Knip                                           |
| `duplication` — Duplication              | Finds repeated code that can drift apart.                                      | jscpd                                          |
| `security` — Dependency security         | Finds known vulnerabilities in dependencies.                                   | OSV-Scanner                                    |
| `architecture` — Architecture boundaries | Protects allowed relationships between modules.                                | dependency-cruiser, `eslint-plugin-boundaries` |
| `bundle` — Bundle regression             | Protects shipped JavaScript size.                                              | Size Limit                                     |
| `accessibility` — Accessibility          | Checks whether user interfaces can be used by people with different abilities. | eslint-plugin-jsx-a11y                         |
| `monorepo` — Monorepo consistency        | Checks whether packages in a monorepo follow shared rules.                     | syncpack, workspace scripts                    |
| `secrets` — Secret scanning              | Finds credentials and sensitive values committed to the repository.            | Gitleaks                                       |
| `licenses` — License policy              | Checks dependency licenses against an allow/deny policy.                       | license-checker                                |
| `documentation` — Documentation          | Checks Markdown structure and style.                                           | markdownlint                                   |
| `performance` — Performance budgets      | Protects configured web or build performance budgets.                          | Lighthouse CI, Size Limit                      |
| `release` — Release readiness            | Checks release metadata and package change intent.                             | Changesets                                     |
| `ci` — CI workflow health                | Checks GitHub Actions workflow syntax and common mistakes.                     | actionlint                                     |
| `package-health` — Package publishing    | Checks what npm consumers receive.                                             | Publint, Are The Types Wrong?                  |

## Existing project checks

RepNix detects and runs the safe commands your repository already uses for:

- Type safety — TypeScript.
- Linting — ESLint, Oxlint, or Biome.
- Formatting — Prettier, Oxfmt, or Biome.
- Tests — Jest, Vitest, or a safe existing test script.
- Test coverage — c8 or Stryker when a coverage or mutation command is configured.
- Accessibility — active `eslint-plugin-jsx-a11y` rules in an ESLint configuration.
- Monorepo consistency — syncpack or safe workspace scripts.
- Secret scanning — Gitleaks when its binary or repository script is available.
- License policy — license-checker with an optional allow/deny policy.
- Documentation — markdownlint for Markdown files.
- Performance — Lighthouse CI or existing performance scripts with an explicit configuration.
- Release readiness — Changesets and its configuration.
- CI workflow health — actionlint for GitHub Actions workflows.

## Specialist checks

When the repository needs additional coverage, RepNix can recommend and orchestrate:

- **Dead code:** Knip for unused files, exports, and dependencies.
- **Duplication:** jscpd for copy/paste drift.
- **Dependency security:** OSV-Scanner using its offline vulnerability database.
- **Architecture:** dependency-cruiser or active `eslint-plugin-boundaries` rules.
- **Bundle size:** Size Limit when an explicit budget already exists.
- **Accessibility:** eslint-plugin-jsx-a11y through an existing ESLint setup.
- **Workspace consistency:** syncpack for dependency and package metadata drift.
- **Coverage:** c8 for threshold checks and Stryker for mutation testing.
- **Secret scanning:** Gitleaks, using a local binary or CI-provided binary.
- **License policy:** license-checker with explicit allowed or denied licenses.
- **Documentation:** markdownlint for Markdown files.
- **Performance:** Lighthouse CI when a URL/build configuration and budgets exist.
- **Release readiness:** Changesets when the repository uses changesets.
- **CI workflow health:** actionlint for GitHub Actions workflow files.

## Package publishing

Publishable npm packages can also use:

- **Publint** for exports, entry points, module formats, package metadata, and published files.
- **Are The Types Wrong?** for TypeScript consumer compatibility across Node and bundler resolution modes.

Package-health checks analyze a local packed artifact with lifecycle scripts disabled. They do not implicitly run a repository `prepack` script or fetch registry data. If the package normally builds during `prepack`, run that build explicitly before `repnix check package-health` so the packed artifact matches the one you intend to publish.

## Reading the report

- A **category** is the kind of protection being measured, such as tests or dependency security.
- A **provider** is the tool that performs the check, such as Vitest, Knip, or OSV-Scanner.
- **Covered** means an active provider contributes the capability. **Partly covered** means some related capabilities are active but a gap remains. **Missing** means no active provider was found.
- A **finding** is an issue reported by a check. A **check error** means the tool could not finish, usually because setup or configuration needs attention.
- `repnix audit` is for deciding what to add. `repnix check` is for a quick result, and `repnix check --details` explains what to do about findings.

If `repnix check` says that no applicable health checks ran, RepNix did not find an active provider for that category. That is not the same as being covered; run `repnix audit` to see whether a provider is missing, disabled, or not relevant to the repository.
