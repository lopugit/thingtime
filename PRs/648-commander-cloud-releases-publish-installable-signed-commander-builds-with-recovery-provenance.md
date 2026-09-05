# Commander GitHub releases and Recovery

Product PR #648 and controller PR #647 repair the existing Commander release
workflow. Main pushes and owner dispatches resolve an immutable main commit;
source checks precede credential import; Developer ID and notarization are
mandatory. Commander and matching Recovery ZIPs use the catalog asset prefixes,
are verified after extraction, and ship with portable SHA-256 checksums.
Commander publication preserves Electron's repository-wide latest release.

Commander builds retain their numeric build, release tag and full commit/branch
in signed bundle metadata. Recovery reads this provenance offline. Preparation
and packaging leave the installed app alone, while installation stops its runtime
only after successful signing/notarization.

## Verification

- Local source checks: 171 TypeScript, 62 Rust, 27 Commander Swift and 23 Recovery
  tests passed, with typechecks and release compilation.
- Controller caller/credential/publication checks and actionlint passed. Both
  original PRs merged after their CI/security checks completed.
- GitHub run 33956918885 built main commit 90f64de9552159c18816a48e660a65dbaa943826.
  Apple accepted notarization submission 64cc603c-13b1-4cf1-b56e-1e5c962c5ce5 and
  stapling passed. The subsequent lipo command used the wrong argument order,
  so the workflow correctly stopped before publishing any release.
- The follow-up puts the Mach-O input before `-verify_arch` and executes both
  actual verifier commands against a native macOS fixture. The final signed
  release will be checked through GitHub download and Recovery installation.

Cloud releases currently target Apple silicon. The Developer ID requirement
replaces an older local Apple Development requirement; macOS privacy grants may
need a user-managed migration. No permission toggles or grants are changed by
Recovery. The old app is preserved by its atomic installer.
