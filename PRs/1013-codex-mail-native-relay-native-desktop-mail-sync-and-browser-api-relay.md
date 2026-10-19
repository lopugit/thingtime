# PR #1013 — Native desktop mail sync and browser API relay

A browser can now sync through `POST /api/v1/mail/sync` without a separately
installed connector or persistent cloud mail account. The account explicitly
chooses API relay; credentials and messages transit the selected Thingtime
server in memory, then the batch is retained in the encrypted device cache.
Cloud storage remains an independent option. Existing accounts keep connector
mode until changed, and native errors never trigger cloud fallback.

Electron packages the canonical Node provider in a self-contained bundle. Its
versioned IPC bridge accepts only the trusted top-level page, caps concurrent
requests, bounds request size, and cancels on navigation, renderer destruction,
explicit cancellation and app shutdown. The UI presents safe errors. The desktop
shell permits private API traffic only through its pinned HTTPS endpoint and
same-origin loopback boundary; ordinary deployment fallback remains refused.

iOS adds Mail to the native destination drawer and uses the shared WebView relay
and encrypted device store. It does not claim direct iOS IMAP/POP3 sockets,
background receiving or mail in standalone Watch/Widget apps. Other web-based
native hosts can consume the same versioned API without a desktop dependency.

Validation completed during implementation:

- Mail model/storage/auth/relay/native client regressions, Electron bridge and
  full Electron tests, settings and capability suites passed.
- Synthetic real TLS IMAP/POP3/STLS integration passed, including read-only
  commands and downgrade refusal. No actual mail account credentials were used.
- Real HTTP relay returned a POP3 discovery batch with current session/owner;
  wrong origin, wrong owner and non-relay mode were rejected. Cloud account
  readback was unchanged. This was DNS-only discovery, not provider login.
- Real replica-backed mail storage checks passed, including repeated sync,
  ownership and a controlled sync/delete race.
- Live browser settings checked at desktop and 390-pixel mobile width. Existing
  account modes stayed unchanged; new browser accounts select relay and display
  the credential-transit disclosure. Add/Edit opens its form immediately.
- Isolated Electron dev app signed into the disposable local test account,
  selected direct sync by default and exercised the bundled native bridge with
  a synthetic non-resolving hostname. No pairing was needed. Negative connection
  smoke does not establish real provider acceptance.
- XcodeGen iOS simulator build passed, with built Info.plist confirming the
  explicit local test URL. Native installation/launch and signed desktop build
  completion are recorded in the PR description after final checks.

The branch starts from the already merged #1009 main foundation. The main to
 develop sync PR may need to land before the comparison isolates this follow-up.
No production merge or TestFlight upload is part of this follow-up delivery.
