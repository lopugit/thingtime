# Automatic native activation — partial acceptance

Source baseline: `7814f1c565d93a812fecc71bd1cddf282bd17e5b`.
The isolated remote-mode development app fetched and staged a signed synthetic
release through the canonical release API and actual downloader after baseline
startup: **1,823 files / 269,829,305 bytes**. Independent signature and full cached
payload verification passed. The task used its own profile, API and signing
fixture; the stable app and baseline QA workspace were untouched.

**Automatic replacement and durable post-restart readback remain unverified.**
Attempt 3 stopped at native window lookup before background testing. The final
verifier now preserves the tool's JSON diagnostic and targets the exact task
bundle ID; this correction has not been rerun. All owned running processes and
listeners were cleaned up. The stopped task-only workspace remains available.

- [Attempt 3 outcome](7814f1c56/attempt-3/verification.json)
- [Source, signature and payload evidence](7814f1c56/attempt-3/source-and-evidence.json)
- [Actual dirty editor](7814f1c56/attempt-3/dirty-editor.png)

Earlier failure receipts are retained. No manual restart is presented as an
automatic update, and successful staging is not production-release acceptance.

## Later b5b70e0c8 checkpoint

The exact bundle lookup succeeded, but native minimize returned an AX timeout.
The verifier now checks actual task-page focus/visibility and unchanged native
process identity before deciding whether an uncertain action took effect; it
does not repeat minimize. Its final bounded attempt stopped before app launch
on a concurrent gateway source syntax error. That source error was repaired
separately; this native recovery path has not been exercised. Cleanup found no
remaining task claim or renderer/inspector listeners.

[Final attempt and source hashes](b5b70e0c8/final-recovery/source-and-evidence.json).
