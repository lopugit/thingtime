import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { namedAccess, namedFacebookProvider, namedGoogleProvider, namedOperationsFor, namedProviderPermissions, type NamedConnectionInput, type NamedOperation } from '~/connections/namedAccess';
import { googleServiceAccess, googleServiceOperation, type NamedOperationArguments, type NamedOperationResult } from '~/connections/googleServiceActions';
import { namedConnectionBlocks, migrateNamedServiceBlocks, migrateNamedConnectionForm } from './namedConnectionBlocks';
import type { Connection } from './shared';

type Provider = { id: string; name: string; auth: string; configured: boolean };
type Draft = { provider: string; requestId: string; name: string; allowedOperations: NamedOperation[]; requestedScopes: string[]; reconnectId?: string };

export function NamedConnectionPanel({ scopeKey, providers, connections, busy, start, remove, use, onError }: {
  scopeKey: string; providers: Provider[]; connections: Connection[]; busy: boolean;
  start(provider: string, input: NamedConnectionInput): void;
  remove(connection: Connection): Promise<void>;
  use(id: string, operation: NamedOperation, args: NamedOperationArguments): Promise<NamedOperationResult | undefined>;
  onError(error: unknown): void;
}) {
  const candidates = providers.filter(provider => provider.auth !== 'none' && provider.configured);
  const named = connections.filter(connection => connection.named);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [validation, setValidation] = React.useState({ error: '', nameInvalid: false });
  const [active, setActive] = React.useState('');
  const [result, setResult] = React.useState<{ signature: string; text: string; operation: NamedOperation; resourceId?: string; nextPageToken?: string } | null>(null);
  const [using, setUsing] = React.useState(false);
  const useGeneration = React.useRef(0);
  const selected = named.find(connection => connection.id === active) || named[0];
  const selectionSignature = JSON.stringify([selected?.id, selected?.named]);
  const activeSignature = React.useRef(selectionSignature);
  activeSignature.current = selectionSignature;
  React.useLayoutEffect(() => {
    useGeneration.current++;
    setResult(null);
  }, [selectionSignature]);
  const options = draft ? namedOperationsFor(draft.provider) : [];
  const permissions = draft ? namedProviderPermissions(draft.provider) : [];
  const initialScopes = (provider: string) => namedFacebookProvider(provider) ? ['public_profile'] : [];
  const begin = (provider: string, connection?: Connection) => {
    if (connection?.named?.allowedOperations.some(id => !Object.prototype.hasOwnProperty.call(namedAccess, id))) {
      onError(new Error('Update Thingtime before reconnecting this connection with newer operations.')); return;
    }
    setValidation({ error: '', nameInvalid: false });
    if (connection) { useGeneration.current++; setResult(null); }
    setDraft({ provider, requestId: crypto.randomUUID(), name: connection?.named?.name || '',
      allowedOperations: connection?.named?.allowedOperations || ['account.identity'],
      requestedScopes: connection?.named?.requestedScopes.filter(scope => namedProviderPermissions(provider).some(option => option.scope === scope)) || initialScopes(provider), ...(connection ? { reconnectId: connection.id } : {}) });
  };
  if (!candidates.length && !named.length) return null;
  const rows = named.map(connection => ({
    id: connection.id, name: connection.named!.name, account: `${connection.providerName} · Account ${connection.account.id.slice(-8)}`,
    requested: connection.named!.requestedScopes.join(', ') || 'No selectable OAuth scopes reported',
    granted: connection.named!.grantedScopes === null ? 'Provider did not report OAuth scopes' : connection.named!.grantedScopes.join(', ') || 'None',
    allowed: connection.named!.allowedOperations.map(operation => namedAccess[operation]?.label || 'Newer operation (update Thingtime to use)').join(', ')
  }));
  return <SettingsDocumentHost documentKey="named-auth-connections" title="Named auth connections layout" defaultDocument={namedConnectionBlocks} migrateBlocks={blocks => migrateNamedServiceBlocks(migrateNamedConnectionForm(blocks))} scopeKey={scopeKey}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${scopeKey}:${draft?.requestId || selectionSignature}`} enabled={!editing}
      onError={() => onError(new Error('Could not run that connection action.'))}
      scope={{ named: {
        rows, canUse: !!selected, active: selected?.id || '', activeName: selected?.named?.name || '', operations: selected?.named?.allowedOperations.filter(id => Object.prototype.hasOwnProperty.call(namedAccess, id)).map(id => {
          const service = googleServiceOperation(id);
          const spec = service ? googleServiceAccess[service] : null;
          return { id, label: namedAccess[id].label, resourceRequired: !!spec?.resource, resourceLabel: spec?.resource || '',
            hasNext: result?.signature === selectionSignature && result.operation === id && !!result.nextPageToken };
        }) || [], using,
        result: result?.signature === selectionSignature ? result.text : '', providers: candidates.map(provider => ({ id: provider.id, label: provider.name })),
        permissionOptions: permissions.map(({ scope, label }) => ({ id: scope, label,
          selected: draft?.requestedScopes.includes(scope) || false, required: scope === 'public_profile' })),
        hasPermissions: !!permissions.length,
        permissionNotice: permissions.length ? 'Choose the scopes to request from this provider. Saved scopes do not enable a Thingtime action on their own.'
          : 'Custom provider scopes are unavailable for this provider. Its standard consent applies.',
        error: validation.error, valid: !validation.error, nameInvalid: validation.nameInvalid,
        editing: !!draft || editing, formTitle: draft?.reconnectId ? 'Reconnect the same account' : 'New sign-in',
        reconnecting: !!draft?.reconnectId, provider: draft?.provider || candidates[0]?.id || '',
        providerLabel: candidates.find(candidate => candidate.id === draft?.provider)?.name || '', name: draft?.name || '',
        options: options.map(id => ({ id, label: namedAccess[id].label, selected: draft?.allowedOperations.includes(id) || false }))
      } }}
      actions={{
        add: ({ inputs }) => {
          const provider = typeof inputs.id === 'string' ? candidates.find(item => item.id === inputs.id) : candidates[0];
          if (!busy && provider) begin(provider.id);
        },
        reconnect: ({ inputs }) => { const target = named.find(item => item.id === inputs.id); if (!busy && target) begin(target.provider, target); },
        remove: async ({ inputs }) => {
          const target = named.find(item => item.id === inputs.id);
          if (!target || busy) return;
          useGeneration.current++;
          setResult(null);
          await remove(target);
        },
        provider: ({ value }) => {
          if (!draft || draft.reconnectId || typeof value !== 'string' || !candidates.some(item => item.id === value)) return;
          setDraft({ ...draft, provider: value, allowedOperations: ['account.identity'], requestedScopes: initialScopes(value) });
        },
        permission: ({ inputs, value }) => {
          const scope = inputs.id;
          if (!draft || typeof scope !== 'string' || scope === 'public_profile' || !permissions.some(item => item.scope === scope)) return;
          setDraft({ ...draft,
            requestedScopes: value === true ? [...new Set([...draft.requestedScopes, scope])] : draft.requestedScopes.filter(item => item !== scope),
            allowedOperations: value === true ? draft.allowedOperations : draft.allowedOperations.filter(item => namedAccess[item].scope !== scope)
          });
        },
        access: ({ inputs, value }) => {
          const id = inputs.id as NamedOperation;
          if (!draft || !options.includes(id)) return;
          const required = namedAccess[id].scope;
          setDraft({ ...draft, allowedOperations: value === true ? [...new Set([...draft.allowedOperations, id])] : draft.allowedOperations.filter(item => item !== id),
            requestedScopes: value === true && required ? [...new Set([...draft.requestedScopes, required])] : draft.requestedScopes });
        },
        cancel: () => { setDraft(null); setValidation({ error: '', nameInvalid: false }); },
        start: ({ readField }) => {
          if (!draft || busy || !candidates.some(provider => provider.id === draft.provider)) return;
          const name = readField('connection-name');
          if (typeof name !== 'string' || !name.trim() || !draft.allowedOperations.length) {
            setValidation({ error: typeof name !== 'string' || !name.trim() ? 'Enter a connection name to continue.' : 'Choose at least one allowed operation to continue.', nameInvalid: typeof name !== 'string' || !name.trim() });
            return;
          }
          if (namedGoogleProvider(draft.provider) && draft.provider !== 'google' && !draft.requestedScopes.length) {
            setValidation({ error: 'Choose at least one permission to request for this Google service.', nameInvalid: false });
            return;
          }
          const { provider, ...intent } = draft;
          start(provider, { ...intent, name: name.trim() });
          setDraft(null);
        },
        select: ({ value }) => { if (typeof value === 'string' && named.some(item => item.id === value)) { useGeneration.current++; setActive(value); setResult(null); } },
        use: async ({ inputs, signal, readField }) => {
          const operation = inputs.id as NamedOperation;
          if (using || busy || !selected?.named?.allowedOperations.includes(operation)) return;
          const service = googleServiceOperation(operation);
          const spec = service ? googleServiceAccess[service] : null;
          const next = inputs.next === true && result?.signature === selectionSignature && result.operation === operation ? result : null;
          const rawId = spec?.resource ? readField(`service-resource-${operation}`) : undefined;
          const resourceId = next?.resourceId ?? (typeof rawId === 'string' ? rawId.trim() : undefined);
          if (spec?.resource && (!resourceId || !/^[A-Za-z0-9_-]+$/.test(resourceId))) {
            onError(new Error(`Enter a valid ${spec.resource.toLowerCase()}.`)); return;
          }
          if (inputs.next === true && !next?.nextPageToken) return;
          const generation = ++useGeneration.current;
          setUsing(true);
          try {
            const response = await use(selected.id, operation, { ...(resourceId ? { resourceId } : {}), ...(next?.nextPageToken ? { pageToken: next.nextPageToken } : {}) });
            if (!signal.aborted && generation === useGeneration.current && activeSignature.current === selectionSignature && response)
              setResult({ signature: selectionSignature, operation, resourceId, nextPageToken: spec?.paginated && typeof response.nextPageToken === 'string' ? response.nextPageToken : undefined,
                text: service ? JSON.stringify(response, null, 2) : Object.entries(response).map(([key, value]) => `${key}: ${value ?? 'Unavailable'}`).join(' · ') });
          } catch (error) { if (!signal.aborted && generation === useGeneration.current && activeSignature.current === selectionSignature) onError(error); }
          finally { setUsing(false); }
        }
      }}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
