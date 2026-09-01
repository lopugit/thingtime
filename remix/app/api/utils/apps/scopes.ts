// Permission scopes for "Login with Thingtime" grants — path-based and
// extensible. A scope is a dot path over the user's data ('profile',
// 'profile.avatar', 'email', …); granting a path covers every descendant
// ('profile' covers 'profile.avatar'), so apps can ask for exactly the
// granularity they need and new leaves can be added without breaking existing
// grants. Platforms request a REQUIRED set (the popup's `scope` param) and an
// OPTIONAL set (`optional_scope`); the consent screen renders both as a
// permissions selector, and — unless the platform opts out (`extra=0`) — the
// user can also volunteer MORE of their data than the platform asked for
// ("auto" sharing: well-built platforms read the granted scopes dynamically
// and light up features for whatever the user chose to share). The approved
// selection is stored on the app session (meta.scopes) and enforced
// server-side on every app-token request.

export type AppScopeKind = 'namespace' | 'field' | 'capability' | 'picker';

export type AppScopeDescriptor = {
  id: string; // dot path, e.g. 'profile.avatar'
  title: string;
  description: string;
  kind: AppScopeKind;
  // baseline scopes can't be deselected on the consent screen — the login
  // identity itself ('profile.username') is meaningless to withhold.
  baseline?: boolean;
  // exact scopes are privacy-EXPANDING leaves: an ancestor grant never covers
  // them ('app-data' does not imply 'app-data.shared') — the user must grant
  // the literal path, so widening who can see data always shows its own
  // consent line. The tree rule ("a path covers every descendant") holds for
  // everything else.
  exact?: boolean;
};

// The catalog — ordered as the consent screen lists them. Extending the
// permission surface = adding an entry here plus (for fields) a gate where
// the data is served; nothing else needs to change.
export const APP_SCOPE_CATALOG: AppScopeDescriptor[] = [
  {
    id: 'profile',
    title: 'Full public profile',
    description: 'Everything public on your profile — username, display name, avatar, bio, banner.',
    kind: 'namespace'
  },
  {
    id: 'profile.username',
    title: 'Username',
    description: 'Your @username — the login identity itself.',
    kind: 'field',
    baseline: true
  },
  {
    id: 'profile.displayName',
    title: 'Display name',
    description: 'The name shown on your profile.',
    kind: 'field'
  },
  {
    id: 'profile.avatar',
    title: 'Avatar',
    description: 'Your profile picture.',
    kind: 'field'
  },
  {
    id: 'profile.bio',
    title: 'Bio',
    description: 'The short bio on your profile.',
    kind: 'field'
  },
  {
    id: 'profile.banner',
    title: 'Banner',
    description: 'Your profile banner image.',
    kind: 'field'
  },
  {
    id: 'profile.birthday',
    title: 'Birthday',
    description: 'Your date of birth — private on Thingtime, shared only if you approve it here.',
    kind: 'field',
    // The birthday is NOT public profile data, so a plain `profile` grant
    // (including every legacy token) must never silently include it.
    exact: true
  },
  {
    id: 'email',
    title: 'Email address',
    description: 'The email address on your Thingtime account.',
    kind: 'field'
  },
  {
    id: 'app-data',
    title: 'App storage',
    description: 'Store its own data for you in your Thingtime account — only its own, nothing else.',
    kind: 'capability'
  },
  {
    id: 'app-data.shared',
    title: 'Shared app storage',
    description:
      'Other people using this app can see entries the app marks as shared — you opt in per entry; never other apps, never the public web.',
    kind: 'capability',
    exact: true
  },
  {
    id: 'things',
    title: 'Things you choose',
    description: 'Read-only access to specific things you hand-pick from your Thingtime — just those, nothing else.',
    kind: 'picker'
  }
];

const CATALOG_BY_ID = new Map(APP_SCOPE_CATALOG.map((scope) => [scope.id, scope]));

export const APP_SCOPE_IDS = APP_SCOPE_CATALOG.map((scope) => scope.id);

export const BASELINE_APP_SCOPES = APP_SCOPE_CATALOG.filter((s) => s.baseline).map((s) => s.id);

// Tokens minted before scopes existed carry no meta.scopes — they behave as
// the original feature did: identity + full profile + app storage.
export const LEGACY_APP_SCOPES = ['profile', 'app-data'];

// What the SDK requests when no scopes option is passed.
export const DEFAULT_APP_SCOPES = ['profile', 'app-data'];

export const isKnownScope = (value: unknown): value is string =>
  typeof value === 'string' && CATALOG_BY_ID.has(value);

// One scope covering one path: exact match or ancestor ('profile' covers
// 'profile.avatar').
const coversPath = (scope: string, path: string): boolean =>
  scope === path || path.startsWith(`${scope}.`);

