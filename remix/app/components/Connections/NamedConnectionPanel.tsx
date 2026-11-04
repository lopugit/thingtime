import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { namedAccess, namedOperationsFor, type NamedConnectionInput, type NamedOperation } from '~/connections/namedAccess';
import { namedConnectionBlocks } from './namedConnectionBlocks';
import type { Connection } from './shared';

type Provider = { id: string; name: string; auth: string; configured: boolean };
type Draft = { provider: string; requestId: string; name: string; allowedOperations: NamedOperation[]; reconnectId?: string };

export function NamedConnectionPanel({ scopeKey, providers, connections, busy, start, remove, use, onError }: {
  scopeKey: string; providers: Provider[]; connections: Connection[]; busy: boolean;
  start(provider: string, input: NamedConnectionInput): void;
  remove(connection: Connection): Promise<void>;
  use(id: string, operation: NamedOperation): Promise<Record<string, string | null> | undefined>;
  onError(error: unknown): void;
}) {
  const candidates = providers.filter(provider => provider.auth !== 'none' && provider.configured);
  const named = connections.filter(connection => connection.named);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [active, setActive] = React.useState('');
  const [result, setResult] = React.useState('');
  const [using, setUsing] = React.useState(false);
  const useGeneration = React.useRef(0);
  const selected = named.find(connection => connection.id === active) || named[0];
  const options = draft ? namedOperationsFor(draft.provider) : [];
  const begin = (provider: string, connection?: Connection) => {
    setDraft({ provider, requestId: crypto.randomUUID(), name: connection?.named?.name || '',
      allowedOperations: connection?.named?.allowedOperations || ['account.identity'], ...(connection ? { reconnectId: connection.id } : {}) });
  };
  if (!candidates.length && !named.length) return null;
  const rows = named.map(connection => ({
    id: connection.id, name: connection.named!.name, account: `${connection.providerName} · ${connection.account.displayName}`,
    requested: connection.named!.requestedScopes.join(', ') || 'No selectable OAuth scopes reported',
    granted: connection.named!.grantedScopes === null ? 'Provider did not report OAuth scopes' : connection.named!.grantedScopes.join(', ') || 'None',
    allowed: connection.named!.allowedOperations.map(operation => namedAccess[operation].label).join(', ')
  }));
  return <SettingsDocumentHost documentKey="named-auth-connections" title="Named auth connections layout" defaultDocument={namedConnectionBlocks} scopeKey={scopeKey}>
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${scopeKey}:${draft?.requestId || 'view'}`} enabled={!editing}
      onError={() => onError(new Error('Could not run that connection action.'))}
      scope={{ named: {
        rows, canUse: !!selected, active: selected?.id || '', operations: selected?.named?.allowedOperations.map(id => ({ id, label: namedAccess[id].label })) || [],
        result, providers: candidates.map(provider => ({ id: provider.id, label: provider.name })),
        editing: !!draft || editing, formTitle: draft?.reconnectId ? 'Reconnect the same account' : 'New sign-in',
        reconnecting: !!draft?.reconnectId, provider: draft?.provider || candidates[0]?.id || '', name: draft?.name || '',
        options: options.map(id => ({ id, label: namedAccess[id].label, selected: draft?.allowedOperations.includes(id) || false }))
      } }}
      actions={{
        add: () => { if (!busy && candidates[0]) begin(candidates[0].id); },
        reconnect: ({ inputs }) => { const target = named.find(item => item.id === inputs.id); if (!busy && target) begin(target.provider, target); },
        remove: async ({ inputs }) => {
          const target = named.find(item => item.id === inputs.id);
          if (!target || busy) return;
          useGeneration.current++;
          setResult('');
          await remove(target);
        },
        provider: ({ value }) => {
          if (!draft || draft.reconnectId || typeof value !== 'string' || !candidates.some(item => item.id === value)) return;
          setDraft({ ...draft, provider: value, allowedOperations: ['account.identity'] });
        },
        access: ({ inputs, value }) => {
          const id = inputs.id as NamedOperation;
          if (!draft || !options.includes(id)) return;
          setDraft({ ...draft, allowedOperations: value === true ? [...new Set([...draft.allowedOperations, id])] : draft.allowedOperations.filter(item => item !== id) });
        },
        cancel: () => setDraft(null),
        start: ({ readField }) => {
          if (!draft || busy || !candidates.some(provider => provider.id === draft.provider)) return;
          const name = readField('connection-name');
          if (typeof name !== 'string' || !name.trim() || !draft.allowedOperations.length) {
            onError(new Error('Enter a connection name and choose at least one allowed operation.'));
            return;
          }
          const { provider, ...intent } = draft;
          start(provider, { ...intent, name: name.trim() });
          setDraft(null);
        },
        select: ({ value }) => { if (typeof value === 'string' && named.some(item => item.id === value)) { useGeneration.current++; setActive(value); setResult(''); } },
        use: async ({ inputs, signal }) => {
          const operation = inputs.id as NamedOperation;
          if (using || busy || !selected?.named?.allowedOperations.includes(operation)) return;
          const generation = ++useGeneration.current;
          setUsing(true);
          try {
            const response = await use(selected.id, operation);
            if (!signal.aborted && generation === useGeneration.current && response)
              setResult(Object.entries(response).map(([key, value]) => `${key}: ${value ?? 'Unavailable'}`).join(' · '));
          } catch (error) { if (!signal.aborted && generation === useGeneration.current) onError(error); }
          finally { setUsing(false); }
        }
      }}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
