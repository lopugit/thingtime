import type { PlatformProgram } from './types';
import { array, declare, domCall, domDocument, domGet, domSet, perform, returns, variable } from './programBuilders';

const doc = variable('doc'),
	sample = variable('sample'),
	options = variable('options');
const start = [declare('doc', domDocument()), declare('sample', domCall(doc, 'getElementById', ['sample']))];
const select = [
	{
		tag: 'form',
		children: [
			{
				tag: 'select',
				attributes: { id: 'sample' },
				children: ['one', 'two', 'three'].map((value) => ({ tag: 'option', attributes: { value }, children: [value] }))
			}
		]
	}
];
type Fixture = { name: string; program: PlatformProgram; expected: { result?: unknown; error?: string } };

export const HTML_FORM_BOUNDARY_FIXTURES: Fixture[] = [
	{
		name: 'Boolean setters preserve false rather than converting a string',
		program: {
			version: 1,
			title: 'Boolean property',
			document: [{ tag: 'input', attributes: { id: 'sample', type: 'checkbox', checked: true } }],
			steps: [...start, perform(domSet(sample, 'checked', false)), ...returns(domGet(sample, 'checked'))]
		},
		expected: { result: false }
	},
	{
		name: 'Finite numeric setters preserve fractional values',
		program: {
			version: 1,
			title: 'Fractional meter',
			document: [{ tag: 'meter', attributes: { id: 'sample', max: 1 } }],
			steps: [...start, perform(domSet(sample, 'value', 0.375)), ...returns(domGet(sample, 'value'))]
		},
		expected: { result: 0.375 }
	},
	{
		name: 'Select remove(index) resolves the HTMLSelectElement overload',
		program: {
			version: 1,
			title: 'Select removal',
			document: select,
			steps: [
				...start,
				perform(domCall(sample, 'remove', [1])),
				...returns(array(domGet(sample, 'length'), domGet(domCall(sample, 'item', [1]), 'value'), domGet(domGet(sample, 'parentNode'), 'nodeName')))
			]
		},
		expected: { result: [2, 'three', 'FORM'] }
	},
	{
		name: 'Select remove() without an index still removes the element',
		program: {
			version: 1,
			title: 'Select element removal',
			document: select,
			steps: [...start, perform(domCall(sample, 'remove')), ...returns(array(domGet(sample, 'length'), domGet(sample, 'parentNode')))]
		},
		expected: { result: [3, null] }
	},
	{
		name: 'Detached options collections spend the cumulative node budget',
		program: {
			version: 1,
			title: 'Detached option allocations',
			steps: [
				declare('doc', domDocument()),
				declare('sample', domCall(doc, 'createElement', ['select'])),
				declare('options', domGet(sample, 'options')),
				perform(domSet(options, 'length', 300)),
				perform(domSet(options, 'length', 0)),
				perform(domSet(options, 'length', 300)),
				...returns('allocation was bypassed')
			]
		},
		expected: { error: 'DOM node allocation budget exceeded' }
	},
	{
		name: 'Collection length is bounded before native allocation',
		program: { version: 1, title: 'Option allocation bound', document: select, steps: [...start, ...returns(domSet(sample, 'length', 301))] },
		expected: { error: 'DOM collection length exceeds its allocation limit' }
	},
	{
		name: 'RadioNodeList.value selects the named group member',
		program: {
			version: 1,
			title: 'Radio group value',
			document: [
				{
					tag: 'form',
					attributes: { id: 'sample' },
					children: ['one', 'two'].map((value) => ({ tag: 'input', attributes: { type: 'radio', name: 'choice', value } }))
				}
			],
			steps: [
				...start,
				declare('group', domCall(domGet(sample, 'elements'), 'namedItem', ['choice'])),
				perform(domSet(variable('group'), 'value', 'two')),
				...returns(array(domGet(variable('group'), 'value'), domGet(domCall(variable('group'), 'item', [1]), 'checked')))
			]
		},
		expected: { result: ['two', true] }
	},
	{
		name: 'ValidityState remains live as the control error changes',
		program: {
			version: 1,
			title: 'Live validity',
			document: [{ tag: 'input', attributes: { id: 'sample' } }],
			steps: [
				...start,
				declare('validity', domGet(sample, 'validity')),
				perform(domCall(sample, 'setCustomValidity', ['Try again'])),
				declare('invalid', domGet(variable('validity'), 'customError')),
				perform(domCall(sample, 'setCustomValidity', [''])),
				...returns(array(variable('invalid'), domGet(variable('validity'), 'valid')))
			]
		},
		expected: { result: [true, true] }
	},
	{
		name: 'Text selections expose native offsets and direction',
		program: {
			version: 1,
			title: 'Selection range',
			document: [{ tag: 'input', attributes: { id: 'sample', value: 'rainbow' } }],
			steps: [
				...start,
				perform(domCall(sample, 'setSelectionRange', [1, 5, 'backward'])),
				...returns(array(domGet(sample, 'selectionStart'), domGet(sample, 'selectionEnd'), domGet(sample, 'selectionDirection')))
			]
		},
		expected: { result: [1, 5, 'backward'] }
	},
	{
		name: 'Range replacement preserves the requested selection mode',
		program: {
			version: 1,
			title: 'Range replacement',
			document: [{ tag: 'textarea', attributes: { id: 'sample' }, children: ['rainbow'] }],
			steps: [
				...start,
				perform(domCall(sample, 'setRangeText', ['★', 1, 4, 'select'])),
				...returns(array(domGet(sample, 'value'), domGet(sample, 'selectionStart'), domGet(sample, 'selectionEnd')))
			]
		},
		expected: { result: ['r★bow', 1, 2] }
	},
	{
		name: 'Form reset cannot masquerade as a detached native implementation',
		program: {
			version: 1,
			title: 'Form reset',
			document: [{ tag: 'form', attributes: { id: 'sample' }, children: [{ tag: 'input', attributes: { id: 'control', value: 'Initial' } }] }],
			steps: [
				...start,
				declare('control', domCall(doc, 'getElementById', ['control'])),
				perform(domSet(variable('control'), 'value', 'Edited')),
				declare('before', domGet(variable('control'), 'value')),
				perform(domCall(sample, 'reset')),
				...returns(array(variable('before'), domGet(variable('control'), 'value')))
			]
		},
		expected: { error: 'DOM member reset is not registered for this receiver' }
	},
	{
		name: 'Select add accepts a native option as the insertion point',
		program: {
			version: 1,
			title: 'Insert an option',
			document: select,
			steps: [
				...start,
				declare('added', domCall(doc, 'createElement', ['option'])),
				perform(domSet(variable('added'), 'value', 'new')),
				perform(domCall(sample, 'add', [variable('added'), domCall(sample, 'item', [1])])),
				...returns(array(domGet(sample, 'length'), domGet(domCall(sample, 'item', [1]), 'value'), domGet(domCall(sample, 'item', [2]), 'value')))
			]
		},
		expected: { result: [4, 'new', 'two'] }
	}
];
