# Technical Next Steps

Near-term technical work that supports the larger vision without overbuilding.

## Foundations

- Finish the hydration cleanup in `TODO.md`.
- Add canonical `APP_URL` / allowed-host verification link generation.
- Remove HS256 fallback after the migration window.
- Add token introspection for external platforms.
- Replace Vercel polling with webhooks plus a cached deployment status store.

## Data model

- Define a minimal thing envelope:
  - id
  - owner
  - visibility
  - type/template
  - data
  - created/updated
  - provenance
  - signatures
  - permissions
- Keep raw thing data flexible, but make the envelope strict.
- Add event records before adding complex collaboration.

## APIs

- Add read/write endpoints around thing envelopes.
- Add typed template validation through the API layer.
- Add export endpoints early: JSON, signed JSON, and maybe static HTML.
- Add capability-scoped bearer tokens for apps/agents.

## UI

- Build one excellent thing inspector.
- Build one excellent thing editor.
- Build one excellent share dialog.
- Build one excellent provenance/audit panel.

## Security posture

- Treat every public thing as potentially adversarial content.
- Keep auth/session revocation server-checked.
- Add rate limits to expensive endpoints by default.
- Add audit logs for permission and ownership changes.
- Make "what can this app do?" visible before app installation.
