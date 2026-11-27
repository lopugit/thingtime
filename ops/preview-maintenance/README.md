# Reviewed preview-maintenance release artifacts

This directory contains frozen release inputs for the protected preview
controller on `github-actions`. It is not a second maintained application or
an alternative source branch. Ordinary preview publication still requires the
exact current PR head.

A maintenance artifact keeps a specific working retained preview usable while
applying an already-delivered platform protection correction. Commit its
manifest and protection-only patch through a normal PR into canonical `main`.
The protected controller validates that reviewed merged-main provenance;
a checksum alone does not authorize an arbitrary source or uploaded patch.
Keep credentials, user data and build output out of these files.

The manifest binds the open same-repository PR's exact current head/ref, the
READY non-production incumbent deployment and retained source SHA, patch path
and SHA-256, reconstructed Git tree, and merged implementation commit.
`sourceTree` identifies the actual tree to build. It is not a GitHub commit or
the current PR head. The artifact commit is supplied separately at dispatch,
so the manifest does not contain a self-referential commit hash.

## Publish only the reviewed immutable intent

After the controller and artifact PRs merge normally, dispatch
`develop-pr-preview.yml` from `main` with the existing positive `pr_number` and:

- `maintenance_artifact_commit`: the exact merged canonical-main commit holding
  the reviewed bytes, verified as an ancestor of the current main branch;
- `maintenance_manifest_path`: `ops/preview-maintenance/<id>/manifest.json`;
- `maintenance_manifest_sha256`: SHA-256 of those exact manifest bytes.

All three fields default empty. Scheduled, PR and repository-dispatch events
cannot opt into maintenance. Do not combine maintenance with retirement.
A stale PR head, replaced incumbent, invalid project/alias ownership, changed
policy, unmerged provenance, altered patch or different source tree must stop
publication. Refresh an obsolete intent through a new review; never silently
substitute a source revision, bypass the fence or repeat uncertain publication.

The credential-free build checks out the retained source, applies only the
pinned patch and requires the exact tree before normal build/archive validation.
The protected publisher rechecks live authorization and source provenance, then
requires immutable-candidate bootstrap and signed relay acceptance before
changing aliases. Conditional rollback must not overwrite a concurrent publisher.

Record actual retained baseline/tree/overlay identities separately from the
current authorization head. Do not mark the ordinary feature-head deployment
successful. Reconcile must preserve an accepted maintenance alias while its
intent is valid; a replacement still needs ordinary atomic health gates.

## Frozen PR 1000 protection overlay

`pr-1000-protection-2026-11-13/` retains the existing anonymous/local-first
preview source and adds only gateway discovery/relay platform credentials,
header sanitization, their focused regressions, `api.environment-gateway`
1.1.1 metadata and a changelog line. The implementation was delivered through
[PR 1502](https://github.com/lopugit/thingtime/pull/1502). The old client's existing
same-origin capability requests already preserve the supported automation cookie.

The overlay does not include newer feature work, downgrade its contracts or
merge the feature PR. Local checks of the exact reconstructed tree passed the
gateway and capability suites, focused lint and zero-error typecheck ratchet.
Those checks do not establish a hosted build, protected transport or browser
acceptance. Require those separately and retain the prior working deployment
until immutable candidate acceptance succeeds.

To independently verify reconstruction, use a temporary isolated Git index:
read the manifest's retained source tree, apply `protection.patch` with
`git apply --cached`, then require `git write-tree` to equal `sourceTree`.
Verify both byte digests and source ancestry separately. Do not modify the
working feature branch or create a synthetic remote source commit for this test.
