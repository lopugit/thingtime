import { GOOGLE_SERVICES, NAMED_PROVIDER_PERMISSIONS } from './catalog';

export const NAMED_CONNECTION_FEATURE = 'api.connections-named';
export const NAMED_CONNECTION_VERSION = '1.0.0';

export const namedAccess = {
  'account.identity': { label: 'Saved account identity', scope: null },
  'google.profile': { label: 'Google profile name and photo', scope: 'profile' },
  'google.email': { label: 'Google account email address', scope: 'email' }
} as const;

export type NamedOperation = keyof typeof namedAccess;
export type NamedConnectionInput = {
  requestId: string;
  name: string;
  allowedOperations: NamedOperation[];
  requestedScopes?: string[];
  reconnectId?: string;
};

export const namedOperationsFor = (provider: string): NamedOperation[] => {
  const service = GOOGLE_SERVICES.find(item => item.id === provider);
  return ['account.identity', ...(service && 'namedOperations' in service ? service.namedOperations : [])];
};

export const namedGoogleProvider = (provider: string) => GOOGLE_SERVICES.some(service => service.id === provider);

export const namedProviderPermissions = (provider: string) =>
  Object.prototype.hasOwnProperty.call(NAMED_PROVIDER_PERMISSIONS, provider) ? NAMED_PROVIDER_PERMISSIONS[provider] : [];

export const namedFacebookProvider = (provider: string) => provider === 'facebook' || provider === 'facebook-account';

export function parseNamedConnectionInput(provider: string, value: unknown): NamedConnectionInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { requestId, name, allowedOperations, requestedScopes, reconnectId } = value as Partial<NamedConnectionInput>;
  if (typeof requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId) ||
      typeof name !== 'string' || !name.trim() || !Array.isArray(allowedOperations) || !allowedOperations.length ||
      !allowedOperations.every(operation => namedOperationsFor(provider).includes(operation)) ||
      (reconnectId !== undefined && (typeof reconnectId !== 'string' || !/^ext-auth-[a-f0-9]{48}$/.test(reconnectId)))) return null;
  const operationScopes = allowedOperations.flatMap(operation => namedAccess[operation].scope ? [namedAccess[operation].scope!] : []);
  const selections = requestedScopes === undefined ? operationScopes : requestedScopes;
  const valid = namedProviderPermissions(provider);
  if (!Array.isArray(selections) || !selections.every(scope => valid.some(permission => permission.scope === scope)) ||
      !operationScopes.every(scope => selections.includes(scope)) ||
      (namedGoogleProvider(provider) && provider !== 'google' && !selections.length)) return null;
  return { requestId, name: name.trim(), allowedOperations: [...new Set(allowedOperations)].sort(),
    requestedScopes: [...new Set(selections)].sort(), ...(reconnectId ? { reconnectId } : {}) };
}

export const namedAuthorizeScopes = (provider: string, selected: readonly string[]): string[] | undefined =>
  namedGoogleProvider(provider) ? [...new Set(['openid', ...selected])] :
    namedFacebookProvider(provider) ? [...new Set(['public_profile', ...selected])] : undefined;

export const verifiedNamedScope = (scopes: readonly string[], scope: string): boolean =>
  scopes.includes(scope) || (['profile', 'email'].includes(scope) && scopes.includes(`https://www.googleapis.com/auth/userinfo.${scope}`));
