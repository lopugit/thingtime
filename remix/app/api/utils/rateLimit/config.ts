import { getSettingsCollection } from '../mongodb/collections';
import { NETWORK_PROBE_UPLOAD_REQUESTS } from '../networkProbe';

// Global, admin-editable rate-limit config. The endpoints below are the ones we
// throttle, with their DEFAULT limits; an admin overrides them via the admin
// panel (stored as a singleton `settings` doc, merged over these defaults). The
// merged config is cached briefly so limits are read cheaply per request while
// admin edits still take effect within seconds.

export type RateLimitRule = { limit: number; windowMs: number; enabled: boolean };
export type RateLimitConfig = Record<string, RateLimitRule>;

export const RATE_LIMIT_DEFAULTS: RateLimitConfig = {
  // Private attachment storage: start and completion mutate both S3 and the
  // quota ledger; part-signing is batched (<=20 URLs/request), and reads issue
  // short-lived private redirects. Every surface stays bounded per account/IP.
  'attachments.start': { limit: 30, windowMs: 3_600_000, enabled: true },
  'attachments.parts': { limit: 600, windowMs: 60_000, enabled: true },
  'attachments.complete': { limit: 60, windowMs: 60_000, enabled: true },
  'attachments.delete': { limit: 120, windowMs: 60_000, enabled: true },
  // owner title/description edits (POST /api/v1/attachments/annotate) — small
  // crystal-only writes, same shape as delete
  'attachments.annotate': { limit: 120, windowMs: 60_000, enabled: true },
  // linked-URL media mints (POST /api/v1/attachments/link) — metadata-only
  // thing inserts, no object storage; same shape as annotate/delete
  'attachments.link': { limit: 120, windowMs: 60_000, enabled: true },
  'attachments.read': { limit: 600, windowMs: 60_000, enabled: true },
  // admin-only legacy re-detection sweep; each call is one bounded S3-reading pass
  'attachments.detectionBackfill': { limit: 30, windowMs: 60_000, enabled: true },
  'things.react': { limit: 60, windowMs: 60_000, enabled: true },
  'things.comment': { limit: 20, windowMs: 60_000, enabled: true },
  // library save toggles (POST /api/v1/things/save) — same shape as reactions
  'things.save': { limit: 60, windowMs: 60_000, enabled: true },
  // poll vote toggles (POST /api/v1/things/vote) — same shape as reactions
  'things.vote': { limit: 60, windowMs: 60_000, enabled: true },
  // schema browsing (/api/v1/schemas/browse) — read-only, bounded like search
  'schemas.browse': { limit: 120, windowMs: 60_000, enabled: true },
  // embed SDK reads (GET /api/v1/embed/things) — the only anonymous
  // cross-origin read in the API (Access-Control-Allow-Origin: *), so an
  // unbounded one would be a free amplification/scraping surface off any host
  // page. Bounded like the other public reads; anonymous callers key by IP.
  'embed.read': { limit: 120, windowMs: 60_000, enabled: true },
  // embed SDK writes (POST /api/v1/embed/things) — MAX_THINGS_PER_OWNER bounds
  // how many embeds exist, not how fast they churn; each save costs a count +
  // find + CAS update, so throttle the rate too. Write-shaped like things.write.
  'embed.write': { limit: 60, windowMs: 60_000, enabled: true },
  // component browsing (/api/v1/components/browse) — same read-only shape
  'components.browse': { limit: 120, windowMs: 60_000, enabled: true },
  // webpage resolution (/api/v1/webpages/resolve) — read-only, one page +
  // batched component refs per call; every client navigation may hit it
  'webpages.resolve': { limit: 240, windowMs: 60_000, enabled: true },
  // admin component-library seeding (/api/v1/admin/components/seed) — batch
  // writes; enforced fail-closed at the route
  'components.seed': { limit: 30, windowMs: 60_000, enabled: true },
  // admin site-page seeding (/api/v1/admin/webpages/seed) — deterministic
  // table upserts; enforced fail-closed at the route
  'webpages.seed': { limit: 30, windowMs: 60_000, enabled: true },
  // action execution (POST /api/v1/actions/run) — compute + writes; each run
  // is additionally bounded by its own budget envelope (registry limits)
  'actions.run': { limit: 60, windowMs: 60_000, enabled: true },
  // run-history reads (GET /api/v1/actions/runs) — read-only, browse-shaped
  'actions.runs': { limit: 120, windowMs: 60_000, enabled: true },
  // public theme gallery list (GET /api/v1/themes/shared with no id) — the same
  // anonymous browse shape as schemas.browse; it only ever returns public theme
  // projections, but each call is two indexed reads and up to 60 token docs
  'themes.gallery': { limit: 120, windowMs: 60_000, enabled: true },
  // third-party connections (/api/v1/connections) — reads of stored feed
  // pages and connection lists, bounded like the other authenticated reads
  'connections.read': { limit: 120, windowMs: 60_000, enabled: true },
  // link/unlink/filter writes and OAuth begin — each mints or mutates account
  // linkage, write-shaped like things.write
  'connections.write': { limit: 60, windowMs: 60_000, enabled: true },
  // calls that leave our infrastructure for a provider API (YouTube channel
  // search/resolve, forced feed sync). These spend a SHARED, quota-limited
  // third-party budget — a YouTube Data API search costs 100 of ~10,000 daily
  // units — so one signed-in account must not be able to exhaust the feature
  // for everyone. Deliberately much tighter than the local reads above.
  'connections.provider': { limit: 20, windowMs: 60_000, enabled: true },
  // any other mutating write through /api/v1/things (create/upsert/patch/delete
  // posts and other thing kinds) — reactions/comments route to their own keys
  'things.write': { limit: 60, windowMs: 60_000, enabled: true },
  // structured/text search (/api/v1/things/search) — read-only but query-shaped,
  // so it gets its own generous-but-bounded window (anonymous callers key by IP)
  'things.search': { limit: 120, windowMs: 60_000, enabled: true },
  // public people search (/api/v1/users/search) — bounded like things.search;
  // it only ever returns public profile projections
  'users.search': { limit: 120, windowMs: 60_000, enabled: true },
  // social graph writes: follow toggles are reaction-shaped; friend intents
  // (request/accept/…) are rarer and each can emit a notification, so tighter
  'users.follow': { limit: 30, windowMs: 60_000, enabled: true },
  'users.friend': { limit: 20, windowMs: 60_000, enabled: true },
  // social graph reads (counts + lists) — public-projection reads, bounded
  // like the other public reads (anonymous callers key by IP)
  'users.relationships': { limit: 120, windowMs: 60_000, enabled: true },
  'users.connections': { limit: 120, windowMs: 60_000, enabled: true },
  // profile activity heatmap (/api/v1/users/activity) — one aggregation of
  // day-counts per profile view, bounded like the other public reads
  'users.activity': { limit: 120, windowMs: 60_000, enabled: true },
  // notifications: list backs the bell (poll + focus refetch), read flips
  // readAt, settings is a rare interactive toggle
  'notifications.list': { limit: 120, windowMs: 60_000, enabled: true },
  'notifications.read': { limit: 60, windowMs: 60_000, enabled: true },
  'notifications.settings': { limit: 30, windowMs: 60_000, enabled: true },
  // one-click email unsubscribe — anonymous (keys by IP), tokens are HMACs so
  // this is hygiene against link-scanner hammering, not a security boundary
  'notifications.emailUnsubscribe': { limit: 20, windowMs: 60_000, enabled: true },
  // post view telemetry (POST /api/v1/things/views) — anonymous-capable
  // batched beacons; one flush covers a whole scroll session, so this window
  // is generous for humans and a wall for replay scripts (anon keys by IP)
  'things.views': { limit: 60, windowMs: 60_000, enabled: true },
  // Admin-only raw queries can still be expensive; keep accidental repeated
  // scans bounded independently from the ordinary app APIs.
  'mongodb.query': { limit: 30, windowMs: 60_000, enabled: true },
  // Admin-only DB seed/populate is very heavy (registers fixture users, seeds
  // showcase posts/schemas) — bound it tightly so repeated runs can't hammer
  // the DB or burn serverless compute. Enforced fail-closed at the route.
  'mongodb.populate': { limit: 3, windowMs: 60_000, enabled: true },
  // Data-endpoint override actions (thin-frontend mode). Each activation/save
  // makes the SERVER probe (TCP connect + ping, ≤2.5s) whatever host:port the
  // caller supplied — unbounded, that's an anonymous outbound port-scan /
  // connection-hammer vector, so both windows stay tight. Switching endpoints
  // is a rare interactive action; 5-minute windows leave humans unthrottled.
  // mongodb.endpoint: activate/reset the session override (anon keys by IP).
  // mongodb.endpoints: saved-list writes (authed; save also probes).
  // Both enforced fail-closed at their routes (reset stays exempt — it probes
  // nothing and bailing back to the home DB must always work).
  'mongodb.endpoint': { limit: 20, windowMs: 300_000, enabled: true },
  'mongodb.endpoints': { limit: 30, windowMs: 300_000, enabled: true },
  // service accounts do legitimate bulk writes (e.g. chunked snapshot sync), so
  // they get a higher ceiling — but a BOUNDED one, never an exemption: anyone
  // can provision a service account, so accountKind confers no trust
  'things.write.service': { limit: 600, windowMs: 60_000, enabled: true },
  // embeddable "Login with Thingtime" (api/utils/apps): app registration is a
  // rare developer action; authorize mints revocable app sessions; app-data
  // writes come from third-party pages and are keyed per (user, app)
  'apps.write': { limit: 30, windowMs: 3_600_000, enabled: true },
  'oauth.authorize': { limit: 30, windowMs: 600_000, enabled: true },
  'appData.write': { limit: 120, windowMs: 60_000, enabled: true },
  // anonymous consent-screen lookup (/api/v1/apps/public) — each call is an
  // unauthenticated DB read, so bound it per IP like the other public reads
  'apps.public': { limit: 60, windowMs: 60_000, enabled: true },
  // anonymous sandbox-token mint (/api/v1/oauth/sandbox) — each call writes a
  // short-lived session doc and unlocks a (small, TTL-reaped) storage
  // namespace, so the per-IP budget is deliberately tight: worst-case junk
  // per IP ≈ limit/min × 60 × SANDBOX_STORAGE_BYTES, all gone within 1h
  'oauth.sandbox': { limit: 10, windowMs: 60_000, enabled: true },
  // Global sandbox storage brake (TODO/claude-todo/15 §1): the app-wide byte
  // budget every sandbox write charges against, layered on the per-namespace
  // budget. UNIT EXCEPTION: `limit` here is MEGABYTES per window (a byte
  // budget, consumed by rateLimit/byteBudget.ts), not a request count — the
  // default is 512MB/hour across ALL sandboxes. Enforced FAIL-CLOSED: sandbox
  // writes are anonymous standing storage, so an unavailable ledger refuses.
  'sandbox.storage.global': { limit: 512, windowMs: 3_600_000, enabled: true },
  // app-token READ endpoints (oauth/userinfo, oauth/shared, app-data GET) —
  // token-gated, keyed per (user, app); a backstop against a compromised or
  // abusive integration hammering the resolution + read path
  'oauth.read': { limit: 300, windowMs: 60_000, enabled: true },
  // connected-apps listing (GET /oauth/grants) — session-authed but it
  // aggregates over the user's live app sessions, so keep repeat reads bounded
  'oauth.grants': { limit: 60, windowMs: 60_000, enabled: true },
  // password-reset requests email any address you name — the classic mail-bomb
  // + enumeration vector, so the window is tight (anonymous, keyed by IP)
  'auth.passwordReset': { limit: 5, windowMs: 15 * 60_000, enabled: true },
  // reset-token redemption: throttle repeated token guesses / password sets
  // before any token work (its own bucket so it can't starve reset requests)
  'auth.passwordResetConfirm': { limit: 10, windowMs: 15 * 60_000, enabled: true },
  // resend-verification emails any address you name — the same unauthenticated
  // mail-bomb + enumeration vector as password reset, so bound it the same way
  // (anonymous, keyed by IP) instead of leaving the real SES sender uncapped
  'auth.resendVerification': { limit: 5, windowMs: 15 * 60_000, enabled: true },
  // login attempts (password step and OTP step share the endpoint): bounds
  // credential stuffing and OTP-email sends beyond the per-challenge attempt cap
  'auth.login': { limit: 30, windowMs: 60_000, enabled: true },
  // passkey ceremonies: options endpoints only mint signed challenge cookies
  // (cheap, but unauthenticated), verify endpoints do signature checks + at
  // most one session mint — bound both like login. Management (register/
  // rename/revoke/delete) is session-authed and keyed by user.
  'auth.passkeyOptions': { limit: 60, windowMs: 60_000, enabled: true },
  'auth.passkeyLogin': { limit: 30, windowMs: 60_000, enabled: true },
  'auth.passkeyManage': { limit: 30, windowMs: 60_000, enabled: true },
  // cross-deployment auto-login suggestions: resolves at most a handful of
  // roster/session docs per call, unauthenticated, so bound per IP
  'auth.accountHints': { limit: 60, windowMs: 60_000, enabled: true },
  // federated flavor of the above: other Thingtime deployments' pages read it
  // cross-origin (same-site credentials), so it gets its own IP bucket
  'auth.hintsResolve': { limit: 60, windowMs: 60_000, enabled: true },
  // cross-origin session handoff: minting is session-authed (user-keyed) and
  // each code is single-use + 2-minute TTL; redemption is anonymous (IP)
  'auth.ssoHandoff': { limit: 20, windowMs: 60_000, enabled: true },
  'auth.ssoSession': { limit: 20, windowMs: 60_000, enabled: true },
  // FedCM: browser-mediated fetches (Sec-Fetch-Dest: webidentity). Accounts
  // reads are roster lookups; assertions mint at most one code/token each.
  'fedcm.accounts': { limit: 120, windowMs: 60_000, enabled: true },
  'fedcm.assertion': { limit: 20, windowMs: 60_000, enabled: true },
  // public sign-up: anonymous bcrypt + user-doc writes, every success emails
  // the supplied address (mail-bomb + enumeration surface like the other auth
  // mailers), and it's an awaited ensureIndexes bootstrap caller — throttling
  // keeps retries from re-running the index battery too. Keyed by IP; roomy
  // enough for a human fumbling taken usernames, tight for account farming.
  'auth.register': { limit: 10, windowMs: 15 * 60_000, enabled: true },
  // First-session /things bootstrap: every success creates a durable user,
  // session, roster entry, and subscription ledger. Reuse is checked before
  // this bucket, so five creations per IP/day is generous for cookie loss and
  // deliberately tight against anonymous account farming. Fail-closed route.
  'auth.temporary': { limit: 5, windowMs: 24 * 60 * 60_000, enabled: true },
  // personal-access-token minting (POST /api/v1/tokens) — session-authed, but
  // each mint writes a session doc, so bound accumulation beyond the per-user
  // token cap
  'tokens.mint': { limit: 30, windowMs: 3_600_000, enabled: true },
  // PAT listing aggregates the user's pat sessions — bounded like oauth.grants
  'tokens.read': { limit: 60, windowMs: 60_000, enabled: true },
  // PAT revocation — cheap owner-bound update, still bounded
  'tokens.revoke': { limit: 60, windowMs: 60_000, enabled: true },
  // Cross-deployment account links. Linking/unlinking makes the SERVER dial
  // whatever base URL the caller supplied (login probe + identity check) — the
  // same outbound-fetch abuse surface as mongodb.endpoint, so the window stays
  // tight and the routes enforce fail-closed. Token minting shares the key
  // (each mint writes a never-expiring session doc).
  'deployments.link': { limit: 10, windowMs: 300_000, enabled: true },
  // Editing a link you already hold (name, sync mode, path rules) dials
  // NOTHING — it rewrites one row in the caller's own secure blob. It gets its
  // own budget because the settings pane sends one PATCH per sync-mode tap and
  // per path-rule save: on the dial budget above, configuring a couple of links
  // exhausts the window and locks the same user out of linking and unlinking.
  'deployments.update': { limit: 60, windowMs: 60_000, enabled: true },
  // One sync pass fans out up to ~40 writes against the linked deployment plus
  // paginated reads on both sides — heavier than any single API call, so the
  // per-user budget is small (fail-closed at the route). Passes are resumable,
  // so a tight cap costs only patience, never data.
  'deployments.sync': { limit: 6, windowMs: 300_000, enabled: true },
  // /crypto password hasher: anonymous and pure (no DB), but bcrypt burns
  // ~100ms of CPU per call by design, so the budget is tight per IP — the
  // compute is the abuse surface, not the hash it returns
  'crypto.hashPassword': { limit: 20, windowMs: 60_000, enabled: true },
  // Messenger. Sending is chattier than posting, so it gets a higher window
  // than things.write; membership/chat mutations share one bounded bucket.
  'chats.message': { limit: 120, windowMs: 60_000, enabled: true },
  'chats.write': { limit: 60, windowMs: 60_000, enabled: true },
  // A desktop sync is chunked into bounded JSON batches. The wider hourly
  // window accommodates a first full-history import while still fencing a
  // runaway renderer or replay loop.
  'ai.sync': { limit: 600, windowMs: 3_600_000, enabled: true },
	// Paired device mesh. Pairing creates credentials and therefore fails
	// closed at the routes; state/command/event budgets are deliberately roomy
	// enough for a live desktop while still bounding stuck pollers and replays.
	'devices.read': { limit: 240, windowMs: 60_000, enabled: true },
	'devices.pairing': { limit: 20, windowMs: 3_600_000, enabled: true },
	'devices.pairing.claim': { limit: 30, windowMs: 15 * 60_000, enabled: true },
	'devices.state': { limit: 240, windowMs: 60_000, enabled: true },
	'devices.commands': { limit: 120, windowMs: 60_000, enabled: true },
	'devices.node.commands': { limit: 600, windowMs: 60_000, enabled: true },
	'devices.liveSync': { limit: 120, windowMs: 60_000, enabled: true },
	'devices.approvals': { limit: 120, windowMs: 60_000, enabled: true },
	'devices.permissions': { limit: 60, windowMs: 60_000, enabled: true },
	'devices.events': { limit: 240, windowMs: 60_000, enabled: true },
	'devices.screen': { limit: 60, windowMs: 60_000, enabled: true },
	'devices.sync': { limit: 600, windowMs: 3_600_000, enabled: true },
  // message reactions mirror things.react but chats toggle faster in practice
  'chats.react': { limit: 120, windowMs: 60_000, enabled: true },
  // read receipts fire on every focused chat scroll — cheap single-doc updates,
  // but still bounded so a stuck client can't hammer the collection
  'chats.read': { limit: 240, windowMs: 60_000, enabled: true },
  // custom emoji uploads carry up to ~512KB data URIs into things docs — rare
  // interactive action, so the budget is per-hour like app registration
  'emojis.write': { limit: 30, windowMs: 3_600_000, enabled: true },
  // The integration vault can trigger provider operations; keep its admin
  // control plane bounded even before an endpoint policy is consulted.
  'admin.integrations': { limit: 60, windowMs: 60_000, enabled: true },
  // service-account provisioning is public self-service but each call mints a
  // permanent bearer token + a 5 GiB-allowance account and sends a verification
  // email — bound it tightly per IP (a legit integrator provisions a handful,
  // ever). Enforced fail-closed at the route like mongodb.populate.
  'auth.serviceAccount': { limit: 10, windowMs: 15 * 60_000, enabled: true },
  // Public diagnostic packets used by Commander Activity. A speed run makes
  // exactly five requests in each direction (one for each fixed packet size),
  // so this admits one complete measurement every 15 minutes per client IP and
  // rejects traffic if the shared limiter is unavailable.
  'networkProbe.ping': { limit: 60, windowMs: 60_000, enabled: true },
  'networkProbe.download': { limit: 5, windowMs: 15 * 60_000, enabled: true },
  // One v2 run has 11 chunks, each at most 2 MiB (22 MiB ceiling per window,
  // below the previous five 10 MiB requests). Downloads still use five packets.
  // Versioned because persisted v1 rules count logical packets, not chunks.
  'networkProbe.upload.v2': { limit: NETWORK_PROBE_UPLOAD_REQUESTS, windowMs: 15 * 60_000, enabled: true },
  // token introspection (POST /api/v1/auth/introspect) — read-only status
  // checks by external platforms; two cheap DB reads per call, keyed by IP for
  // anonymous callers, bounded like the other public reads
  'auth.introspect': { limit: 120, windowMs: 60_000, enabled: true },
  // the "try my feed brain 🧠" share-link preview (GET /api/v1/algorithms/shared)
  // — public and anonymous, two DB reads per call (the algorithm lookup plus an
  // owner-username resolve). The shareId is an unguessable uuid, so this is not
  // an enumeration brake; it is the same "bound the anonymous public read"
  // budget the other unauthenticated endpoints carry, keyed by hashed IP.
  'algorithms.shared': { limit: 120, windowMs: 60_000, enabled: true }
};