const EXACT_APP_SCOPES = new Set(APP_SCOPE_CATALOG.filter((s) => s.exact).map((s) => s.id));

// Does a granted set cover a path? Baseline scopes are always covered —
// every grant carries the login identity. Exact scopes (privacy-expanding
// leaves) need the literal path in the grant — no ancestor coverage.
export const scopeCovers = (granted: string[], path: string): boolean => {
  if (BASELINE_APP_SCOPES.includes(path)) return true;
  if (EXACT_APP_SCOPES.has(path)) return granted.includes(path);
  return granted.some((scope) => coversPath(scope, path));
};

const dedupe = (scopes: string[]): string[] => {
  const out: string[] = [];
  for (const scope of scopes) if (!out.includes(scope)) out.push(scope);
  return out;
};

// Prepend any baseline scope the set doesn't already cover, so stored grants
// and wire payloads always name the identity explicitly.
const withBaseline = (scopes: string[]): string[] =>
  dedupe([...BASELINE_APP_SCOPES.filter((b) => !scopes.some((s) => coversPath(s, b))), ...scopes]);

// Parse a space/comma-delimited scope param. Unknown scope names fail loudly —
// a platform typo'ing a scope should find out in dev, not silently lose the
// permission. Empty/absent → the supplied default set. Baseline injection is
// for REQUIRED/grant sets; optional sets parse with baseline=false so the
// login identity isn't misfiled as "optional".
export const parseScopeParam = (
  value: unknown,
  defaults: string[] = DEFAULT_APP_SCOPES,
  baseline = true
): { ok: true; scopes: string[] } | { ok: false; error: string } => {
  const finish = (scopes: string[]) => ({ ok: true as const, scopes: baseline ? withBaseline(scopes) : dedupe(scopes) });

  if (value === null || value === undefined || value === '') {
    return finish([...defaults]);
  }
  if (typeof value !== 'string' || value.length > 1024) {
    return { ok: false, error: 'scope must be a space-delimited list of scope paths' };
  }

  const names = value.split(/[\s,+]+/).filter(Boolean);
  if (!names.length) return finish([...defaults]);

  const scopes: string[] = [];
  for (const name of names) {
    if (!isKnownScope(name)) {
      return { ok: false, error: `Unknown scope: ${name} (see /api/v1/oauth/scopes for the catalog)` };
    }
    if (!scopes.includes(name)) scopes.push(name);
  }
  return finish(scopes);
};

// Validate the scope set the user approved on the consent screen.
// - It must include every REQUIRED scope (the platform declared it can't
//   function without them — the user's alternative is Cancel).
// - Unknown names 400.
// - When the platform allows extra sharing (default), any known scope may be
//   volunteered; otherwise the grant clamps to required ∪ optional.
export const sanitizeGrantedScopes = (
  value: unknown,
  required: string[],
  optional: string[],
  allowExtra: boolean
): { ok: true; scopes: string[] } | { ok: false; error: string } => {
  if (value === undefined || value === null) {
    // No explicit selection (older SDK popups): grant the full request.
    return { ok: true, scopes: withBaseline([...required, ...optional]) };
  }
  if (!Array.isArray(value) || value.length > APP_SCOPE_IDS.length * 2) {
    return { ok: false, error: 'scopes must be a list of scope paths' };
  }

  const selection: string[] = [];
  for (const entry of value) {
    if (!isKnownScope(entry)) return { ok: false, error: `Unknown scope: ${String(entry)}` };
    if (!allowExtra && !required.includes(entry) && !optional.includes(entry) && !BASELINE_APP_SCOPES.includes(entry)) {
      continue; // never wider than the request when extras are off
    }
    if (!selection.includes(entry)) selection.push(entry);
  }

  for (const scope of required) {
    if (!scopeCovers(selection, scope)) {
      return { ok: false, error: `The app requires the ${scope} permission — cancel instead if you'd rather not share it` };
    }
  }

  return { ok: true, scopes: withBaseline(selection) };
};

// The scopes a live app session grants (legacy sessions → LEGACY_APP_SCOPES).
export const sessionScopes = (meta: Record<string, any> | undefined): string[] => {
  const raw = meta?.scopes;
  if (!Array.isArray(raw)) return [...LEGACY_APP_SCOPES];
  return withBaseline(raw.filter(isKnownScope));
};

// Descriptor list for a scope set — what the consent screen renders. Unknown
// ids are skipped (forward compatibility with catalogs that shrank).
export const describeScopes = (scopes: string[]): AppScopeDescriptor[] =>
  scopes.map((id) => CATALOG_BY_ID.get(id)).filter(Boolean) as AppScopeDescriptor[];

// Back-compat alias: earlier code imported AppScopeId when scopes were a
// closed union; paths are open-ended strings now.
export type AppScopeId = string;
