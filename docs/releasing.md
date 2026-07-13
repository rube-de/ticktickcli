# Releasing

`@rube-de/ticktickcli` uses two release paths:

- `0.1.1` is published directly from the tagged commit by a human using npm two-factor
  authentication (2FA). npm cannot configure trusted or staged publishing until the package
  already exists.
- Every later release is packaged by GitHub Actions, submitted to npm with short-lived OpenID
  Connect (OIDC) credentials, and held in npm's staging area until a human reviews and approves it
  with 2FA.

Only stable SemVer releases are supported. Release tags are `vX.Y.Z`, and approved packages use
the `latest` npm dist-tag. Do not configure an `NPM_TOKEN` or `NODE_AUTH_TOKEN` in GitHub.

The existing `v0.1.0` tag is intentionally preserved as an unpublished historical tag. npm
rejected the unscoped `ticktickcli` package name because it is too similar to `ticktick-cli`; do
not move or publish a GitHub Release for that tag. The first npm release is the scoped package
`@rube-de/ticktickcli@0.1.1`.

Use these release tool versions:

- Bun `1.3.14`
- Node.js 24
- npm `11.18.0`

## One-time setup and `0.1.1` bootstrap

### 1. Prepare npm and GitHub

1. Create or sign in to the npm account that owns the `@rube-de` scope, verify its email address,
   enable 2FA, and store the recovery codes somewhere safe. npm requires 2FA for an interactive
   publish. See [npm's publishing authentication guidance][npm-2fa].
2. In the GitHub repository, create an environment named `npm`:
   - Under deployment branches and tags, allow only tags matching `v*`.
   - Do not add secrets.
   - Do not add an environment reviewer. Approval of the staged package with npm 2FA is the human
     release gate.
3. Merge and push the release implementation to `main`, and wait for the macOS and Ubuntu CI jobs
   to pass.
4. Check that the scoped package has not already been published:

   ```sh
   npm view @rube-de/ticktickcli --registry=https://registry.npmjs.org/
   ```

   Continue only when npm returns a genuine `E404` for an unknown package. An authentication,
   authorization, DNS, TLS, timeout, or other network error does not prove that the name is
   available. If npm finds an existing version, stop and choose a new version; never reuse a
   published version.

### 2. Tag and test the exact commit

Start from the clean, reviewed `main` commit whose CI run passed:

```sh
git switch main
git pull --ff-only
git status --short
bun --version
node --version
npm --version
test "$(node -p "require('./package.json').version")" = "0.1.1"
bun install --frozen-lockfile --ignore-scripts
bun run check
git status --short
git tag -a v0.1.1 -m "ticktickcli v0.1.1"
git push origin v0.1.1
```

Both `git status --short` commands must print nothing. Confirm the reported tool versions match the
versions above before creating the tag. Do not move or replace the tag after pushing it.

### 3. Publish directly with 2FA

Publish from a detached checkout of that exact tag, not from a later working-tree state:

```sh
git switch --detach v0.1.1
bun install --frozen-lockfile --ignore-scripts
bun run check
git status --short
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --tag latest --registry=https://registry.npmjs.org/
```

Confirm the expected npm username after `npm whoami`, ensure the working tree is still clean, and
complete npm's 2FA challenge. This is the only release that is published directly by a human.

Verify the live metadata and a clean installation before continuing:

```sh
npm view @rube-de/ticktickcli@0.1.1 name version dist-tags.latest dist.integrity \
  --json --registry=https://registry.npmjs.org/
release_prefix="$(mktemp -d)"
npm install --global --prefix "$release_prefix" @rube-de/ticktickcli@0.1.1 \
  --registry=https://registry.npmjs.org/
"$release_prefix/bin/tt" --version
"$release_prefix/bin/tt" --help
rm -rf -- "$release_prefix"
unset release_prefix
```

The version command must report `0.1.1`, and help must exit successfully.

### 4. Enable stage-only trusted publishing

After `@rube-de/ticktickcli@0.1.1` exists on npmjs.com, open the package settings and add a trusted publisher with
these exact values:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Owner | `rube-de` |
| Repository | `ticktickcli` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | `npm stage publish` only |

Enter only the workflow filename, not `.github/workflows/release.yml`. Then open **Publishing
access**, select **Require two-factor authentication and disallow tokens**, and save. Revoke any
unused npm write tokens. See npm's [trusted publishing][npm-trusted] and [staged
publishing][npm-staged] documentation for the security model.

Finally, create a GitHub Release for the existing `v0.1.1` tag and publish it. The release workflow
must find the already-published version with identical SHA-512 integrity and finish successfully as
an idempotent no-op. It must not create a staged copy. This manually published bootstrap release
will not have GitHub Actions provenance.

## Every later release

### 1. Prepare the release commit

Choose the next stable SemVer version. The example below uses `0.1.2`:

```sh
git switch main
git pull --ff-only
git status --short
npm version 0.1.2 --no-git-tag-version
bun run docs:generate
bun run check
git diff --check
git diff
```

