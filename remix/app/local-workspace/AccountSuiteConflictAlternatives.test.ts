import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider, Button } from '@chakra-ui/react';
import { AccountSuiteConflictAlternatives } from './AccountSuiteConflictAlternatives';
import type { AccountSuiteConflict } from './accountSuiteReconcile';

const version = (label: string, visibility: 'public' | 'hidden' | 'private') => ({
	id: 'canonical-suite-component', thingtime: ['component'], crystal: { name: label, componentKey: 'suite-part', render: { tag: 'p', children: label } },
	author: { id: 'owner' }, acl: [visibility === 'public' ? 'tt:public' : visibility === 'hidden' ? 'tt:link' : 'tt:user'], visibility,
	createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z', revision: 1
});
const alternatives = (): AccountSuiteConflict => ({ id: 'canonical-suite-component', requestId: 'frozen-install-request',
	provisional: version('Original public device content', 'public'), canonical: version('Private cached account edit', 'private'),
	authoritative: version('Hidden account content', 'hidden'), reason: 'audience-overlap' });

test('preserved suite alternatives show exact content and audience before explicit recovery', () => {
	const chosen: string[] = [];
	const markup = renderToStaticMarkup(React.createElement(ChakraProvider, null,
		React.createElement(AccountSuiteConflictAlternatives, { alternatives: alternatives(), disabled: false, onChoose: source => chosen.push(source) })));
	assert.match(markup, /aria-label="Preserved suite versions"/);
	assert.match(markup, /Original public device content/);
	assert.match(markup, /Private cached account edit/);
	assert.ok(/Audience: (?:<!-- -->)?Public/.test(markup), 'The public audience must be visible before choosing recovery.');
	assert.match(markup, /Use original device version · Public/);
	assert.match(markup, /Use previously cached account version · Private/);
	assert.match(markup, /syncs its content with the audience shown below/);
	assert.deepEqual(chosen, [], 'Rendering a conflict cannot select or publish a version.');
});

test('only available alternatives have recovery actions and disabled review cannot imply an accepted choice', () => {
	const chosen: string[] = [];
	const tree = AccountSuiteConflictAlternatives({ alternatives: { ...alternatives(), canonical: null }, disabled: true, onChoose: source => chosen.push(source) });
	const buttons: React.ReactElement<any>[] = [];
	const visit = (node: React.ReactNode) => React.Children.forEach(node, child => {
		if (!React.isValidElement(child)) return;
		if (child.type === Button) buttons.push(child as React.ReactElement<any>);
		visit((child.props as { children?: React.ReactNode }).children);
	});
	visit(tree);
	assert.equal(buttons.length, 1);
	assert.equal(buttons[0].props.isDisabled, true);
	assert.match(buttons[0].props.children, /original device version · Public/);
	assert.deepEqual(chosen, []);
});
