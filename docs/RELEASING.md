# Releasing and verifying releases

## Verifying an official release (for users)

Official packages are built from this repository by `.github/workflows/release.yml`, not from a laptop. Two independent checks, both free:

1. **npm provenance.** npm records which repository, commit and workflow built each package.
   ```bash
   npm install @senscheck/governance-core
   npm audit signatures        # verifies registry signatures and provenance attestations
   ```
   On the package page on npmjs.com, look for the "Provenance" badge linking to the exact commit and workflow run.
2. **GitHub build attestation** for the tarball itself:
   ```bash
   npm pack @senscheck/governance-core
   gh attestation verify senscheck-governance-core-*.tgz --repo teknoledg/senscheck-governance-core
   ```

_These checks only apply once a version has actually been published by that workflow. If a package has no provenance, or a fork or mirror republishes it, treat it as unofficial._

What this proves: **where and how the package was built** (a particular repo, commit and workflow). It does **not** prove the code is free of bugs, and it is not a code signature by a person.

## Cutting a release (maintainers)

1. Make sure `main` is green and `RELEASE_NOTES.md`, versions in every `packages/*/package.json` and the plugin manifests agree.
2. Run **Actions → Release → Run workflow** with `dry_run: true`. This builds, tests, packs, installs the tarballs into a clean fixture, runs the examples with network access trapped, audits dependencies and attests the tarballs. Nothing is published.
3. Download the `tarballs` artifact and inspect it if you wish.
4. For a real publish: run the workflow again with `dry_run: false` and `confirm_version` set to the version (a typo aborts the publish). The `publish` job waits for **required reviewers** on the `npm-release` environment. Approve it only after checking the dry-run.
5. Tag the release in Git (`git tag -s vX.Y.Z` if you have a signing key) and publish release notes.

### One-time setup (repository owner)

- Create the GitHub Environment **`npm-release`** (Settings → Environments) and add **required reviewers**.
- Add an environment secret **`NPM_TOKEN`**: a granular npm token, publish-only, restricted to the `@senscheck` scope, with a short expiry. Do not store it as a repository-level secret.
- Make sure the `@senscheck` npm scope is owned by the TEKNOLED-G organisation, with 2FA enforced on every maintainer account.
- Optionally configure npm **trusted publishing** (OIDC) for these packages and then remove the long-lived token.

### Supply-chain rules for the workflow

- Every third-party action is pinned to a full commit SHA (update deliberately, with a PR).
- Publishing is manual and human-approved; there is no publish-on-push or publish-on-tag.
- Package scripts never run with the npm token in scope (the token exists only in the `publish` step).
