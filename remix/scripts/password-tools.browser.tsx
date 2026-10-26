/** Synthetic UI transport only. No production endpoint, account, vault or passkey ceremony. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, ChakraProvider, Text } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';
import { PasswordManager } from '../app/components/Passwords/PasswordManager';
import type { PasswordEntry } from '../app/passwords/model';
const ownerId = 'synthetic-password-tools-owner';
const entryId = '11111111-1111-4111-8111-111111111111';
const title = 'Synthetic QA login';
const iconUrl = 'https://password-tools.invalid/icon.png';
const badIconUrl = 'https://password-tools.invalid/missing.png';
const iconBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6m0AAAAASUVORK5CYII='), character => character.charCodeAt(0));
const entries = new Map<string, { revision: number; entry: PasswordEntry }>([[entryId, { revision: 1, entry: { title, passwordType: 'login', fields: [
  { id: 'username', label: 'Username', type: 'text', value: 'synthetic@example.invalid' },
  { id: 'password', label: 'Password', type: 'password', value: '' },
  { id: 'backup', label: 'Backup password', type: 'password', value: '' },
  { id: 'website', label: 'Website', type: 'url', value: 'https://password-tools.invalid/' }
] } }]]);
const layouts = new Map<string, any>();
let saves = 0; let reads = 0; let iconFetches = 0; let rejectedRequests = 0;
const metadata = (id: string, value: { revision: number; entry: PasswordEntry }) => ({ id, title: value.entry.title, passwordType: value.entry.passwordType, revision: value.revision, updatedAt: new Date(1700000000000 + value.revision).toISOString(), ...(value.entry.icon ? { icon: value.entry.icon } : {}) });
// Deliberately no reference to original fetch: every unrecognised request fails closed.
window.fetch = async (input, init) => {
  init?.signal?.throwIfAborted();
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  if (url.href === iconUrl) { iconFetches++; return new Response(iconBytes, { headers: { 'Content-Type': 'image/png' } }); }
  if (url.href === badIconUrl) return new Response(null, { status: 404 });
  if (url.origin !== location.origin) { rejectedRequests++; return Response.json({ ok: false, error: 'Synthetic fixture blocks external requests.' }, { status: 403 }); }
  if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin: location.origin, features: Object.fromEntries(['api.passwords', 'api.things', 'api.webpages-resolve', 'api.actions-run', 'api.mongodb-endpoint'].map(feature => [feature, { version: feature === 'api.passwords' ? '1.3.0' : '1.99.0' }])) });
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.pathname === '/api/v1/passwords') {
    const response = (data: Record<string, unknown>) => Response.json({ ok: true, ownerId, ...data });
    if (!init?.body) return response({ configured: true, entries: Array.from(entries, ([id, record]) => metadata(id, record)), nextCursor: null });
    if (body.expectedOwnerId !== ownerId) return Response.json({ ok: false, error: 'Wrong synthetic owner.' }, { status: 403 });
    if (body.operation === 'file-list') return response({ files: [], nextCursor: null });
    if (body.operation === 'read') { const record = entries.get(body.id); if (!record) return Response.json({ ok: false }, { status: 404 }); reads++; return response({ id: body.id, revision: record.revision, entry: structuredClone(record.entry) }); }
    if (body.operation === 'save') {
      const record = { revision: (entries.get(body.id)?.revision || 0) + 1, entry: structuredClone(body.entry) };
      entries.set(body.id, record); saves++; return response({ record: metadata(body.id, record) });
    }
  }
  if (url.pathname === '/api/v1/webpages/resolve') {
    const page = layouts.get(url.searchParams.get('id') || '');
    return page ? Response.json({ ok: true, source: 'user', page, components: [], refs: {} }) : Response.json({ ok: false }, { status: 404 });
  }
  if (url.pathname === '/api/v1/things' && ['POST', 'PATCH'].includes(init?.method || '')) {
    const page = { id: body.id || body.shareId, author: { id: ownerId }, crystal: structuredClone(body.crystal), updatedAt: new Date().toISOString() };
    layouts.set(body.crystal.pageKey, page); return Response.json({ ok: true, thing: page });
  }
  // Notification history is metadata-only and remains synthetic too.
  if (url.pathname.includes('notification')) return Response.json({ ok: true, entries: [], notifications: [] });
  rejectedRequests++; return Response.json({ ok: false, error: 'Unsupported synthetic fixture operation.' }, { status: 404 });
};
const wait = (ms = 80) => new Promise<void>(resolve => setTimeout(resolve, ms));
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function until(assertion: () => boolean, message: string) { for (let i = 0; i < 50; i++) { if (assertion()) return; await wait(); } throw new Error(message); }
const button = (label: string, root: ParentNode = document) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent?.trim() === label || node.querySelector('p')?.textContent?.trim() === label);
const control = (label: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
function setControl(node: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (!node) throw new Error('Required synthetic form control is missing.');
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
}
function Fixture() {
  const [status, setStatus] = React.useState('Ready · synthetic UI only');
  const [running, setRunning] = React.useState(false);
  const [epoch, remount] = React.useReducer(value => value + 1, 0);
  const run = async () => {
    setRunning(true); setStatus('Running synthetic checks…');
    try {
      if (button('Close')) { button('Close')!.click(); await wait(); }
      await until(() => !!button(title), 'Synthetic entry did not load'); button(title)!.click();
      await until(() => !!control('Platform preset'), 'Actual entry editor did not open');
      check(document.querySelectorAll('select[aria-label="Platform preset"]').length === 1, 'Entry editor mounted duplicate password generators');
      const draftTitle = document.getElementById('password-title') as HTMLInputElement;
      setControl(draftTitle, 'Synthetic retained draft'); await wait();
      button('Create a passkey')!.click(); await wait();
      check(!!button('Close passkey guide'), 'Passkey guide did not expand');
      check((document.getElementById('password-title') as HTMLInputElement).value === 'Synthetic retained draft', 'Passkey guide discarded draft');
      button('Close passkey guide')!.click(); await wait(); setControl(draftTitle, title); await wait();
      check(document.querySelectorAll('select[aria-label="Platform preset"]').length === 1, 'Draft changes mounted duplicate password generators');
      for (const preset of ['apple', 'github', 'google', 'microsoft', 'custom']) {
        setControl(control('Platform preset'), preset); await wait();
        const actual = (control('Platform preset') as HTMLSelectElement).value;
        check(actual === preset, `Preset did not change: expected ${preset}, observed ${actual || '(empty)'}`);
      }
      setControl(control('Length (characters)'), '28'); await wait();
      setControl(control('Allowed symbols'), '!@#'); await wait();
      setControl(control('Additional characters to exclude'), 'abcABC'); await wait();
      setControl(control('Password field'), 'backup'); await wait();
      const primary = control('Password') as HTMLInputElement; const before = primary.value;
      setControl(control('Backup password'), ''); await wait();
      button('Generate into Backup password')!.click();
      await until(() => (control('Backup password') as HTMLInputElement)?.value.length === 28, 'Generated value did not fill selected field');
      const generated = (control('Backup password') as HTMLInputElement).value;
      check(primary.value === before, 'Generation changed a different password field');
      check((control('Backup password') as HTMLInputElement).type === 'password', 'Generated password is not masked');
      check(!/[abcABC]/.test(generated), 'Excluded characters appeared');
      check(!document.body.innerText.includes(generated), 'Generated secret leaked into rendered text');
      const saveBefore = saves; button('Save entry')!.click(); await until(() => saves > saveBefore && !button('Save entry')?.disabled, 'Synthetic save did not complete');
      check(entries.get(entryId)!.entry.fields.find(field => field.id === 'backup')?.value === generated, 'Fixture write lost generated value');
      button('Use URL instead')!.click(); await wait(); setControl(control('HTTPS icon URL'), iconUrl); button('Use this icon URL')!.click();
      await until(() => iconFetches > 0 && !!document.querySelector('img[src^="blob:"]'), 'Synthetic URL icon preview did not load');
      setControl(control('HTTPS icon URL'), badIconUrl); button('Use this icon URL')!.click(); await wait(200);
      check(!document.querySelector('img[src^="blob:"]'), 'Failed icon did not fall back');
      button('Remove icon')!.click(); await wait(); check(button('Remove icon')!.disabled, 'Icon removal did not update draft');
      const nextSave = saves; button('Save entry')!.click(); await until(() => saves > nextSave, 'Icon removal save did not complete');
      const previousReads = reads; remount(); await wait(350); button(title)!.click();
      await until(() => reads > previousReads && !!control('Backup password'), 'Saved entry did not read after component reload');
      check((control('Backup password') as HTMLInputElement).value === generated, 'Generated value lost after component reload');
      check((control('Backup password') as HTMLInputElement).type === 'password', 'Reloaded field is not masked');
      check(document.documentElement.scrollWidth <= innerWidth + 1, 'Horizontal page overflow');
      window.scrollTo(0, document.documentElement.scrollHeight); await wait();
      check(document.documentElement.scrollWidth <= innerWidth + 1, 'Bottom of page overflows');
      setStatus(`PASS · ${innerWidth}px · presets, exclusions, target, masked fill, synthetic save/read/component reload, icon preview/fallback/removal, retained passkey draft; no real provider ceremony`);
    } catch (error) { setStatus(`FAIL · ${error instanceof Error ? error.message : 'Synthetic regression failed'}`); }
    finally { setRunning(false); }
  };
  return <><Box maxW="1100px" mx="auto" p={4}><Text as="h1" fontSize="xl" fontWeight="bold">Synthetic password tools regression</Text><Text>No real credentials, accounts, provider registration or server acceptance. API writes remain in this page’s memory; reload checks remount the component and read that fixture transport.</Text><Button mt={3} disabled={running} onClick={() => void run()}>Run regression</Button><Button mt={3} ml={2} disabled={running} onClick={() => remount()}>Reload component</Button><Text role="status" data-regression-status mt={3} overflowWrap="anywhere">{status}</Text><Text fontSize="sm">Manual Builder check: open an entry, Edit layout on its generator, select a nested label or button, edit it through Builder, Save layout, Done editing layout, then Reload component and reopen the entry. Layout transport is synthetic and supports canonical saves. Unsupported requests are refused ({rejectedRequests} observed).</Text></Box><PasswordManager key={epoch} /></>;
}
const router = createMemoryRouter([{ id: 'root', path: '*', element: <Fixture />, loader: () => ({ user: { id: ownerId, username: 'synthetic-password-tools', ttid: 'synthetic', temporary: false, accountKind: 'user' }, dataPlane: 'home' }) }], { hydrationData: { loaderData: { root: { user: { id: ownerId, username: 'synthetic-password-tools', ttid: 'synthetic', temporary: false, accountKind: 'user' }, dataPlane: 'home' } } } });
createRoot(document.getElementById('root')!).render(<ChakraProvider><ThingtimeProvider storageKey="synthetic-password-tools-ui" persistLocal={false} exposeGlobals={false}><RouterProvider router={router} /></ThingtimeProvider></ChakraProvider>);
