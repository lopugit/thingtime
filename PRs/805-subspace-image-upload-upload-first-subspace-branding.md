# PR #805: Upload-first subspace branding

Subspace settings reuse the shared profile-media control for icon and banner images, with upload, previews, removal, retry and optional “Use URL instead”. Existing external URLs remain supported. Upload approval and quota rules are preserved.

Managed branding uses distinct icon/banner purposes and current-slot authorization. Binding and settings updates share the accounted transaction; replacement and subspace deletion release old bindings through existing attachment cleanup. Client requirements negotiate the upload, update and content contracts before dependent actions. Embedded subspace icons include the managed attachment reference.

The repository-local AI_ALL.md standardizes upload-first controls for configurable images and files, with URL entry as an optional fallback.

Validation: subspace, attachment and capability tests; Vercel production output build; built-server capability response; desktop and mobile URL validation, saving, reload persistence, independent removal and expanded controls. Real storage upload was not exercised because the local browser account lacks upload approval. Full typecheck retains unrelated baseline failures; graph extraction reports unrelated macOS node-name collisions.

PR: https://github.com/lopugit/thingtime/pull/805
