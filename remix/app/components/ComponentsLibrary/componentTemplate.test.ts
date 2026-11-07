import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveTemplate } from './componentTemplate.ts';

// The ttAction binding's markup half: a ttAction key on a node folds into the
// two allowlisted data-* props and NEVER survives as a node key. These are
// the guards that keep the interactive marker inert markup — the click half
// (useTtActionClicks) and the executor's envelope carry the actual authority.

test('ttAction folds into data-tt-action and is stripped from the node', () => {
	const resolved = resolveTemplate(
		{ tag: 'div', ttAction: 'send-invoice', props: { style: { color: '#fff' } }, children: ['Send'] },
		{}
	) as Record<string, unknown>;
	assert.equal('ttAction' in resolved, false);
	const props = resolved.props as Record<string, unknown>;
	assert.equal(props['data-tt-action'], 'send-invoice');
	assert.equal((props.style as Record<string, unknown>).color, '#fff');
});

test('ttActionInputs serialize to JSON with {arg} tokens substituted', () => {
	const resolved = resolveTemplate(
		{ tag: 'div', ttAction: 'send-invoice', ttActionInputs: { invoiceId: '{invoiceId}', note: 'literal' }, children: ['Send'] },
		{ invoiceId: 'abc123' }
	) as Record<string, unknown>;
	const props = resolved.props as Record<string, unknown>;
	assert.equal('ttActionInputs' in resolved, false);
	assert.deepEqual(JSON.parse(String(props['data-tt-action-inputs'])), { invoiceId: 'abc123', note: 'literal' });
});

test('ttAction with no props object creates one', () => {
	const resolved = resolveTemplate({ tag: 'span', ttAction: 'ping', children: ['go'] }, {}) as Record<string, unknown>;
	assert.equal((resolved.props as Record<string, unknown>)['data-tt-action'], 'ping');
});

test('{arg} tokens substitute inside the ttAction key itself', () => {
	const resolved = resolveTemplate({ tag: 'div', ttAction: '{which}', children: ['go'] }, { which: 'tag-customer' }) as Record<
		string,
		unknown
	>;
	assert.equal((resolved.props as Record<string, unknown>)['data-tt-action'], 'tag-customer');
});

test('an empty resolved ttAction attaches nothing', () => {
	const resolved = resolveTemplate({ tag: 'div', ttAction: '{missing}', children: ['go'] }, {}) as Record<string, unknown>;
	assert.equal(resolved.props, undefined);
});

test('ttAction inside a ttIf branch resolves with the branch', () => {
	const resolved = resolveTemplate(
		{
			ttIf: {
				arg: 'sent',
				equals: 'true',
				then: { tag: 'div', children: ['✓ sent'] },
				else: { tag: 'div', ttAction: 'send-invoice', ttActionInputs: { invoiceId: '{invoiceId}' }, children: ['Send'] }
			}
		},
		{ sent: 'false', invoiceId: 'inv9' }
	) as Record<string, unknown>;
	const props = resolved.props as Record<string, unknown>;
	assert.equal(props['data-tt-action'], 'send-invoice');
	assert.deepEqual(JSON.parse(String(props['data-tt-action-inputs'])), { invoiceId: 'inv9' });
});
