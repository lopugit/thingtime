# Thingtime Owned Email Architecture TODO

Status: roadmap scaffold. Amazon SES remains the current production sender,
but all app code should keep moving toward a provider-independent email control
plane owned by Thingtime.

## Goal

Own the email lifecycle end to end:

- generate, authorize, queue, render, send, retry, and audit every message
- store outbound and inbound metadata in MongoDB
- preserve raw MIME safely when needed
- process bounces, complaints, delivery status, unsubscribes, and suppressions
- move between SES, another provider, or Thingtime-operated mail transfer
  agents without changing auth/signup/newsletter callers

The reason is provider independence and account-risk isolation, not bypassing
consent, suppression, abuse controls, unsubscribe requirements, or mailbox
provider deliverability rules.

## Current State

Implemented in this branch:

- `remix/app/api/utils/email/` is the app boundary for email delivery.
- The default provider is `console`, which records messages without delivery.
- `THINGTIME_EMAIL_PROVIDER=ses` sends through Amazon SES API.
- MongoDB records outbound messages, events, templates, subscriptions,
  suppressions, unsubscribes, and sender identities.
- Auth verification, email OTP, and newsletter helpers call the shared service
  instead of sending directly.

Keep this shape. Future self-hosted SMTP work should add provider/worker
adapters behind this boundary instead of letting route handlers or UI code talk
to SMTP, SES, or Mongo collections directly.

## Target Architecture

```text
Thingtime routes/features
  -> email service API
    -> policy and consent checks
    -> template renderer
    -> Mongo outbox queue
    -> delivery worker
      -> provider adapter: SES today
      -> provider adapter: owned SMTP relay later
    -> event ingestion
    -> suppression/reputation updates

Inbound/reply mail
  -> inbound MX / SMTP receiver
  -> MIME parser
  -> Mongo metadata + raw message storage
  -> thread/linking jobs
```

### Control Plane

The Remix/Nitro app owns:

- public feature APIs that request email
- stream selection: transactional, notification, newsletter, system
- authorization: which app actor may send which stream
- consent checks, unsubscribe checks, and suppression checks
- idempotency keys for verification/OTP/password-reset/newsletter messages
- template versioning and rendering
- message/event records in MongoDB
- admin views and operational controls

### Data Plane

The delivery data plane should be swappable:

- Phase 0: SES API adapter
- Phase 1: SES plus durable outbox worker and SES/SNS event ingestion
- Phase 2: owned inbound receiver for replies and app-managed aliases
- Phase 3: owned outbound SMTP relay canary for low-risk transactional mail
- Phase 4: owned relay fleet with SES fallback and per-stream routing

SMTP delivery should run on stable IP hosts with reverse DNS/PTR, persistent
queues, TLS, DKIM signing, feedback-loop processing, rate controls, and
blocklist monitoring. Edge functions can host control-plane endpoints such as
unsubscribe, click/open tracking, provider webhooks, and admin APIs, but they
should not be the primary SMTP MTA because SMTP reputation depends on stable IPs
and durable retry queues.

## Mongo Collections

Existing collections:

- `email_messages`: canonical message/outbox record
- `email_events`: delivery, bounce, complaint, reject, open/click, unsubscribe
- `email_templates`: template metadata and version pointers
- `email_subscriptions`: newsletter/list consent state
- `email_suppression_list`: global and stream-specific do-not-send records
- `email_unsubscribes`: unsubscribe proofs and list membership exits
- `email_identities`: verified domains, addresses, DKIM, MAIL FROM, SPF/DMARC

TODO collections when moving beyond SES:

- `email_delivery_attempts`: every provider/MTA attempt, retry, and response
- `email_outbox_locks`: worker leasing and retry ownership if not embedded in
  `email_messages`
- `email_inbound_messages`: parsed inbound/reply metadata and routing state
- `email_raw_mime`: GridFS bucket or object-storage references for large raw
  inbound/outbound MIME blobs
- `email_mta_nodes`: owned relay health, IPs, capabilities, and stream routing
- `email_reputation_snapshots`: bounce/complaint/spam-rate metrics by domain,
  IP, stream, and mailbox provider
- `email_dns_checks`: expected DKIM/SPF/DMARC/MTA-STS/TLS-RPT records and last
  verification result

Raw MIME can become large. Prefer Mongo metadata plus GridFS or object storage
references for full raw messages; keep the app query path on metadata.

## Provider Adapter Contract

Add a provider interface before introducing another sender:

```ts
type EmailProviderAdapter = {
  name: string;
  send(input: EmailDeliveryInput): Promise<EmailDeliveryResult>;
  normalizeEvent?(event: unknown): Promise<EmailEventRecord[]>;
  healthCheck?(): Promise<EmailProviderHealth>;
};
```

TODO:

- Move SES and console senders into `remix/app/api/utils/email/providers/`.
- Keep `sendEmail()` as the only app-facing API.
- Make provider selection per stream and per identity, not only global env.
- Add an `owned-smtp` adapter only after the outbox worker and attempt logging
  exist.

## Outbox And Worker TODO

SES can send synchronously today, but the owned path needs a durable outbox:

- Insert `email_messages` with `status=queued`.
- Worker leases queued records with a short lock timeout.
- Worker validates suppression/consent again at send time.
- Worker renders final MIME, signs it if the provider requires app-level DKIM,
  and hands it to the selected adapter.
- Worker records `email_delivery_attempts`.
- Worker updates message status to `sent`, `retrying`, `failed`, `skipped`, or
  `suppressed`.
- Worker applies exponential backoff for temporary provider/MTA errors.
- Worker never retries permanent failures, complaints, unsubscribed recipients,
  or active suppressions.

Runtime options:

