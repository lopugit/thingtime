# Password search, loading and AWS sign-in correction

The observed root AWS credential is saved for the AWS home origin while its
login form uses the separate AWS sign-in origin. Imported console and portal
credentials share that sign-in destination. The catalog originally compared
only exact hostnames. The extension also gave a complete paginated catalog the
same 2.5-second timeout as a small account roster, and it never refreshed an
already populated chooser. These conditions omitted valid accounts and left
search looking stalled.

Extension 0.4.3 keeps one accessible inline progress indicator, separates
account and target generations, cancels stale work, and preserves search and
same-account content through background refresh. The workspace searches the
complete catalog; the in-page chooser searches accounts approved for the
current origin. No extension permissions are added.

The API's 1.8.0 correction shares one finite directional mapping from the
HTTPS AWS home, console and portal origins to the exact HTTPS AWS sign-in
origin. It does not enable wildcard sibling matching, Amazon retail matching,
arbitrary AWS-hosted content, alternate ports or cross-account disclosure.
Protected fill still checks live account, chosen entry, origin and approval.

Password cards now focus and scroll their editor into view after successful
read, and Close restores the originating control. Preview and fill identifiers
come only from explicit login fields; concealed, structured, descriptive and
hidden imported form fields are excluded. Legitimate saved non-email usernames
remain unchanged. Existing editable card layouts remain editable.

The canonical global loading rule and repository AI_ALL.md now require one
inline indicator, retained same-identity content, reduced-motion support and a
single actionable failure state. The global aliases passed sync-ai-all --check.

## Evidence

- Native read-only inspection in the assigned Chrome profile confirmed the
  root AWS Website mismatch and that one reported portal subtitle is its actual
  saved username. No passwords were read or changed; the task tab was closed.
- Isolated Chrome catalog tests cover a 64-entry list, slow refresh, search,
  paging, coalescing, error/retry and lock cancellation at desktop/mobile sizes.
- Isolated Chrome chooser fixtures cover later-page AWS matches, exact origin
  exclusions, responsive search and synthetic filling without submission.
- Disposable API and isolated Chrome checks cover username projection,
  protected fill, card/editor focus, Close focus restoration and editable
  Builder layouts. The actual disposable API/Chrome verification passed;
  fixtures do not prove real-account fill.
- 78 extension unit tests, 156 focused web tests (one opt-in skip), 133
  capability checks and five transient-action tests passed. Typecheck and the
  zero-error ratchet passed; full lint reported zero errors and 411 warnings.
  Deployment and installed-profile acceptance are separate release checks.
