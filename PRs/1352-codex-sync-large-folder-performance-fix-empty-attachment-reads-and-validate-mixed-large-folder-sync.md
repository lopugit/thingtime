# PR 1352 — empty attachment reads and mixed large-folder sync proof

## Cause and correction

The authenticated `cache=bytes` route treated a successful storage GET with a null body as an upstream failure. Local object storage legitimately returns that response for a zero-byte object. The route now accepts empty bytes only after the storage GET succeeds and a same-viewer fingerprint check matches the exact version, zero size, part count, and canonical empty checksum. Missing backing objects, wrong versions/checksums/lengths, unexpected bytes, and nonempty null streams remain errors. The combined capability is `api.attachment-content` 1.17.2: main had already used 1.17.1 for Builder provenance.

## Bounded isolated proof

`npm --prefix remix run test:files:mac-paged -- --wide --wide-mixed` passed once from the task branch on 2026-11-05. The runner built and checked the source Rust indexer before creating disposable data. Its temporary HTTP API, Mongo replica, native fixture, index DB and object store were isolated; ports 28311/28312 and the temp root were cleaned. It did not touch the installed app, personal folders, user sync settings, or production storage.

The test covered 10,001 API-imported sibling folders, six nested folders, and 26 files: 24 mixed native files plus one baseline file in each direction. All 10,033 paths reached exact local and cloud checkpoints; every file had matching hashes, including zero bytes. Deliberate lost cloud, stage and publication replies plus native/journal restarts retained operation IDs. Recovery uploaded the 18 remaining nonempty nested files once, without replaying acknowledged uploads. The unchanged rerun added no PUT, publish, native read, stream or stage-range operations. There were 316 native and 316 cloud inventory pages, 21 total PUTs and no cooldown.

Synthetic fixture policy was 5,000,000 bytes/s for shared transfer and scan, CPU 15%; Rust received half the scan allocation, 2,500,000 bytes/s. Initial local content was 21,366,403 bytes and converged file content was 23,463,572 bytes. Actual cold and warm hashed-byte counters are unavailable.

## Performance evidence and limits

Setup was 281.4 s; first PUT occurred 109.9 s after sync started. Deliberate phases: lost cloud 133.2 s, lost stage 14.9 s, lost publication 16.0 s, recovery 512.7 s, unchanged rerun 294.3 s. Native scan capture totaled 90.2 s across four calls; 316 native scan-page calls totaled 184.2 s; native reads 141.4 s across 239 calls. HTTP import setup totaled 280.8 s across 41 calls; 123 GET files calls totaled 34.9 s; 21 PUT object calls totaled 35.3 s. These totals mix fixture verification and four intentional recovery attempts with sync work.

Integration process maxRSS was 925,040 KiB. Independent 10-second samples: native fixture maxRSS 42,256 KiB, Rust indexer 16,752 KiB, Nitro Node 423,392 KiB, Mongo 456,880 KiB. These are separate process measurements, not whole-device memory or leak proof. This fixture has only 26 files: it establishes over-10,000-path correctness and recovery, not 10,000 file transfers or optimized throughput. A read-only audit found each native `scan-page` currently starts the Rust helper twice (status then page), a specific follow-up optimization candidate requiring its own bounded proof. No product throughput fix is claimed here.

## Checks and delivery boundaries

Final focused tests after merging current main passed 167/167; TypeScript typecheck passed. Earlier source Rust and Swift fixture builds, Nitro build, and the bounded full run passed. Graphify produced a current structural snapshot; fresh semantic extraction of four changed Markdown files expanded to 127 chunks and was stopped before partial activation. The PR's GitHub checks, Vercel preview/production rollout and signed installed empty-file download remain separate delivery gates. Electron bundles the Nitro server, so this API correction needs a signed desktop update; preserve the running installed app and personal state until its normal lifecycle is safe for replacement.
