# PR #1484: Preserve a newer signed AutoFill companion

The installer may preserve an installed standalone Passwords companion only
when its host and provider have verified signatures, matching identity and
provisioning evidence, and a same-major version and build that are both newer
than the nested companion. The preserved app is excluded from staging,
replacement, rollback, quit checks, and re-registration. Equal or older
verified companions follow the existing clean-quit replacement path.

## Review correction

An automated review changed an unverified installed companion to the
replacement path. That could replace an idle 1.0.10/build 11 companion with a
1.0.8/build 9 nested companion when its signing evidence differed or its
profile/version could not be read. Neither a failed read nor a mismatched
identity proves that downgrading is safe. The installer now stops before
staging in those cases and emits one fixed diagnostic without the verifier's
raw error text. A known expired profile remains a bounded installation
blocker until a separate signed version and identity proof supports a safe
replacement; this PR does not infer such proof from a catch block.

## Verification and acceptance boundary

`node --test electron/test/install-local-app.test.cjs` passes 25 focused tests,
including idle newer identity mismatch, unreadable facts, unknown version,
running unverified companion, preserved newer app, verified equal/older
replacement, and rollback after a staged replacement fails. The signed local
installation of the earlier 3b0cc751 build succeeded through the normal
equal-version quit path, and the original Downloads job resumed. The corrected
source has not yet been signed or installed; a later local install must verify
the actual signed provider and runtime `native.passwords` capability.
