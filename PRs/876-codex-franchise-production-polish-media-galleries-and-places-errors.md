# PR #876 — Franchise production verification fixes

Production verification after #871 exposed two defects: the generic comment
list omitted attachment metadata, and a Google Places error became a gateway
HTML page which the workspace tried to parse as JSON.

First-party target comment lists now return attachment metadata in one batch
query after authorization. The projection enforces ready state, moderation,
owner and comment-purpose binding; app namespaces and custom databases remain
excluded. The upload composer clears committed batches without deleting them.

Places requests read bounded responses and translate only allowlisted provider
reason codes into setup guidance. Free-form provider messages, project details
and credentials are never returned. Configuration errors use 409; quota uses
429, invalid lookups 422, and transient provider failures 502. The client handles
HTML gateway errors with a safe retry message. Contracts are api.things 1.24.0
and api.builder-workspaces 1.0.1.

Validation includes five provider/client tests, capability manifest and
compatibility tests, Things tests, production build/output verification, and
the isolated service workspace integration smoke. The smoke verifies visible
media, blocked/wrong-owner exclusion, role boundaries, and revocation. Main
was integrated after the #874 promotion; generated graphs were regenerated.

Production cutover preserved a private legacy HQ backup, copied existing
customers and their property links, and kept the HQ URL. Real Maps rendering,
upload acceptance, record creation, scheduling, customer links, crew context,
calculated time logs and mobile Vault controls were verified. Gallery reload
and actionable Places guidance require this follow-up deployment verification.

Local web: http://localhost:18940. Tailscale/Funnel unavailable because its
installed launcher points to a missing Tailscale.app executable.

Production QA also caught future-dated completed visits in Upcoming visits. The dashboard now excludes completed visits while the planner and property history retain them.
