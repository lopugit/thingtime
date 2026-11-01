# PR #654 — Media caching and AWS configuration promotion

The repository owner explicitly requested merging the work from PR #650 into
Thingtime main. This branch applies only that feature's owned changes to main;
it does not promote unrelated develop history. Current main release notes and
regression checks are preserved when resolving the concurrent Commander merge.

Implementation and live AWS provenance: [PR #650 note](650-codex-persistent-media-cache-responsive-previews-and-aws-configurations.md).

Validation before merge: production build and Vercel output checks passed;
148 attachment tests, 6 worker/storage tests and 6 capability tests passed on
the main-based source. Its application code is identical to the browser-tested
feature; documentation conflicts do not change runtime behavior. The protected
GitHub build/API/CodeQL checks remain the final merge gate. Production deployment
SHA, origin manifest and rendered media controls will be checked after merge.

[Promotion PR](https://github.com/lopugit/thingtime/pull/654).
