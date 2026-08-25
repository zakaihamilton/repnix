# Compatibility pilots

RepNix's supported JavaScript and TypeScript repository shapes are protected by two read-only pilot corpora. A checked-in corpus runs on every verification, while an external OSS corpus checks selected public repositories at pinned commits each week and on demand. Neither installs provider packages or modifies a pilot repository.

| Pilot             | Represents                                        | Package manager | Expected role                     |
| ----------------- | ------------------------------------------------- | --------------- | --------------------------------- |
| `minimal-js`      | Small JavaScript command-line or Node application | npm             | Node application                  |
| `node-typescript` | TypeScript Node application                       | Yarn            | Node application                  |
| `npm-library`     | Publishable typed package                         | npm             | Library                           |
| `react-eslint`    | React application with existing linting           | npm             | Node application + React          |
| `next-biome`      | Next.js web application with Biome                | pnpm            | Web application + Next.js + React |
| `pnpm-monorepo`   | Multi-package workspace                           | pnpm            | Three Node application scopes     |

For every checked-in pilot, the suite asserts the detected package manager and roles, the complete recommendation list, and the packages and files in `repnix setup --plan --format json`. It snapshots every file before and after both commands, including an unexpected `node_modules` directory, so an audit or plan that mutates a repository fails the test.

Run the built-CLI suite after `pnpm build`:

```bash
pnpm test:compatibility
```

The cross-platform packaged-CLI smoke job invokes this same suite through the npm tarball. This ensures the published command has the same behavior as the source build.

## External OSS pilots

[`fixtures/oss-pilots.json`](../fixtures/oss-pilots.json) pins a public npm library (p-queue), toolchain/monorepo (Vite), application workspace (create-t3-turbo), and Next.js repository to immutable commit IDs. The scheduled `OSS compatibility` workflow fetches those exact revisions, runs `audit` and read-only setup planning, checks the detected package manager, rejects plan warnings or conflicts, and snapshots every checked-out file before and after. Run it locally when network access is available:

```bash
pnpm test:compatibility:oss
```

Refresh a revision intentionally after reviewing the new audit and plan output; a different fetched commit is a test failure, not an implicit update.

## Reporting a mismatch

Include the repository shape, package manager and lockfile, relevant `package.json` scripts, and the JSON output from `repnix audit --format json` and `repnix setup --plan --format json`. Do not include secrets or private source files. A recommendation that is irrelevant, unsafe to apply, or missing from a supported shape is release-blocking until RepNix fixes it, safely abstains, or explains that the shape is unsupported.

## Adding a pilot

Start with the smallest fixture that reproduces the repository shape. Keep it free of `node_modules`, generated build output, credentials, and live network dependencies. Add its expected, intentional audit and setup-plan behavior to `scripts/compatibility-pilot.mjs`, then run `pnpm verify` and `pnpm test:package`.
