/** Browser regressions run through the real opaque iframe and worker. These
 * are ordinary program data, so the same cases can run in the Workbench. */
import { array, declare, domCall, domDocument, domGet, domSet, perform, returns, variable } from './programBuilders';
import type { PlatformNode, PlatformProgram } from './types';

const doc = variable('doc');
const sample = variable('sample');
const start = [declare('doc', domDocument()), declare('sample', domCall(doc, 'getElementById', ['sample']))];
const control = (name: string) => ({ tag: 'input', attributes: { name } });
const form = (children: PlatformNode[]) => [{ tag: 'form', attributes: { id: 'sample', name: 'body' }, children }];
const shadowedNames = [
	'ownerDocument',
	'nodeType',
	'localName',
	'attributes',
	'childNodes',
	'textContent',
	'getRootNode',
	'appendChild',
	'cloneNode'
];
const nestedSteps = [...start];
for (let index = 0; index < 41; index++) {
	const name = `node${index}`;
	nestedSteps.push(declare(name, domCall(doc, 'createElement', ['div'])));
	nestedSteps.push(perform(domCall(index ? variable(`node${index - 1}`) : sample, 'appendChild', [variable(name)])));
}

export const DOM_BOUNDARY_FIXTURES: { name: string; program: PlatformProgram; expected: { result?: unknown; error?: string } }[] = [
	{
		name: 'Form childNodes cannot hide detached clone allocations',
		program: {
			version: 1,
			title: 'Form allocation boundary',
			document: form([control('childNodes'), ...Array.from({ length: 210 }, () => ({ tag: 'span' }))]),
			steps: [...start, ...Array.from({ length: 3 }, () => perform(domCall(sample, 'cloneNode', [true]))), ...returns('budget was bypassed')]
		},
		expected: { error: 'DOM node allocation budget exceeded' }
	},
	{
		name: 'Named controls preserve native reads, mutation and projection',
		program: {
			version: 1,
			title: 'Named form controls',
			document: form(shadowedNames.map(control)),
			steps: [
				...start,
				perform(domSet(sample, 'className', 'checked')),
				perform(domCall(sample, 'append', ['kept'])),
				...returns(
					array(
						domGet(sample, 'nodeType'),
						domGet(sample, 'localName'),
						domGet(domGet(sample, 'childNodes'), 'length'),
						domGet(sample, 'textContent')
					)
				)
			]
		},
		expected: { result: [1, 'form', 10, 'kept'] }
	},
	{
		name: 'Form childNodes cannot hide nested tree depth',
		program: {
			version: 1,
			title: 'Form depth boundary',
			document: form([control('childNodes')]),
			steps: [...nestedSteps, ...returns('depth was bypassed')]
		},
		expected: { error: 'DOM tree exceeds its depth budget' }
	},
	{
		name: 'Shallow document clones cannot create a second receiver document',
		program: { version: 1, title: 'Document ownership', steps: [declare('doc', domDocument()), ...returns(domCall(doc, 'cloneNode', [false]))] },
		expected: { error: 'DOM receiver belongs to another document' }
	}
];
