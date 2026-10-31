# Final integrated instructions acceptance

The normal native Settings fixture passed again on package
`2f0710ac20e67675e56271dd5607a7a32c2e038853e40ebd62dbf40c9e310e59`:
1 test, zero skips, 91.8 seconds. The fixture now clicks the visible checkbox
label through normal UI. [Report](integrated-final/verification.json),
[log](integrated-final/browser.log), [build](integrated-final/build.json),
and [isolation](integrated-final/isolation.json) are retained with all three PNGs.
The same offline/reload, lost-response/newer-intent, both conflict choices and
guest-boundary checks pass. Earlier package evidence follows.

# Account instructions — native acceptance

One test passed with zero skips in 88.77 seconds on immutable application
`e7427480e802ad274df4f1167443702e7e9534f2f05bc340a79691b513e9970c`.
The normal account settings UI saved exact Unicode and a disabled instruction
offline, then retained both after a cold reload at 1440, 390 and 320px.

On reconnect the real server committed the first save while its response was
held. A newer device edit saved before that response was released as a 503.
The worker read the existing receipt, avoided replaying the acknowledged write,
and then synchronized the newer edit. Separate account edits produced real
conflicts; both **Use saved device version** and **Use account version** preserved
the reviewed content. The second choice sent no additional mutation.

- [Verification](verification.json), [browser log](browser.log)
- [Build fingerprint](build.json), [enforced isolation](isolation-verification.json)
- [Desktop](instructions-offline-1440.png), [390px](instructions-offline-390.png), [320px](instructions-offline-320.png)

The identity and database were created only in the disposable namespace.
Anonymous reads returned no personal instructions; anonymous writes returned
401. There were no page errors or offline mutation requests. The fixture uses
Chromium's normal secure-loopback cookies and explicit CDP connectivity signals;
both browser and backend external networking remain denied.

This does not verify AI inference, the installed macOS application, larger
remote instruction transport, CI, or deployed behavior. No real account data
was used. Test source: `remix/app/local-workspace/accountLopuInstructions.browser.test.ts`.