export const RATE_LIMIT_ENDPOINTS = Object.keys(RATE_LIMIT_DEFAULTS);

const SETTINGS_KEY = 'rateLimits';
const CONFIG_TTL_MS = 15_000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

let cache: { at: number; config: RateLimitConfig } | null = null;

const clampRule = (rule: any, fallback: RateLimitRule): RateLimitRule => ({
	limit: Number.isFinite(rule?.limit) ? Math.max(1, Math.min(100_000, Math.floor(rule.limit))) : fallback.limit,
	windowMs: Number.isFinite(rule?.windowMs) ? Math.max(1000, Math.min(MAX_WINDOW_MS, Math.floor(rule.windowMs))) : fallback.windowMs,
	enabled: rule?.enabled === undefined ? fallback.enabled : rule.enabled !== false
});

// Only known endpoints survive, each clamped — a stored/patched config can never
// widen the endpoint set or set nonsensical values.
const normalize = (endpoints: any): RateLimitConfig => {
	const out: RateLimitConfig = {};
	for (const [name, def] of Object.entries(RATE_LIMIT_DEFAULTS)) {
		out[name] = clampRule(endpoints?.[name], def);
	}
	return out;
};

export const getRateLimitConfig = async (force = false): Promise<RateLimitConfig> => {
	if (!force && cache && Date.now() - cache.at < CONFIG_TTL_MS) return cache.config;
	try {
		const doc = await (await getSettingsCollection()).findOne({ key: SETTINGS_KEY });
		const config = normalize(doc?.endpoints);
		cache = { at: Date.now(), config };
		return config;
	} catch {
		// fall back to the last cache or the defaults if the settings read fails
		return cache?.config || normalize(null);
	}
};

export const setRateLimitConfig = async (patch: RateLimitConfig, updatedBy: string): Promise<RateLimitConfig> => {
	const current = await getRateLimitConfig(true);
	const endpoints: RateLimitConfig = {};
	for (const [name, def] of Object.entries(RATE_LIMIT_DEFAULTS)) {
		// Merge the patch OVER the current stored rule, so a partial patch (e.g.
		// only { limit }) keeps the endpoint's other fields instead of resetting
		// them to defaults; then clamp. Non-object patch entries are ignored.
		const p = patch?.[name] && typeof patch[name] === 'object' ? patch[name] : {};
		endpoints[name] = clampRule({ ...current[name], ...p }, def);
	}
	await (
		await getSettingsCollection()
	).updateOne({ key: SETTINGS_KEY }, { $set: { key: SETTINGS_KEY, endpoints, updatedAt: new Date(), updatedBy } }, { upsert: true });
	cache = { at: Date.now(), config: endpoints };
	return endpoints;
};
