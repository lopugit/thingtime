# Instrumented native paste baseline — 27 October 2026

Current source checkpoint 99448760f5b49638a9979a81eda55805e994b709, unchanged product instructions. The current package's LopuPromptSettings source map exactly matches source (source-provenance.json). The audio-search application archive was repacked with the current instrumented test; application bytes were not modified. Exact archive/test hashes and final runtime state are in observer-state.json.

Both native tests passed, zero failures/skips (run.log). Exact 12,002-line Control+V took **2,194 ms**, preserving the unchanged under-5,000-ms gate, native undo/redo, subsequent normal typing, offline save/cold reload, lost-reply reconciliation and both explicit conflict choices. Full verification and desktop/390px/320px evidence are in instructions/verification.json and adjacent PNGs.

The paste event occurred at 11 ms, beforeinput at 12.1 ms, input at 2,076.9 ms and the first frame at 2,098.7 ms; one 2,072-ms long task was observed. This local passing run does not establish the cause of earlier 6,665/9,114-ms failures or an installed macOS result. No product fix was made. A prepared matched-control was not executed because the failure did not reproduce.

Browser and backend network-none/direct-IP/redirect checks passed; Chromium sandbox was enabled. No OOM was recorded; owned runtime cleanup passed with no remaining container. No live handles remain. Shared proxy, VM configuration, production and real accounts were untouched.

The first diagnostic attempt stopped before test execution because the test bundle was placed in the wrong host staging path; its separate cleanup record is retained in the sibling paste-diagnostic folder. The corrected run used an absolute output path.

[CI and preview HTTP record](ci-preview-checkpoint.json) belongs to the pushed product checkpoint `99448760f`, before subsequent fixture/document edits. Web CI and CodeQL passed; both preview origins served the shell, manifest and matching boot/main assets. Source association comes from GitHub deployment metadata, with no in-page commit marker. Deployed functional acceptance remains separate.
