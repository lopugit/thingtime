# Action Thing v2 — external capabilities under the ONE permission model

The v1 open question, answered: **yes — internal capabilities and external
integrations can live under one permission model**, and Thingtime already owns
every primitive the design needs. This doc maps the architecture so v2 is an
extension of v1's contract, not a second system.

The target declaration (the original vision, verbatim):

```
⚡ Send Invoice
  Reads:          Invoice Things
  Writes:         Invoice Things
  Integration:    mailgun.send-email
  External scope: create-only
  Network:        only api.mailgun.net/v3/...
  Secrets:        inaccessible directly
  Limit:          1 external mutation / invocation
```

## The one rule that unifies both worlds

v1's load-bearing invariant is **capabilities only narrow**: every internal op
delegates to the things utils as the invoking user, so an action can never do
what its invoker couldn't. External calls have no "invoker could already do
it" backstop — the credential IS new authority. The unification rule:

> An external capability is never "the ability to fetch". It is the ability
> to invoke a NAMED OPERATION on a CONNECTION the invoker can use — and the
> Connection, not the Action, owns the credential, the host pinning, and the
> operation's request shape.

Then both worlds reduce to the same sentence: *a capability names an
operation vocabulary the executor will service, scoped by a resource list.*
`things.create: [invoice]` and `connection.invoke: [mailgun/send-email]` are
grammatically identical — which is exactly what makes one inspector, one
save-time coverage check, and one budget envelope possible.

## The `connection` kind (new, PROTECTED-adjacent)

One thing per integration account, following the established split:

- **crystal** (public projection — inspectable): `name`, `provider`
  (`mailgun`), `baseUrl` (`https://api.mailgun.net/v3/`), `operations` —
  a registry of named ops, each `{ key: 'send-email', method: 'POST',
  path: 'messages', effect: 'external-mutation' | 'external-read',
  inputs: [bounded typed descriptors], template: {…} }`. The template maps
  op inputs onto the HTTP request the same way action steps map `$input`
  refs — declarative substitution, never code.
- **root `secure` BinData blob** (the passkey/user-private-state precedent):
  the API key. Unsearchable, never projected, never readable through any
  route. The executor's connection layer decrypts server-side at call time
  and injects the auth header. **No op exists that returns credential
  material — the vocabulary simply doesn't define one** (the same argument
  that keeps v1 free of `while`).
- Writes ride a dedicated `/api/v1/connections` family (session-only,
  origin-checked), mirroring how passkeys are server-minted end to end.
  `connection-` joins the reserved shareId prefixes.

Why a thing and not config: connections become inspectable, ACL-shareable,
appear in /things, and "Which Actions can send data outside Thingtime?"
becomes a structural query over capability declarations — the everything-is-
a-thing payoff.

## Grammar additions (registry.ts — same sanitizer, new entries)

```
capability entry:  { capability: 'connection.invoke',
                     connection: '<connection thing id>',
                     operations: ['send-email'],           // allowlist, like actions
                     maxExternalMutations: 1 }             // per-invocation
step:              { op: 'connection.invoke',
                     connection: '<id>', operation: 'send-email',
                     inputs: { to: '$step.1.crystal.email', … } }
limits ceiling:    maxExternalMutations: 5 (default 1)
```

Save-time coverage extends unchanged: a `connection.invoke` step must be
covered by a `connection.invoke` capability whose connection matches and
whose operations allowlist contains the op. `deriveActionEffects` gains
`external: [{ connection, operation, effect }]`, and — critically for the
consent surface — an action with NO connection capability keeps rendering
**"🚫 No network"**, which stays *true by construction* because the executor
has no other path to the network.

## Executor changes (execute.ts — one new op handler)

1. Resolve the connection thing via `getThing(viewer, id)` — ACL applies, so
   you can only use connections shared with you (`tt:user`, `tt:userFriends`,
   or an org ACL — sharing a connection is sharing the *capability*, never
   the credential).
2. Defense-in-depth re-check (the `schemaScopeAllows` twin): operation ∈
   capability allowlist, connection id matches.
3. Budget: an external op consumes 1 op AND 1 external-mutation credit when
   `effect: 'external-mutation'` (shared across child actions like
   everything else — `A → B(send) → C(send)` drains the parent's credit).
4. Build the request from the op template + resolved inputs. **URL = the
   connection's `baseUrl` + the op's `path`, always** — step inputs
   substitute into body/query values only, never into scheme/host/path
   segments, so there is no SSRF surface: the Action cannot name a URL at
   all. Header injection server-side from the secure blob.
5. Trace entry: `{ step, op: 'connection.invoke', target: 'mailgun/send-
   email', ms, note: '1 external mutation' }`; size-capped response echo in
   the run record. The audit trail answers "which runs sent email today?"

## The inspector (already built — v2 adds rows, not surfaces)

Can access gains `connection.invoke: mailgun/send-email (1 mutation)`;
Cannot access derives `No network beyond api.mailgun.net/v3` from the bound
connection's baseUrl; Effects gains a 🌐 chip; Used by needs nothing. The
builder derives the connection capability from the step exactly like
`things.*` — the declaration stays true by construction.

## Security map delta (each gets a battery check, v1 style)

| Concern | Defense |
| --- | --- |
| Credential exfiltration | secure-blob storage; no op returns credential material; responses echoed size-capped only |
| SSRF / host escape | Action never supplies a URL; host+path pinned on the Connection; inputs substitute into values only |
| Consent under-reporting | "No network" derives from capability absence; coverage check refuses undeclared connection steps (v1's finding-1 lesson, applied from day one) |
| External amplification | maxExternalMutations shared across the invocation tree; per-connection rate rule in RATE_LIMIT_DEFAULTS (fail-closed, like components.seed) |
| Foreign connection use | ACL on the connection thing gates resolve — capability-sharing without credential-sharing |
| Replay/forgery of external evidence | run records stay executor-minted (protected kind), external calls traced |

## Rollout

1. **v2.0** — `connection` kind + `/api/v1/connections` + registry grammar +
   executor handler + inspector rows, one provider (mailgun) as the proving
   integration; battery checks for every security-map row.
2. **v2.1** — provider templates (webhook/generic REST), per-connection
   budgets and daily quotas via the service-quota ledger.
3. **v2.2** — the eventual `weather.forecast(location)` sugar: op aliases
   surfaced into the builder's step picker, still resolving to
   `connection.invoke` underneath — one grammar all the way down.

*Written 2026-08-25 against the shipped v1 (PR #387); companion to
[action-thing-v1-design.md](action-thing-v1-design.md).*
