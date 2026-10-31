// Opt-in component regression: real React/Chakra/component; synthetic local reads only.
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChakraProvider } from '@chakra-ui/react';
import { AccountPasswordWorkspace } from '../components/Passwords/AccountPasswordWorkspace';
import type { LocalPasswordVault } from './passwordVault';
import type { WorkspaceScope } from './storage';

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void };
function deferred<T>(): Deferred<T> {
 let resolve!: Deferred<T>['resolve'], reject!: Deferred<T>['reject'];
 const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
}
type Request = { id: number; vaultId: string; rows: Deferred<any[]>; files: Deferred<any[]> };
const requests: Request[] = [], vaults = new Map<string, LocalPasswordVault>(), titles = new Map<string, Record<string, string>>();
let root: Root | undefined, mounts = 0;
function Child() {
 const [draft, setDraft] = React.useState('Device draft'), [mount] = React.useState(() => ++mounts);
 return <label>Draft retained across equivalent scopes<input aria-label="Fixture draft" data-mount={mount} value={draft} onChange={event => setDraft(event.target.value)} /></label>;
}
function vault(vaultId: string): LocalPasswordVault {
 if (!vaults.has(vaultId)) vaults.set(vaultId, {
  // Disable every sync pump. Queue reads still run through the real component.
  isUnlocked: () => false,
  syncStatus() { const request = { id: requests.length, vaultId, rows: deferred<any[]>(), files: deferred<any[]>() }; requests.push(request); return request.rows.promise; },
  fileSyncStatus() { return requests[requests.length - 1].files.promise; },
  async read(id: string) { return { entry: { title: titles.get(vaultId)?.[id] || 'Synthetic entry' } }; }
 } as unknown as LocalPasswordVault);
 return vaults.get(vaultId)!;
}
/** Every call supplies a newly allocated scope, including equivalent-scope rerenders. */
export function render(vaultId: string, ownerId: string, dataPlane = 'home') {
 root ??= createRoot(document.getElementById('root')!);
 const scope: AccountScope = { kind: 'account', origin: 'https://queue-fixture.invalid', ownerId, dataPlane };
 flushSync(() => root!.render(<ChakraProvider><AccountPasswordWorkspace vault={vault(vaultId)} scope={scope}><Child /></AccountPasswordWorkspace></ChakraProvider>));
 return document.getElementById('root')!.textContent;
}
export function pending(vaultId: string) { return requests.filter(request => request.vaultId === vaultId).map(({ id }) => id); }
export function complete(id: number, rows: any[] = [], files: any[] = [], names: Record<string, string> = {}) {
 const request = requests[id]; titles.set(request.vaultId, names); request.rows.resolve(rows); request.files.resolve(files);
}
export function fail(id: number) { requests[id].rows.reject(Error('Synthetic local queue read failure')); requests[id].files.resolve([]); }
export function dispose() { flushSync(() => root?.unmount()); root = undefined; }
