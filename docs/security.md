# Security and trust

RepNix is local-first, but it is not a sandbox. Treat the repository and its installed tools as trusted code.

- `check` may run configured, non-mutating repository quality scripts. “Non-mutating” describes RepNix's script detection, not a security sandbox or guarantee about arbitrary script behavior.
- `setup` can run the selected package manager to install development dependencies. Package-manager lifecycle scripts may run during that installation, so review the plan and worktree before confirming.
- Package-health checks pack the repository with lifecycle scripts disabled. They do not run `prepack`; build generated files first when your published package depends on a build step.
- Security tools such as OSV-Scanner require a locally prepared database or binary. RepNix does not download one implicitly.

RepNix does not promise that a repository's own scripts or third-party provider binaries are network-free or harmless. Run it with the same trust and permissions you would give those tools directly.

Diagnostics redact high-confidence credentials such as private-key blocks, bearer tokens, credential-bearing URLs, and common service-token formats before writing logs or machine-readable health reports. This is a leakage safeguard, not a guarantee that arbitrary provider output is safe; do not place secrets in repository scripts or provider messages.

## Network behavior

`audit` and `check` do not make RepNix network requests, but configured repository scripts and provider binaries are executable code and may have their own side effects or network behavior. Security and package-health providers use local/offline execution paths where supported.

OSV-Scanner must be installed separately with its local vulnerability database prepared before security coverage can be required. Package-health checks analyze a local packed artifact and do not fetch registry data.

The CI workflow provisions pinned standalone binaries for OSV-Scanner, Gitleaks, and actionlint before running the unified health command. Local checks report a missing binary as an actionable execution error rather than silently treating the category as covered.
