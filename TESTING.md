# Control-plane regression checks

## Native negative-authority supervision

Run only the trusted controller tests, with no privileged invocation:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -I -S .github/scripts/native-compile-ci.test.py
```

- [x] Fixed numeric-drop launcher executes only `sudo -n /usr/bin/true` for
  this probe; the root supervisor owns command registration, deadline and reap.
- [x] Normal refusal 1 is distinct from launch failure 111. Success, signals,
  other exit codes, timeout and unexpected return from exec fail closed.
- [x] No probe capture pipes or nested unprivileged timeout are involved.
- [x] Timeout regression signals only its own spawned fixture process group;
  tests do not invoke sudo, change identities or enumerate/kill a host UID.
- [ ] Establish supported exclusive task-UID/domain/service ownership and
  teardown/no-respawn proof before PF restoration; keep absence failures closed.
- [ ] Establish usable task-owned IPv6 positive controls, actual policy traversal
  and exact denial counters plus restoration-positive evidence. An unreachable
  public IPv6 route is not denial proof.
- [ ] Independently admit a new immutable H1/helper and H2/workflow pin pair
  before any authorized hosted preflight; existing pins intentionally stay put.
- [ ] Retain full unsigned Mac/iOS build and signed installed-provider acceptance
  as separate gates. Unit tests are not runtime security acceptance.
