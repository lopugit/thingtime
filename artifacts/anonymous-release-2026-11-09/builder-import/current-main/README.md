# Current merged build · global and site Builder

The combined test passed against the full compiled working tree after merging
main `f36da5c032251270c0b24a754c61a4e510633c59` into the anonymous feature
checkout and building the hosted adapter. The [build proof](source-proof.json)
records the merge inputs, relevant working-source hashes and a manifest of 1,765
compiled files. The server entry and changed static shell match their
[in-container hashes](container-build-hashes.txt).

Both the global and `/ode` Builder documents retained separately edited nested
text, button and icon blocks through two offline document loads per scope.
The Inspector and composed page passed focus, keyboard, hit-target, overflow
and scroll checks at 1440, 390 and 320 px. There were zero authenticated requests,
API mutations, protected Builder reads and page errors. The app used a fresh
sandboxed Chromium context, a private replica and an actual fixture HTTP
transport interruption. This covers the existing global/site workflow with the
current root provider mounted. [Verification](site/verification.json) ·
[Test log](site/test.log) · [Boundary](boundary.json) · [Cleanup](cleanup.json)

The canonical agent browser image was not rebuilt. The test-only derivative
used the verified compiled Linux bcrypt 6.0.0 prebuild as before and was removed
along with the runtime and private state. A preflight packaging attempt stopped
before browser launch because the copied native package was unreadable under
the private staging umask. The task corrected the copy's read permissions
inside its private parent and then ran the browser fixture once.

The importer retained its earlier exact-build evidence. This run did not
reproduce or investigate the prior intermittent offline `/things` navigation
failure. [Earlier evidence](../README.md)
