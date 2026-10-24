import { serviceGroupFor, type ServiceGroup } from '~/connections/catalog';
import type { Provider } from './ServiceCatalog';
import type { Connection } from './shared';

/** Explicit display projection: provider responses cannot add private values to
 * the Builder scope by acquiring another property in a future API revision. */
export function serviceCatalogView(providers: Provider[], connections: Connection[], signedOut: boolean, busy: boolean, connectingId?: string) {
  const groups = new Map<string, { service: ServiceGroup; providers: Provider[] }>();
  for (const provider of providers) {
    const service = provider.service || serviceGroupFor(provider);
    if (!groups.has(service.id)) groups.set(service.id, { service, providers: [] });
    groups.get(service.id)!.providers.push(provider);
  }
  const priority = (id: string) => { const value = ['chatgpt', 'meta', 'google'].indexOf(id); return value < 0 ? 99 : value; };
  return { busy, groups: [...groups.values()].sort((a, b) => priority(a.service.id) - priority(b.service.id)).map(({ service, providers: services }) => {
    const primary = services.find(provider => provider.auth === 'oauth2') || services[0];
    return {
      id: service.id, icon: service.icon, name: service.name, about: service.about,
      count: connections.filter(connection => services.some(provider => provider.id === connection.provider)).length,
      primaryId: primary.id, multiple: services.length > 1, cannotConnect: signedOut || busy || !primary.configured,
      providers: services.map(provider => ({
        id: provider.id, name: provider.name, icon: provider.icon, about: provider.about,
        cannotConnect: signedOut || busy || !provider.configured,
        authentication: provider.auth === 'oauth2' ? 'Sign in securely in a new tab' : provider.auth === 'credential' ? 'Connect with an app password' : 'Public source · no sign-in required',
        setupMessage: provider.configured ? '' : provider.setupRequired === 'vault' ? 'Secure storage needs deployment setup.' : 'This service needs deployment setup.',
        connectLabel: provider.id === 'chatgpt' ? 'Continue with ChatGPT' : '+ Add account', connecting: connectingId === provider.id,
        fields: provider.fields.map(field => ({ key: field.key, label: field.label, placeholder: field.placeholder || '', help: field.help || '', required: !!field.required, type: field.secret ? 'password' : 'text' })),
        accounts: connections.filter(connection => connection.provider === provider.id).map(account => ({
          id: account.id, providerId: provider.id, displayName: account.account.displayName, handle: account.account.handle, avatarUrl: account.account.avatarUrl || '',
          authorization: account.credentialStatus === 'reconnect' ? 'Reconnect to save a private authorization' : provider.auth === 'none' ? 'Public source connected' : 'Authorization saved privately',
          oauth: provider.auth === 'oauth2', cannotVerify: busy || signedOut || account.credentialStatus === 'reconnect', cannotReconnect: busy || signedOut || !provider.configured, canOpenFeed: !provider.accountOnly,
          feedHref: `/connections/feed?connection=${encodeURIComponent(account.id)}`, lastSyncError: account.lastSyncError || '', permissions: account.scopes?.join('\n') || ''
        }))
      }))
    };
  }) };
}
