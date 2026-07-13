# Release checklist

Publishing changes external state. Run this checklist locally or from a trusted release job, and
publish only after the package name, version, registry account, and intended commit are confirmed.

1. Ensure the working tree contains only reviewed release changes.
2. Confirm `package.json` has the intended package name and version, `private: false`, Bun engine,
   repository metadata, runtime dependencies, and the explicit package `files` allowlist.
3. Run `bun install --frozen-lockfile` with the supported Bun version.
4. Run `just check` on macOS and Ubuntu CI.
5. Run any live suite only against the dedicated disposable account with `TICKTICK_LIVE=1`.
6. Inspect `npm pack --dry-run --json`; reject `.claude`, `.env*`, tests, raw fixtures, vendored API
   references, cookies, tokens, account dumps, and repository-only tooling.
7. Extract the tarball and confirm `src/index.ts` starts with `#!/usr/bin/env bun` and is executable.
8. Install the tarball under an empty temporary prefix and invoke `tt --version` and `tt --help`.
9. Invoke the same tarball through `bunx --package TARBALL tt --version` from an empty directory.
10. Confirm the package contains no OAuth or browser implementation and needs no repository file at
    runtime.
11. Review release notes and publish with the explicitly selected npm account.
12. Verify installation from the registry using a clean temporary home before announcing release.

Never expose live secrets to pull requests from forks. The normal CI workflow is synthetic and
offline with respect to TickTick account data.
