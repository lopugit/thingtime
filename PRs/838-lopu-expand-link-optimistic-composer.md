# PR #838 — Optimistic Lopu composer and expand links

The sent-media tray could remain populated throughout a reply. The server acceptance callback compared the entire uploader imperative handle, but that handle changes when `disabled` changes its `addFiles` closure. Sending therefore invalidated its own cleanup guard. The corrected guard uses the mount-stable `markCommitted` identity, preserving account/remount fencing.

Submission now collapses the tray and selected Thing chips immediately while retaining the mounted upload state until acceptance. Acceptance marks attachments committed before resetting the uploader. Pre-acceptance rejection restores the selection and preserves newer typed text. Upload blocking applies to Send and keyboard submission rather than the text field.

The floating expand icon is a native anchor to the existing chat/voice destination. Normal navigation retains its prior action; modified clicks and middle-click preserve browser tab/window behavior.

## Verification

- Full mounted chat/uploader/store/background-task browser regression: typing during held upload; Send and Enter blocked; immediate tray collapse; accepted files removed before reply completion; no committed-file deletion; rejected files restored without overwriting newer text; successful retry.
- Negative controls: restoring the old input rule fails the typing assertion; restoring the old handle comparison leaves the accepted file in the uploader and fails the cleanup assertion.
- Browser checks at desktop and 390px mobile. Cmd-click, middle-click and Shift-click open separately; normal click/keyboard Enter navigate in place. Voice mode keeps `/lopu/voice`.
- Local: http://localhost:19800. Tailscale/Funnel unavailable: the launcher references a missing app bundle.
- Synthetic transport proves UI lifecycle; production acceptance is checked separately after merge. No fixture messages are sent to a real provider.