- Vercel Cron or a protected queue-drain API for early production.
- PM2 worker for local/dev and dedicated server deployments.
- A real queue later if Mongo leasing is not enough.

## Event Ingestion TODO

SES should be the first event source because it is already the sender:

- SES/SNS webhook or EventBridge ingestion endpoint.
- Normalize delivered, bounced, complained, rejected, opened, clicked, and
  unsubscribed events.
- Store every normalized event in `email_events`.
- Join events back to `email_messages` by provider message id and tags.
- Write hard bounces and complaints into `email_suppression_list`.
- Keep newsletter unsubscribes in `email_unsubscribes` and subscription state.
- Add replay protection and signed webhook verification.

Owned SMTP later needs:

- DSN parser for bounce messages.
- ARF complaint parser for feedback-loop reports.
- Postmaster/reputation metric importers where available.

## Inbound Email TODO

Keep Google Workspace for human inboxes. Add app-owned inbound on subdomains:

- `inbound.thingtime.com` for app-managed replies and aliases
- `bounce.thingtime.com` or per-stream bounce domains for return-path handling

Inbound receiver responsibilities:

- accept only configured domains/aliases
- parse MIME and attachments safely
- store metadata in MongoDB
- store large raw MIME/attachments outside hot query paths
- link replies to users, message ids, and app threads
- enforce malware/content scanning before surfacing attachments

## Owned SMTP Relay TODO

Recommended relay stack to evaluate:

- OpenSMTPD or Postfix for mature SMTP queueing and delivery
- Rspamd or OpenDKIM for signing/filtering where appropriate
- Haraka only if a JavaScript plugin surface is more valuable than mature MTA
  defaults

Required before first production traffic:

- dedicated static IPs
- reverse DNS/PTR matching the sending hostnames
- DKIM per sending domain/selector
- SPF for MAIL FROM domains
- DMARC policy and aggregate reports
- TLS certificates and STARTTLS
- MTA-STS and TLS-RPT for stricter transport policy
- bounce and complaint processing
- per-domain rate limits and warmup schedules
- queue visibility, dead-letter handling, and emergency pause controls
- blocklist monitoring and mailbox-provider postmaster accounts

Do not put transactional auth mail and newsletters on the same IP/domain until
reputation behavior is proven.

## Streams And Domains

Keep streams isolated:

- Transactional: `auth.thingtime.com`, `security@auth.thingtime.com`
- Notifications: `mail.thingtime.com`, `no-reply@mail.thingtime.com`
- Newsletter: `news.thingtime.com`, `updates@news.thingtime.com`
- Inbound/replies: `inbound.thingtime.com`
- Bounce/return path: per-stream MAIL FROM subdomains

Each stream needs independent:

- From identity
- DKIM selector/domain
- MAIL FROM domain
- suppression and unsubscribe policy
- rate limits
- reputation metrics
- fallback provider routing

## Admin And Safety TODO

Build an admin-only email console before scaling volume:

- message search by user, recipient, stream, template, and provider id
- resend controls with authorization and idempotency protection
- domain identity/DNS status
- queue depth, retry, failure, bounce, and complaint dashboards
- stream pause/resume switches
- emergency global sending pause
- suppression-list management
- exportable audit trails

Newsletter sends must require:

- explicit opt-in source
- unsubscribe link
- one-click unsubscribe headers where required
- suppression and bounce checks
- rate limits
- canary send and staged rollout

## Milestone Checklist

### Phase 0 - SES Bridge

- [x] Mongo-backed `sendEmail()` boundary
- [x] Console provider for local/dev
- [x] SES API provider
- [x] Verification, OTP, and newsletter helper functions
- [x] Fork-safe README setup docs
- [ ] SES event ingestion endpoint
- [ ] Webhook signature/replay protection
- [ ] Bounce/complaint suppression updates

### Phase 1 - Durable Outbox

- [ ] Provider adapter interface
- [ ] `email_delivery_attempts`
- [ ] Worker leasing and retry state
- [ ] Backoff and permanent-failure classification
- [ ] Admin pause/resume controls
- [ ] Per-stream provider routing config

### Phase 2 - Inbound Ownership

- [ ] App-managed inbound subdomain
- [ ] Inbound MX receiver/provider
- [ ] MIME parser and raw-message storage
- [ ] Reply/thread linking
- [ ] Attachment safety policy

### Phase 3 - Owned Outbound Canary

- [ ] Dedicated relay host and static IP
- [ ] PTR, SPF, DKIM, DMARC, TLS, MTA-STS, TLS-RPT
- [ ] MTA queue monitoring
- [ ] DSN/ARF processing
- [ ] Postmaster accounts and blocklist monitoring
- [ ] Low-volume transactional canary
- [ ] SES fallback for auth-critical flows

### Phase 4 - Provider-Independent Operation

- [ ] Per-stream routing across SES and owned relay
- [ ] Automatic fallback on provider outage or degraded reputation
- [ ] Warmup automation
- [ ] Reputation-aware throttling
- [ ] Multi-relay fleet config
- [ ] Disaster recovery docs

## Definition Of Done For "Owned Email"

Thingtime owns email end to end when:

- app features never call a provider directly
- every send has a Mongo audit trail and idempotency key where appropriate
- every delivery attempt and provider/MTA event is normalized
- bounces, complaints, unsubscribes, and suppressions affect future sends
- transactional mail remains isolated from newsletter reputation
- inbound replies can be accepted and stored under Thingtime-controlled domains
- at least one owned relay can send low-risk mail with SES fallback still
  available
- operational dashboards expose queue depth, delivery, bounce, complaint,
  unsubscribe, suppression, and reputation state
- DNS, relay, warmup, fallback, and incident procedures are documented
