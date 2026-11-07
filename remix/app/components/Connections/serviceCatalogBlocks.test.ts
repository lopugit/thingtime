import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceCatalogView } from './serviceCatalogView';
import { serviceCatalogBlocks } from './serviceCatalogBlocks';
import { aiServiceBlocks } from './aiServiceBlocks';
import { connectionsOverviewBlocks, connectionToolsBlocks } from './connectionToolsBlocks';
import { settingsDocumentBlocks, localSettingsDocumentAdapter } from '../Settings/settingsDocument';
import type { WebpageBlock } from '../Builder/webpageBlocks';

const flatten = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
test('saved service templates preserve nested labels and controls without capturing live account metadata', async () => {
  for (const [source, labelId] of [
    [serviceCatalogBlocks, 'account-name'], [aiServiceBlocks, 'ai-token-label'],
    [connectionsOverviewBlocks, 'connections-title'], [connectionToolsBlocks, 'channel-title']
  ] as const) {
    const blocks = settingsDocumentBlocks(source);
    const children = flatten(blocks);
    if (source !== connectionsOverviewBlocks) {
      assert.ok(children.some(block => block.type === 'collection'));
      assert.ok(children.some(block => block.tag === 'input'));
    }
    for (const block of children.filter(block => block.tag === 'input' && block.props?.type === 'password')) assert.equal(block.props?.value, undefined);
    assert.equal(children.some(block => block.type === 'native' || block.type === 'component'), false);
    const edited = structuredClone(blocks);
    const label = flatten(edited).find(block => block.id === labelId)!;
    label.text = 'Custom {item.name}';
    const values = new Map<string, string>();
    const adapter = localSettingsDocumentAdapter({ origin: 'https://example.test', ownerId: 'synthetic', dataPlane: 'home', documentKey: 'services' }, { getItem: key => values.get(key) || null, setItem: (key, value) => { values.set(key, value); } }, { request: async (_name: string, _options: any, action: any) => action() } as any);
    await adapter.save({ blocks: edited, name: 'Services', revision: null }, new AbortController().signal);
    assert.equal(flatten((await adapter.load(new AbortController().signal))!.blocks).find(block => block.id === label.id)!.text, label.text);
  }
});

test('display projection whitelists metadata and keeps sibling accounts independently actionable', () => {
  const provider: any = { id: 'google-drive', name: 'Google Drive', icon: 'G', auth: 'oauth2', contentVisibility: 'personal', configured: true, fields: [], token: 'must-not-project' };
  const accounts = ['one', 'two'].map(id => ({ id, provider: provider.id, account: { displayName: id, handle: `${id}@example.test`, token: 'must-not-project' }, credentialStatus: id === 'one' ? 'reconnect' : 'connected', secure: 'must-not-project' } as any));
  const view = serviceCatalogView([provider], accounts, false, false);
  const rows = view.groups[0].providers[0].accounts;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cannotVerify, true);
  assert.equal(rows[1].cannotVerify, false);
  assert.equal(JSON.stringify(view).includes('must-not-project'), false);
  assert.equal(serviceCatalogView([provider], accounts.slice(1), false, false).groups[0].providers[0].accounts[0].id, 'two');
  assert.equal(serviceCatalogView([provider], accounts, true, false).groups[0].providers[0].cannotConnect, true);
});

test('credential templates cannot persist authored defaults with dynamic or revealed input types', async () => {
  for (const [source, inputId] of [
    [serviceCatalogBlocks, 'provider-field-input'], [aiServiceBlocks, 'ai-name-input'], [aiServiceBlocks, 'ai-token-input']
  ] as const) {
    const original = flatten(settingsDocumentBlocks(source)).find(block => block.id === inputId)!;
    assert.equal(original.props?.['data-tt-private-control'], '');
    for (const property of ['value', 'defaultValue', 'default-value']) {
      const blocks = structuredClone(source);
      const input = flatten(blocks).find(block => block.id === inputId)!;
      input.props = { ...input.props, ...(inputId === 'ai-token-input' ? { type: 'text' } : {}), [property]: 'synthetic-private-default' };
      const persisted = new Map<string, string>();
      const adapter = localSettingsDocumentAdapter({ origin: 'https://example.test', ownerId: 'synthetic', dataPlane: 'home', documentKey: 'services' },
        { getItem: key => persisted.get(key) || null, setItem: (key, value) => { persisted.set(key, value); } },
        { request: async (_name: string, _options: any, action: any) => action() } as any);
      await assert.rejects(adapter.save({ blocks, name: 'Services', revision: null }, new AbortController().signal), /Private input values/);
      assert.equal(persisted.size, 0);
    }
  }
});
