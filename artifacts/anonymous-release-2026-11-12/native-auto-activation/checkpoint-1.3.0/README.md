# Native activation 1.3 diagnostic run

Actual isolated remote-publication native run on source 40c57f919 plus the recorded 1.3 changes. Uncontended build exited 0; all 4,849 recorded build/runtime inputs remained stable. Build log SHA-256: 76f1237ecd190606562f36411d8cf771086e5ac7e013926edea885b0b6d7f8a0 (raw log retained privately outside this artifact).

Download/staging, 70-second dirty-input refusal, normal Enter submission, canonical persistence acknowledgement and reload passed. Automatic process replacement failed. The real renderer sent ready:true, then cancel-pagehide 6ms later while native close was pending. This does not establish the final native shutdown failure cause: no close/veto/relaunch milestones were captured. Later CDP reported a detached frame.

verification.json is the immutable original failure receipt (SHA-256 759125b78d043d4dd942462c05426329db787fb84f754d71c0b001634bfac525); cleanupVerified:true. The stable app and personal data were untouched. No local-account API or positive automatic replacement acceptance is claimed.
