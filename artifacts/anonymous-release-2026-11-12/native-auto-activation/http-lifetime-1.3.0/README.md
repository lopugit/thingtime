# Retained-payload HTTP lifetime diagnosis

This isolated native run used the recorded 1.3 web payload, unchanged and canonically verified, with the 6d96 shell plus the recorded internal HTTP diagnostics. It is not final merged-source web acceptance. Seven prepared shell/payload hashes matched. Diagnostic serialization has fixed operation labels/counters only; unknown paths are other, no query/path/header/body is retained, and probe/transport exceptions cannot alter admission.

Focused pre-run tests: 77 passed, 0 failed/skipped. Controlled shipped srvx/H3 adapter probes passed GET, HEAD and disconnected-before-handler-end lifetime release.

Actual signed staging, 70-second dirty-input refusal, normal Enter save, canonical persistence acknowledgement and reload passed. All five HTTP samples were idle (zero requests/sockets), so the prior retained HTTP blocker was not reproduced. The renderer certified ready; native trace reached close-dispatch, close-event, cancel-pending, contents-destroyed and window-closed, but never relaunch-entry. No actual exception text was retained. Automatic replacement failed, cleanupVerified:true.

A subsequent controlled BrowserWindow fixture reproduced cleanup reading a throwing webContents getter after destruction, stopping before relaunch. The narrow correction retains the live WebContents emitter before dispatch; it does not suppress real work or weaken readiness/unload gates. That final correction has 78 passing focused tests but was not part of this actual run. See the separate later acceptance receipt if one is produced.

No manual restart, forced checkpoint, stable-app change, local account API proof or final merged-source acceptance is claimed. Raw development logs remain outside this artifact.
