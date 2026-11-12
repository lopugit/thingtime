# Password/authenticator merge acceptance — 12 November 2026

Merged controls preserve the device/account session label and conditional local **Lock vault** action alongside imported individually editable authenticator setup blocks. `PasswordManager.tsx` was reviewed and left unchanged. Only `PasswordWorkspaceControls.tsx` was resolved in production source.

The imported test runner was repaired with the same real `platformRuntimePlugin` used by the existing password-editor fixture; it serves the actual branding asset and advertises the combined password contract 1.10.0. Its account subtree follows the existing direct `PasswordManagerScope` fixture with explicit root binding, avoiding unrelated global background workers. The anonymous variant renders the full normal PasswordManager/device gate and actual encrypted LocalPasswordVault.

## Results

- Authenticator client/native units: 10 passed.
- Existing local vault/files/sync units: 42 passed.
- Actual rendered synthetic browser cases: account setup and anonymous vault, each at 1440 and 390 pixels; all four passed.
- Scoped lint: zero errors/warnings; runner syntax check passed.

See `verification.json` for exact commands, source hashes and temporary log references; `receipt.json` lists browser checks. Parent `../combined-checks.json` holds merged app type/ratchet/full-lint and imported sync evidence; it is not duplicated here.

Account checks cover explicit review, masked setup, no automatic save, warm cancellation preserving the draft, an explicit synthetic saved-code write, editable nested setup blocks and top/bottom overflow. Anonymous checks cover actual device-vault creation, the device-only session label, editable session/Lock labels, an actual Lock transition and no account setup notice. The native bridge mock answers only its declared synthetic owner; anonymous `local-workspace` messages are explicitly ignored. Contexts and browsers are task owned and cleaned up.

Screenshots were inspected. The existing verification-preference component still attempts account-scoped settings calls in anonymous mode and shows the fixture's wrong-owner error; this is retained as an offline settings limitation, separate from the merged toolbar and setup acceptance. TOTP does **not** use the passkey-only `nativeAvailable` flag. Its boundary remains owner/home-plane/nonce/current document plus explicit review, configured state and user activation.

No real account/API writes, saved credentials, native authenticator ceremony, installed-app update or 320-pixel acceptance are claimed. Retained `desktop-failure.*` files record the resolved fixture bootstrap issue, not an unresolved product regression.
