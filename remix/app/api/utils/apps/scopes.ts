// Permission scopes for "Login with Thingtime" grants. Platforms request a
// scope set when opening the authorize popup (SDK `scopes` option → OAuth-style
// space-delimited `scope` param); the consent screen renders these entries as
// a permissions selector; the user's approved subset is stored on the app
// session (meta.scopes) and enforced server-side on every app-token request.

export type AppScopeId = 'profile' | 'email' | 'app-data';

export type AppScopeDescriptor = {
  id: AppScopeId;
  title: string;
  description: string;
  // required scopes can't be deselected on the consent screen — 'profile' is
  // the identity itself; without it there is nothing to log in AS.
  required: boolean;
};

export const APP_SCOPES: Record<AppScopeId, AppScopeDescriptor> = {
  profile: {
    id: 'profile',
    title: 'Public profile',
    description: 'Your username, display name, and avatar.',
    required: true
  },
  email: {
    id: 'email',
    title: 'Email address',
    description: 'The email address on your Thingtime account.',
    required: false
  },
  'app-data': {
    id: 'app-data',
    title: 'App storage',
    description: 'Store its own data for you in your Thingtime account — only its own, nothing else.',
    required: false
  }
};

export const APP_SCOPE_IDS = Object.keys(APP_SCOPES) as AppScopeId[];

// Tokens minted before scopes existed carry no meta.scopes — they behave as
// the original feature did: identity + app storage.
export const LEGACY_APP_SCOPES: AppScopeId[] = ['profile', 'app-data'];

// What the SDK requests when no scopes option is passed.
export const DEFAULT_APP_SCOPES: AppScopeId[] = ['profile', 'app-data'];

const isScopeId = (value: unknown): value is AppScopeId =>
  typeof value === 'string' && (APP_SCOPE_IDS as string[]).includes(value);

// Parse the popup's `scope` query param (space- or comma-delimited). Unknown
// scope names fail loudly — a platform typo'ing a scope should find out in
// dev, not silently lose the permission. Empty/absent → the default set.
export const parseScopeParam = (
  value: unknown
): { ok: true; scopes: AppScopeId[] } | { ok: false; error: string } => {
  if (value === null || value === undefined || value === '') {
    return { ok: true, scopes: [...DEFAULT_APP_SCOPES] };
  }
  if (typeof value !== 'string' || value.length > 256) {
    return { ok: false, error: 'scope must be a space-delimited list of scope names' };
  }

  const names = value.split(/[\s,+]+/).filter(Boolean);
  if (!names.length) return { ok: true, scopes: [...DEFAULT_APP_SCOPES] };

  const scopes: AppScopeId[] = [];
  for (const name of names) {
    if (!isScopeId(name)) {
      return { ok: false, error: `Unknown scope: ${name} (known: ${APP_SCOPE_IDS.join(', ')})` };
    }
    if (!scopes.includes(name)) scopes.push(name);
  }
  if (!scopes.includes('profile')) scopes.unshift('profile');
  return { ok: true, scopes };
};

// Validate the scope set the user approved on the consent screen. It must be
// known names and include every required scope; the authorize route
// additionally intersects it with what the app actually REQUESTED, so consent
// can only ever narrow a request, never widen it.
export const sanitizeGrantedScopes = (
  value: unknown,
  requested: AppScopeId[]
): { ok: true; scopes: AppScopeId[] } | { ok: false; error: string } => {
  if (value === undefined || value === null) {
    // No explicit selection (older SDK popups): grant the full request.
    return { ok: true, scopes: [...requested] };
  }
  if (!Array.isArray(value) || value.length > APP_SCOPE_IDS.length * 2) {
    return { ok: false, error: 'scopes must be a list of scope names' };
  }

  const scopes: AppScopeId[] = [];
  for (const entry of value) {
    if (!isScopeId(entry)) return { ok: false, error: `Unknown scope: ${String(entry)}` };
    if (!requested.includes(entry)) continue; // never wider than the request
    if (!scopes.includes(entry)) scopes.push(entry);
  }
  if (!scopes.includes('profile')) scopes.unshift('profile');
  return { ok: true, scopes };
};

// The scopes a live app session grants (legacy sessions → LEGACY_APP_SCOPES).
export const sessionScopes = (meta: Record<string, any> | undefined): AppScopeId[] => {
  const raw = meta?.scopes;
  if (!Array.isArray(raw)) return [...LEGACY_APP_SCOPES];
  const scopes = raw.filter(isScopeId);
  return scopes.includes('profile') ? scopes : ['profile', ...scopes];
};

// Descriptor list for a requested set — what the consent screen renders.
export const describeScopes = (scopes: AppScopeId[]): AppScopeDescriptor[] =>
  scopes.map((id) => APP_SCOPES[id]);
