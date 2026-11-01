# PR #210 — Promote the Actions control-plane rollup

## Purpose

Promote the current, mutually compatible GitHub Actions control plane from
`develop` to `main` in one reviewable release unit. The included source PRs
supersede and depend on one another; shipping only an intermediate revision
would briefly restore resolver/rebaser ownership bugs or leave the feature
promoter without its later failure guards.

This rollup contains no application product feature code.

## Included source PRs

| Source PR | Develop merge | Scope |
| --- | --- | --- |
| #192 | `2264d43b7348023c94aa14c6b7a22973fcf6e916` | Live changelog and delta comments for the standing promotion PR |
| #194 | `d1961f53b07585b9f3eef53c8e7c6e179bacb009` | Bounded mergeability polling and explicit stand-aside comments |
| #193 | `9a618c24001326c101225a41e5594218ec59ff1a` | Protect `develop` from promotion-PR history rewriting |
| #199 | `622733018952fae0ef93583d26d0501c382f868d` | Resolver/rebaser topology ownership and `jq` overflow repair |
| #190 | `26629b08ae6f0a70352c6ba21fa87b2f51fdd669` | Per-feature promotion workflow and routing contract |
| #206 | `944b27f8cc0a1df49b517e4ca6ac274351e5550b` | Promoter isolation, historical-object recovery, and always-on summaries |
| #207 | `78df65d0e45e0a16ee26b191c2315cabedf373e7` | Runner-safe self-test and exact empty-pick classification |
| #208 | `cd1bcee61a1b75b432e707575c5af8d3e8d6067b` | Restrict automatic rebasing to genuine PR stacks |

Each source merge is replayed as its own `-x` cherry-pick commit so the audit
trail remains attributable. The seven action workflow/script files were then
byte-compared with `origin/develop`; all match the live integration branch.

## Why one promotion PR

Opening eight independent PRs would both multiply Actions load and expose
invalid intermediate combinations. In particular, #208 assumes the topology
foundation from #199, while #206 and #207 harden the promoter introduced by
#190. This atomic rollup moves the tested final control-plane state to the
default branch without shipping obsolete intermediate workflow revisions.

## Validation

- `actionlint` over all changed workflows
- Node syntax checks for all three supporting scripts
- Feature-promoter integration self-test
- Conflict-resolver routing contract self-test
- Exact byte comparison of all seven workflow/script files against
  `origin/develop`
- Graphify structural and semantic refresh plus multigraph integrity diagnosis
- `git diff --check`

## Review focus

1. Confirm the default-branch event and secret boundaries remain fail-closed.
2. Confirm automatic rebase ownership requires genuine stack topology.
3. Confirm per-feature promotion remains idempotent and continues after an
   isolated source failure.
4. Confirm the rollup contains workflow infrastructure and its documentation,
   with no product feature implementation.
