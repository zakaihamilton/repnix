# Setup and workflow

RepNix follows a detect → recommend → plan → run model:

1. Detect scope roles, package manager, source roots, scripts, CI, configuration, and active provider capabilities.
2. Use evidence-backed category applicability so CLI, library, browser, Node, and tooling scopes receive different recommendations.
3. Build a minimal installation plan that preserves existing project choices.
4. Run active providers and normalize their findings into a shared report with category, severity, provider, and location.

The workflow is:

```text
audit → choose recommendations → setup → check
```

1. **Audit** the repository without modifying it.
2. **Choose** the providers that fit your project.
3. **Set up** packages, scripts, configuration, and optional CI integration through a previewed plan.
4. **Check** all active health providers with one command.
5. Use `check --details` for normalized messages, locations, remediation, baseline state, and provider attribution.

## Audit

`repnix audit` inventories the checks already protecting the repository and recommends useful gaps. It does not install packages or edit files.

After the initial installation, `audit` reads only local project files. RepNix does not install packages, edit files, or access a package registry during an audit. Built-in providers inspect repository metadata and configuration; configured repository scripts remain trusted executable code when checks run.

## Interactive setup

`repnix setup` is an interactive, opt-in change flow:

- In a capable terminal, setup opens a full-screen keyboard-driven dashboard that starts with an audit page showing detected project facts, category coverage, and recommendation priorities. Press **Enter** to continue to provider selection, review the planned changes, and explicitly confirm apply.
- After the audit page, setup opens a manual-recommendations step when checks need project-specific decisions. It lists those checks with concrete setup steps and the command to run when ready. RepNix can automatically add report-only c8 coverage around a safe test command, standard Changesets configuration when Git exposes the remote default branch, and jsx-a11y rules for a root legacy `.eslintrc.json`. Press **Enter** to continue to installable checks or **q/Esc** to leave without changing files. If no recommendations exist, the audit page explains that there is nothing to add before setup exits.
- Baseline recommendations are preselected because they are useful for most JavaScript and TypeScript repositories.
- Optional and advanced recommendations are not automatically enabled when they need project-specific rules or budgets.
- Use **↑/↓** or **j/k** to move after the audit page. On the selection screen, **Space** selects or clears a provider and **Enter** continues. Press **Esc** or **Delete** to return to the previous page; use **q** to quit. On the review screen, **↑/↓** moves between files, **Space** inspects the focused file, and **Enter** opens confirmation. In the confirmation dialog, focus starts on **Cancel**; press **→** to focus **Apply**, then **Enter**. While changes are being applied, exit keys are disabled until the rollback-safe operation finishes.
- Before confirmation, RepNix shows the packages, scripts, configuration files, and optional CI changes it plans to apply. Existing files are preserved and conflicts are shown for review.
- Some recommendations need preparation outside RepNix: OSV-Scanner, Gitleaks, and actionlint need their binaries available; architecture checks need module-boundary rules; bundle and Lighthouse checks need explicit artifacts, budgets, or URLs; and Stryker needs test-specific configuration.

If the terminal is too small or does not support the full-screen dashboard, RepNix falls back to sequential prompts. Non-interactive environments can use `repnix setup --plan --format json` for a read-only plan.

When you run setup from a local Git checkout of an unreleased RepNix build, it installs that checkout with a local `file:` dependency instead of trying to fetch the unreleased version from npm. Published RepNix installations continue to use the version from the npm registry.

The interactive setup flow is: `audit → manual guidance (when needed) → select checks → review changes → apply safely`.

Setup applies planned files atomically and restores planned files plus package-manager lockfiles if dependency installation fails. Package-manager lifecycle scripts can still run during a normal dependency installation.

## Check and fix

After setup completes, run:

```bash
npm run health
```

For detailed findings and remediation, use:

```bash
npx repnix check --details
```

The full-screen setup check also saves an AI-ready handoff at `.repnix/health-report.md`. Attach or drop that file into an AI coding assistant while it is working in the repository, then ask it to inspect the referenced files, make the smallest safe fixes, and run the verification commands included in the report. Review the proposed changes and run `npx repnix check` yourself afterward. The companion `.repnix/check-results.md` file is a short human-readable runbook.

You can use this prompt as-is:

```text
Read .repnix/health-report.md, inspect the referenced files, and fix the reported repository-health issues. Make the smallest safe changes, preserve intended behavior, and do not suppress or baseline findings. Run the verification commands in the report, then summarize the changes and any remaining issues.
```

## Current limits

- Workspace package scripts are executed separately when they use recognized non-mutating type, lint, format, or test commands. RepNix does not invent a workspace task graph or rewrite package scripts automatically.
- Existing repository scripts are only run when they look like non-mutating quality checks. Scripts containing fix, write, watch, install, publish, deployment, or other mutating commands are skipped and the configured provider fallback is used where available.
- Specialist lint, type, formatting, test, `eslint-plugin-boundaries`, and Size Limit output is represented as a provider-attributed command finding. Knip, jscpd, OSV-Scanner, dependency-cruiser, Publint, and Are The Types Wrong? receive detailed normalization.
- Accessibility, workspace consistency, coverage, secret scanning, license policy, documentation, release, performance, and CI workflow providers are available when their provider is installed and configured. Setup can add report-only c8 coverage, compatible legacy JSX accessibility rules, and Changesets configuration when its base branch is known. Other providers intentionally remain manual because they need project-specific URLs, budgets, binaries, or policy rules.
- Architecture rules and bundle budgets are repository-specific. RepNix does not invent boundary policies or size budgets.

For trust boundaries, package lifecycle behavior, and network expectations, see [Security and trust](security.md).
