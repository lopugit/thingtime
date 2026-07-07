# PR #35 - Add Mongo-backed SES email delivery (branch `codex/email-ses-mongodb`)

## What changed

This branch replaces the auth email logging stub with a Mongo-backed email
delivery service under `remix/app/api/utils/email/`.

- `console` remains the safe default provider for local/dev.
- `THINGTIME_EMAIL_PROVIDER=ses` enables Amazon SES API delivery.
- Auth verification, email OTP, and newsletter helpers route through the shared
  service.
- Mongo collections record messages, events, templates, subscriptions,
  suppressions, unsubscribes, and sender identities.
- README setup docs cover local/Vercel SES env vars and DNS/domain guidance.

## Owned email roadmap

The branch also adds `docs/email-owned-architecture.md` as the future source of
truth for moving from SES to provider-independent email ownership.

The roadmap keeps SES as Phase 0 and scopes later work around:

- durable outbox queue and delivery worker
- provider adapter interface
- SES/SNS event ingestion
- bounce, complaint, unsubscribe, and suppression processing
- app-owned inbound email
- eventual Thingtime-operated SMTP relay hosts on stable IPs
- per-stream sender reputation, warmup, throttling, and fallback controls

## Validation

- `git diff --check`
- targeted TypeScript check for changed email/Mongo files: no changed-file
  errors; full project typecheck still has unrelated existing failures
- `corepack pnpm --dir remix run build`
- `graphify update .`
- `GRAPHIFY_VIZ_NODE_LIMIT=1000000 graphify export html`

## Notes

Self-hosted SMTP is intentionally documented as a later relay/data-plane phase,
not as an edge-function MTA. Edge/serverless endpoints are useful for control
plane APIs, provider webhooks, tracking, and unsubscribe flows, while outbound
SMTP needs stable IPs, reverse DNS, durable queues, and reputation monitoring.
