# PR #597 — Publish multi-environment preview links on PRs

## Outcome

Admin-selected PR previews maintain one GitHub App-owned marker comment for all
enabled environments. The comment is published before deployment launch with
each environment's expected persistent URL and estimated ready time, then
updated with the immutable Vercel snapshot URL and terminal status.

Develop and Production/Main use separate wildcard namespaces. A READY receipt
moves only the matching PR/environment alias to the newest verified deployment;
disabling an environment or closing the PR removes only marker-owned preview
resources.

## Safety boundaries

- Only open, ready, same-repository pull requests with a live 40-character head
  SHA are deployable.
- Production-environment previews require an explicit admin acknowledgement.
- Vercel deployment and alias identities are checked against the configured
  project, PR, environment, and SHA before publication or cleanup.
- GitHub comments are updated only when their private marker and configured
  GitHub App ownership both match.
- Automatic custom-domain assignment stays disabled; `thingtime.com` and
  `dev.thingtime.com` are never reassigned.
- A failed build restores the prior durable environment selection and refreshes
  the comment to that restored state.

## Configuration

- `PREVIEW_ALIAS_SUFFIX` selects the Develop wildcard suffix.
- `PRODUCTION_PREVIEW_ALIAS_SUFFIX` selects the Production/Main wildcard
  suffix.
- `PREVIEW_EXPECTED_BUILD_MINUTES` optionally changes the clearly labelled
  estimate in the PR comment; it defaults to 5 and accepts 1 through 60.

## Validation

- CI Control unit suite: 64 passing tests.
- API capability manifest suite: 5 passing tests.
- Targeted ESLint: passing, apart from the repository's existing Remix config
  deprecation notice.
- Production Nitro/Vite build and Vercel output verification: passing.
- Graphify structural integrity: no missing endpoints, dangling edges,
  self-loops, or exact duplicates.
- Live read-only Vercel checks confirmed both preview wildcard domains are
  verified and the team-scoped alias response includes the expected alias,
  deployment, project, and alias identifiers.

The repository-wide typecheck ratchet remains non-blocking at 109 errors versus
its baseline of 108; none of the reported errors are in the preview publisher
or route changed by this PR.

## 2026-09-03 protected-controller follow-up

The product-side deployment/comment implementation above has been superseded.
The admin API now retains only live-PR validation, the durable two-environment
policy, and a bounded repository dispatch sent by `thingtime-ci-control[bot]`.
All Vercel calls, aliases, cleanup, and the GitHub Actions-owned marker comment
live on the protected `github-actions` branch.

Each selected environment is built from the controller-authorized exact SHA in
an environment-free GitHub job. A symlink-preserving archive is validated by
protected code before the Vercel token is present, and the publisher uses only
`--prebuilt --skip-domain`. This prevents PR code from receiving Develop or
Production environment secrets during compilation while preserving the
multi-row expected URL, estimated time, immutable snapshot, and persistent
alias behavior requested by the feature.
