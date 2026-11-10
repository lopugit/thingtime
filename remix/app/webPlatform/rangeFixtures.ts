import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	base,
	declare,
	domCall,
	domConstant,
	domConstruct,
	domDocument,
	domGet,
	domSet,
	input,
	object,
	parameter,
	perform,
	recipe,
	variable as v
} from './programBuilders';
const node = (value: unknown) => object({ name: domGet(value, 'nodeName'), text: domGet(value, 'textContent') });
const boundaries = (value: unknown) =>
	object({
		start: domGet(value, 'startOffset'),
		end: domGet(value, 'endOffset'),
		collapsed: domGet(value, 'collapsed'),
		startNode: node(domGet(value, 'startContainer')),
		endNode: node(domGet(value, 'endContainer'))
	});
const snapshot = (value: unknown) => object({ text: domCall(value, 'toString'), boundaries: boundaries(value) });
/** The complete recipe, including native calls and projections, is saved data. */
export function rangeRecipe(f: Feature): Recipe | undefined {
	const iface = f.interface || f.name;
	if (f.language !== 'webapi' || !['Range', 'AbstractRange', 'StaticRange', 'StaticRangeInit'].includes(iface)) return;
	if (f.group === 'CSSOM View Module Level 1') return;
	// Retain the existing active-surface geometry programs.
	if (['getBoundingClientRect', 'getClientRects'].includes(f.member || '')) return;
	const member = f.member || '';
	const parameters: NonNullable<PlatformProgram['parameters']> = [
		parameter('text', 'Document text', 'Hello reusable Things'),
		parameter('start', 'Start offset', 6, 'number'),
		parameter('end', 'End offset', 14, 'number')
	];
	const p = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' = 'text') => {
		parameters.push(parameter(name, label, value, type));
		return input(name);
	};
	const steps: PlatformExpression[] = [
		declare('document', domDocument()),
		declare('sample', domCall(v('document'), 'querySelector', ['#sample'])),
		declare('tail', domCall(v('document'), 'querySelector', ['#tail'])),
		declare('text', domGet(v('sample'), 'firstChild')),
		perform(domSet(v('text'), 'data', input('text'))),
		declare('range', f.kind === 'constructor' && iface === 'Range' ? domConstruct('Range') : domCall(v('document'), 'createRange')),
		perform(domCall(v('range'), 'setStart', [v('text'), input('start')])),
		perform(domCall(v('range'), 'setEnd', [v('text'), input('end')])),
		declare('before', snapshot(v('range')))
	];
	let selected: unknown = snapshot(v('range'));
	if (iface === 'StaticRange' || iface === 'StaticRangeInit') {
		steps.push(
			declare(
				'fixed',
				domConstruct('StaticRange', [
					object({ startContainer: v('text'), startOffset: input('start'), endContainer: v('text'), endOffset: input('end') })
				])
			),
			declare('staticBefore', boundaries(v('fixed'))),
			perform(domCall(v('text'), 'insertData', [0, p('prefix', 'Inserted prefix', 'New ')]))
		);
		selected = object({ staticBefore: v('staticBefore'), staticAfter: boundaries(v('fixed')), liveAfter: snapshot(v('range')) });
	} else if (f.kind === 'attribute') {
		selected = /Container$/.test(member) ? node(domGet(v('range'), member)) : domGet(v('range'), member);
	} else if (f.kind === 'const' || member === 'compareBoundaryPoints') {
		steps.push(declare('other', domCall(v('range'), 'cloneRange')), perform(domCall(v('other'), 'selectNodeContents', [v('sample')])));
		const how = f.kind === 'const' ? domConstant('Range', member) : p('how', 'Boundary comparison mode (0–3)', 0, 'number');
		selected = object({ mode: how, comparison: domCall(v('range'), 'compareBoundaryPoints', [how, v('other')]) });
	} else if (['comparePoint', 'isPointInRange'].includes(member))
		selected = domCall(v('range'), member, [v('text'), p('point', 'Point offset', 10, 'number')]);
	else if (member === 'intersectsNode') selected = domCall(v('range'), member, [v('text')]);
	else if (['cloneContents', 'extractContents', 'createContextualFragment'].includes(member)) {
		steps.push(
			declare(
				'fragment',
				domCall(
					v('range'),
					member,
					member === 'createContextualFragment'
						? [p('html', 'Basic HTML fragment (tags without attributes)', '<strong>Reusable</strong> Things')]
						: []
				)
			),
			declare('fragmentBefore', node(v('fragment'))),
			declare('output', domCall(v('document'), 'querySelector', ['#output'])),
			perform(domCall(v('output'), 'appendChild', [v('fragment')]))
		);
		selected = object({ fragment: v('fragmentBefore'), rendered: domGet(v('output'), 'innerHTML') });
	} else if (member === 'cloneRange') {
		steps.push(
			declare('copy', domCall(v('range'), 'cloneRange')),
			perform(domCall(v('copy'), 'collapse', [p('toStart', 'Collapse clone to start', true, 'boolean')]))
		);
		selected = object({ original: snapshot(v('range')), clone: snapshot(v('copy')) });
	} else if (member === 'surroundContents' || member === 'insertNode') {
		steps.push(
			declare('wrapper', domCall(v('document'), 'createElement', [p('tag', 'Element tag', 'mark')])),
			...(member === 'insertNode' ? [perform(domSet(v('wrapper'), 'textContent', p('insert', 'Inserted text', '[new]')))] : []),
			perform(domCall(v('range'), member, [v('wrapper')]))
		);
		selected = object({ element: node(v('wrapper')), html: domGet(v('sample'), 'innerHTML') });
	} else if (member && f.kind === 'operation') {
		const args =
			member === 'collapse'
				? [p('toStart', 'Collapse to start', true, 'boolean')]
				: ['setStart', 'setEnd'].includes(member)
				? [v('text'), p('offset', 'New boundary offset', member === 'setStart' ? 7 : 13, 'number')]
				: /Before$|After$/.test(member) || member === 'selectNode'
				? [v('tail')]
				: member === 'selectNodeContents'
				? [v('sample')]
				: [];
		steps.push(perform(domCall(v('range'), member, args)));
	}
	steps.push({
		op: 'return',
		value: object({ feature: f.name, before: v('before'), selected, after: snapshot(v('range')), document: domGet(v('sample'), 'innerHTML') })
	});
	return recipe(
		{
			...base(f),
			parameters,
			document: [
				{
					tag: 'p',
					attributes: { id: 'sample' },
					children: ['Hello reusable Things', { tag: 'span', attributes: { id: 'tail' }, children: [' / tail'] }]
				},
				{ tag: 'div', attributes: { id: 'output' } }
			],
			steps
		},
		'interactive',
		'Edit the document, boundaries, operations and result projections. Native ranges operate on a run-owned document; edits are rendered below. Static snapshots retain their original offsets when the live range follows inserted text.'
	);
}