Review and commit only the intended version and generated-document changes, push the commit to
`main`, and wait for both CI operating systems to pass. Record the tested commit SHA. Do not create
the release from a different commit.

### 2. Publish the GitHub Release

In GitHub, draft a release with all of the following properties:

- The new tag is exactly `vX.Y.Z`, matching `package.json` (for example, `v0.1.2`).
- The target is the tested commit on `main`.
- The release notes describe the user-visible changes.
- The release is a normal stable release, not a prerelease.

Publish the GitHub Release. The `release.yml` workflow will then:

1. Verify that the tag has stable SemVer syntax, matches the package version, and points to a commit
   reachable from `main`.
2. Install with lifecycle scripts disabled, run the full checks, build the exact npm tarball, and
   smoke-test that artifact in a job without OIDC permission.
3. Pass only the tarball to the `npm` environment job. That job independently validates its
   manifest and SHA-512 integrity and runs no repository code or dependency installation.
4. Finish as a no-op if that version is already live with identical integrity, fail closed if its
   integrity differs, or run `npm stage publish` with OIDC only after a genuine registry `E404`.

Staging does not publish the version or change `latest`. Wait for the workflow to complete before
reviewing the package.

### 3. Review and approve on npm

Open the package's **Staged Packages** tab on npmjs.com. Confirm the package name, version, `latest`
tag, source commit, workflow run, and included files. Download the tarball and inspect or install it
before approval. npm 11.18.0 also supports this review flow from the CLI:

```sh
npm login --registry=https://registry.npmjs.org/
npm stage list @rube-de/ticktickcli --registry=https://registry.npmjs.org/
npm stage view STAGE_ID --registry=https://registry.npmjs.org/
npm stage download STAGE_ID --registry=https://registry.npmjs.org/
```

After reviewing the downloaded tarball, approve it in npmjs.com or run:

```sh
npm stage approve STAGE_ID --registry=https://registry.npmjs.org/
```

Approval always requires 2FA and makes the staged version public. If anything is wrong, reject it
in npmjs.com or use `npm stage reject STAGE_ID`, then fix the problem and release a new patch
version. Do not approve an artifact on the assumption that its version can be replaced later.

### 4. Verify the public release

Replace `X.Y.Z` with the approved version:

```sh
npm view @rube-de/ticktickcli@X.Y.Z name version dist.integrity \
  --json --registry=https://registry.npmjs.org/
npm view @rube-de/ticktickcli dist-tags.latest --registry=https://registry.npmjs.org/
release_prefix="$(mktemp -d)"
npm install --global --prefix "$release_prefix" @rube-de/ticktickcli@X.Y.Z \
  --registry=https://registry.npmjs.org/
"$release_prefix/bin/tt" --version
"$release_prefix/bin/tt" --help
rm -rf -- "$release_prefix"
unset release_prefix
```

Confirm that `latest` is `X.Y.Z`, the CLI reports the same version, and help exits successfully.
On the npm package version page, verify the provenance indicator and confirm that its source commit
and workflow point to the intended GitHub release. To verify attestations from the CLI, install the
release in a clean npm project and run `npm audit signatures`; see [viewing package
provenance][npm-provenance].

## Failure recovery and immutability

- **A verification job fails before staging:** fix the cause on `main`, choose a new patch version,
  and publish a new GitHub Release. Do not move the published release tag or reuse its version.
- **The registry lookup fails for a reason other than `E404`:** no package is staged. Correct the
  npm, OIDC, DNS, TLS, or service problem, then rerun the failed job.
- **A stage command has an ambiguous result:** inspect **Staged Packages** or run `npm stage list
  @rube-de/ticktickcli` before retrying. If the stage exists, review that exact stage instead of submitting
  it again. If it does not exist, rerun the failed job.
- **The version is already public with identical integrity:** the workflow's successful no-op is
  expected; no approval is required.
- **The version is already public with different integrity:** stop and investigate. npm package
  versions cannot be overwritten; create a corrected patch release after resolving the cause.
- **A staged artifact is wrong:** reject it with 2FA and create a new patch version. A staged version
  reserves that package version until it is rejected, and its chosen dist-tag cannot be changed.
- **A bad package was approved:** do not unpublish and reuse the version. Correct forward with a new
  patch release; if necessary, temporarily point `latest` back to a known-good published version
  while preparing the fix.

Once a package name and version has been published, npm never permits that combination to be used
again, even after unpublishing. Treat release commits, Git tags, GitHub Releases, staged artifacts,
and npm versions as immutable. Never move a release tag, replace an artifact, or retry corrected
contents under the same version.

Never expose TickTick credentials or npm credentials to pull requests from forks. Normal CI and
release packaging do not require live TickTick account data.

[npm-2fa]: https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/
[npm-provenance]: https://docs.npmjs.com/viewing-package-provenance/
[npm-staged]: https://docs.npmjs.com/staged-publishing/
[npm-trusted]: https://docs.npmjs.com/trusted-publishers/
