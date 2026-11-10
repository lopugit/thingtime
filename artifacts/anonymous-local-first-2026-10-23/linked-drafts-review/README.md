# Linked draft media verification

The focused `drafts.test.ts`, `accountDrafts.test.ts` and new `linkedDrafts.test.ts` run passes 22 tests with zero failures or skips. These are Node tests with fake IndexedDB; no native/deployed acceptance is inferred.

The three new cases cover mixed URL/byte draft binding and cold reopen; independent template/recovery IDs and remapped layouts; unbound-only expiry; account request/queue independence and atomic rollback; foreign-account refusal; and exact URL metadata recheck before copying. A throwing global fetch confirms the local mixed-media lifecycle never downloads URL content.

Changed-file ESLint completes with no errors and the existing `LocalDrafts` parameter-property constructor warning (`no-useless-constructor`), plus the repository config deprecation notice. Final integrated typecheck/build/native coverage is coordinator-owned.
