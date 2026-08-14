# Security and trust

RepNix is local-first, but it is not a sandbox. Treat the repository and its installed tools as trusted code.

- `audit`, `setup --plan`, and `check` may load direct `repnix-provider-*` dependencies. Importing a plugin can run its module initialization; selected plugin hooks can also run during planning, setup, or checks.
- `check` may run configured, non-mutating repository quality scripts. “Non-mutating” describes RepNix's script detection, not a security sandbox or guarantee about arbitrary script behavior.
- `setup` can run the selected package manager to install development dependencies. Package-manager lifecycle scripts may run during that installation, so review the plan and worktree before confirming.
- Package-health checks pack the repository with lifecycle scripts disabled. They do not run `prepack`; build generated files first when your published package depends on a build step.
- Security tools such as OSV-Scanner require a locally prepared database or binary. RepNix does not download one implicitly.

RepNix does not promise that a repository's own scripts or third-party provider plugins are network-free or harmless. Run it with the same trust and permissions you would give those tools directly.

## Network behavior

`audit` and `check` do not make RepNix network requests, but configured repository scripts and provider plugins are executable code and may have their own side effects or network behavior. Security and package-health providers use local/offline execution paths where supported.

OSV-Scanner must be installed separately with its local vulnerability database prepared before security coverage can be required. Package-health checks analyze a local packed artifact and do not fetch registry data.

## Provider plugins

External providers are trusted project dependencies. RepNix imports them during audit, setup planning, and checks; module initialization can run immediately, and RepNix may invoke detection, recommendation, setup, and run hooks during setup or check. Do not install an unreviewed provider plugin merely to inspect a repository.

For the provider contract and plugin development guidance, see [Provider plugins](provider-plugins.md).
