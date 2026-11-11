import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { SecureVaultScope } from '../app/components/Settings/SecureVault';
import { LocalProviderVault } from '../app/local-workspace/providerVault';
import { WorkspaceDatabase } from '../app/local-workspace/storage';
import { deviceVaultCollections } from '../app/local-workspace/deviceVaultSession';

// Disposable browser profile only. These synthetic values never authenticate.
const phrase = 'Synthetic Console UI device passphrase';
const token = 'sk-ant-api03-synthetic-console-ui-fixture';
const scope = { kind: 'anonymous' } as const;
const gate = { assertCurrent() {}, onInvalidate: () => () => {} };
const db = new WorkspaceDatabase(indexedDB, 'thingtime.console-ui-fixture.v1');
const vault = new LocalProviderVault(db, scope, gate, location.origin);
const remoteFixture = new URLSearchParams(location.search).has('remote');
if (!remoteFixture) await vault.unlock(phrase, true);
Object.assign(window, { consoleVaultFixture: {
 proof: async () => {
  const list = await vault.list();
  const collections = deviceVaultCollections('providers');
  const stored = await db.transaction(scope, 'readonly', gate, async tx => ({
   records: await tx.list(collections.records), commands: await tx.list(collections.commands)
  }));
  const raw = JSON.stringify(stored);
  return { entries: list.entries.map(entry => ({ id: entry.id, provider: entry.kind === 'provider' ? entry.provider : undefined })),
   plaintextFound: [phrase, token].some(value => raw.includes(value)), commands: stored.commands.length,
   tokenMatches: list.entries.length === 1 && (await vault.reveal(list.entries[0].id)).value === token };
 }
} });
createRoot(document.getElementById('root')!).render(<ChakraProvider>
 <main style={{ width: '100%', maxWidth: 760, marginInline: 'auto', padding: 20, boxSizing: 'border-box' }}>
  <h1>Secure Vault Console regression</h1><SecureVaultScope localVault={remoteFixture ? undefined : vault} />
 </main>
</ChakraProvider>);
