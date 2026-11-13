export type CollModAuthority = 'granted' | 'absent' | 'unknown';

// connectionStatus is read-only. Treat every incomplete or unfamiliar response
// as unknown; an absent privilege can be asserted only from a complete list.
export function classifyThingCollModAuthority(value: unknown, database: string, collection: string): CollModAuthority {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const response = value as Record<string, unknown>;
  if (response.ok !== 1 || !response.authInfo || typeof response.authInfo !== 'object' || Array.isArray(response.authInfo)) return 'unknown';
  const info = response.authInfo as Record<string, unknown>;
  const principals = info.authenticatedUsers, roles = info.authenticatedUserRoles, privileges = info.authenticatedUserPrivileges;
  if (!Array.isArray(principals) || principals.length === 0 || !Array.isArray(roles) || !Array.isArray(privileges)) return 'unknown';
  const named = (entry: unknown, key: string) => !!entry && typeof entry === 'object' && !Array.isArray(entry) &&
    typeof (entry as Record<string, unknown>)[key] === 'string' && !!(entry as Record<string, unknown>)[key] &&
    typeof (entry as Record<string, unknown>).db === 'string' && !!(entry as Record<string, unknown>).db;
  if (!principals.every(entry => named(entry, 'user')) || !roles.every(entry => named(entry, 'role'))) return 'unknown';
  let granted = false;
  for (const entry of privileges) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'unknown';
    const privilege = entry as Record<string, unknown>;
    const actions = privilege.actions, resource = privilege.resource;
    if (!Array.isArray(actions) || !actions.every(action => typeof action === 'string' && action.length > 0) ||
        !resource || typeof resource !== 'object' || Array.isArray(resource)) return 'unknown';
    const scope = resource as Record<string, unknown>, keys = Object.keys(scope);
    let covers = false;
    if (keys.length === 1 && scope.anyResource === true) covers = true;
    else if (keys.length === 1 && scope.cluster === true) covers = false;
    // Time-series bucket resource patterns cannot cover ordinary Things.
    else if (keys.length === 2 && typeof scope.db === 'string' && typeof scope.system_buckets === 'string') covers = false;
    else if (keys.length === 1 && typeof scope.system_buckets === 'string') covers = false;
    else if (keys.length === 2 && typeof scope.db === 'string' && typeof scope.collection === 'string')
      covers = (scope.db === database || scope.db === '') && (scope.collection === collection || scope.collection === '');
    else return 'unknown';
    if (covers && (actions.includes('collMod') || actions.includes('anyAction'))) granted = true;
  }
  return granted ? 'granted' : 'absent';
}
