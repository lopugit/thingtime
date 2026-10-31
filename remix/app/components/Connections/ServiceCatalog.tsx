import React from 'react';
import type { ServiceGroup } from '~/connections/catalog';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { Connection } from './shared';
import { serviceCatalogBlocks } from './serviceCatalogBlocks';
import { serviceCatalogView } from './serviceCatalogView';

export type Provider = {
  id: string; name: string; icon: string; auth: 'none' | 'oauth2' | 'credential';
  contentVisibility: 'public' | 'personal'; about: string; configured: boolean;
  setupRequired?: 'provider' | 'vault' | null; service?: ServiceGroup; accountOnly?: boolean;
  fields: { key: string; label: string; placeholder?: string; help?: string; required?: boolean; secret?: boolean }[];
};

export function ServiceCatalog({ documentKey, providers, connections, signedOut, busy, openConnect, unlink, verify, submitConnect, cancelConnect, connectingId }: {
  documentKey: string; providers: Provider[]; connections: Connection[]; signedOut: boolean; busy: boolean;
  openConnect: (provider: Provider, signal?: AbortSignal) => void; unlink: (connection: Connection) => void; verify: (connection: Connection) => void;
  submitConnect: (fields: Record<string, string>, signal?: AbortSignal) => void; cancelConnect: () => void; connectingId?: string;
}) {
  const user = useCurrentUser();
  const plane = useDataPlane();
  const scopeKey = `${typeof window === 'undefined' ? '' : window.location.origin}:${user?.id || 'guest'}:${plane}`;
  const allowed = () => !signedOut && !busy;
  const provider = (id: unknown) => providers.find(item => item.id === id);
  const connection = (id: unknown) => connections.find(item => item.id === id && !!provider(item.provider));
  const actions: TransientBlockActions = {
    'service.connect': ({ inputs, signal }) => {
      signal.throwIfAborted();
      const selected = provider(inputs.id);
      if (allowed() && selected?.configured) openConnect(selected, signal);
    },
    'service.verify': ({ inputs, signal }) => {
      signal.throwIfAborted();
      const selected = connection(inputs.id);
      if (allowed() && selected && provider(selected.provider)?.auth === 'oauth2' && selected.credentialStatus !== 'reconnect') verify(selected);
    },
    'service.unlink': ({ inputs, signal }) => {
      signal.throwIfAborted();
      const selected = connection(inputs.id);
      if (allowed() && selected) unlink(selected);
    },
    'service.submit': ({ inputs, readField, signal }) => {
      signal.throwIfAborted();
      const selected = provider(inputs.id);
      if (!allowed() || !selected?.configured || selected.id !== connectingId || selected.auth === 'oauth2') return;
      // Values are read only for this explicit submission. Never put them in
      // display scope, authored documents, Action history or caches.
      const fields: Record<string, string> = Object.create(null);
      for (const field of selected.fields) {
        const value = readField(field.key);
        if (typeof value !== 'string' || (field.required && !value.trim())) return;
        fields[field.key] = value;
      }
      submitConnect(fields, signal);
    },
    'service.cancel': ({ signal }) => { signal.throwIfAborted(); if (!busy) cancelConnect(); }
  };
  if (!providers.length) return null;
  return <SettingsDocumentHost documentKey={documentKey} defaultDocument={serviceCatalogBlocks} scopeKey={scopeKey} title="Service account layout">
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${scopeKey}:${connectingId || ''}`}  scope={{ catalog: serviceCatalogView(providers, connections, signedOut, busy, connectingId) }} actions={actions} enabled={!editing}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
