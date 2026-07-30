# Resolver canary

A throwaway file used to prove the conflict resolver works end to end.
Delete this along with the canary branches once the test has run.

Round 2: rebuilt on current main to retest the push -> handoff -> dispatch
chain after PR #149 (allowed_bots) merged; the round-1 resolve run refused
the github-actions bot actor.

Entries:
- baseline entry
- entry added by the PR branch (round 2)
- entry added by the base branch (round 2)
