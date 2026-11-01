import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import { ARIA_ELEMENT, ARIA_REFERENCES } from './ariaPolicy';
import {
	array,
	awaited,
	base,
	call,
	declare,
	domCall,
	domGet,
	domSet,
	domSurface,
	global,
	input,
	method,
	object,
	parameter,
	perform,
	recipe,
	returns,
	variable as v
} from './programBuilders';

const values: Record<string, string> = {
	role: 'group',
	ariaAutoComplete: 'list',
	ariaChecked: 'mixed',
	ariaColCount: '4',
	ariaColIndex: '2',
	ariaColIndexText: 'Second column',
	ariaColSpan: '2',
	ariaCurrent: 'page',
	ariaHasPopup: 'menu',
	ariaInvalid: 'grammar',
	ariaKeyShortcuts: 'Alt+S',
	ariaLevel: '2',
	ariaLive: 'polite',
	ariaOrientation: 'horizontal',
	ariaPosInSet: '2',
	ariaPressed: 'mixed',
	ariaRelevant: 'additions text',
	ariaRowCount: '5',
	ariaRowIndex: '2',
	ariaRowIndexText: 'Second row',
	ariaRowSpan: '2',
	ariaSetSize: '5',
	ariaSort: 'ascending',
	ariaValueMax: '100',
	ariaValueMin: '0',
	ariaValueNow: '25',
	ariaValueText: 'One quarter',
	ariaBrailleLabel: 'Save',
	ariaBrailleRoleDescription: 'Action',
	ariaDescription: 'Saved Thingtime description',
	ariaLabel: 'Save draft',
	ariaPlaceholder: 'Write a label',
	ariaRoleDescription: 'Reusable example'
};
const roleFor = (key: string) =>
	/ColCount|RowCount/.test(key)
		? 'table'
		: /Col|Row/.test(key)
		? 'cell'
		: /Value/.test(key)
		? 'progressbar'
		: /Checked/.test(key)
		? 'checkbox'
		: /Pressed|Expanded|HasPopup/.test(key)
		? 'button'
		: /Selected|PosInSet|SetSize/.test(key)
		? 'option'
		: /Level/.test(key)
		? 'heading'
		: /Sort/.test(key)
		? 'columnheader'
		: /AutoComplete|MultiLine|ReadOnly|Required|Placeholder|Invalid/.test(key)
		? 'textbox'
		: /MultiSelectable|Orientation|ActiveDescendant/.test(key)
		? 'listbox'
		: /Modal/.test(key)
		? 'dialog'
		: 'group';
const show = (value: unknown) => awaited(call(v('describeARIA'), [value]));
const describe: PlatformExpression = {
	op: 'function-declaration',
	name: 'describeARIA',
	params: ['item'],
	async: true,
	body: [
		{ op: 'if', test: { op: 'binary', operator: '===', left: v('item'), right: null }, then: returns(null) },
		{
			op: 'if',
			test: method(global('Array'), 'isArray', [v('item')]),
			then: [
				declare('items', array()),
				{ op: 'for-of', name: 'part', value: v('item'), body: [perform(method(v('items'), 'push', [show(v('part'))]))] },
				...returns(object({ elements: v('items'), frozen: method(global('Object'), 'isFrozen', [v('item')]) }))
			]
		},
		{
			op: 'if',
			test: { op: 'binary', operator: '===', left: { op: 'unary', operator: 'typeof', value: v('item') }, right: 'object' },
			then: returns(object({ id: domGet(v('item'), 'id'), text: domGet(v('item'), 'textContent') }))
		},
		...returns(v('item'))
	]
};

/** All values, native operations, element relationships and result projections are editable saved data. */
export function ariaRecipe(f: Feature): Recipe | undefined {
	if (f.language !== 'webapi' || (f.interface || f.name) !== 'ARIAMixin') return;
	const member = f.member || 'ariaLabel';
	if (!ARIA_ELEMENT.reads.split(' ').includes(member)) return;
	const multiple = ARIA_REFERENCES.includes(member),
		reference = multiple || member === 'ariaActiveDescendantElement';
	const attribute =
		member === 'role'
			? 'role'
			: 'aria-' +
			  member
					.slice(4)
					.replace(/Elements?$/, '')
					.toLowerCase();
	const parameters: NonNullable<PlatformProgram['parameters']> = [
		parameter('role', 'Example role', roleFor(member)),
		parameter(
			reference ? 'selector' : 'value',
			reference ? 'Referenced element selector' : 'Property value (string or null)',
			reference ? (multiple ? '#first, #second' : '#first') : values[member] || 'true',
			reference ? 'text' : 'json'
		),
		parameter('attributeValue', 'Reflected content attribute', reference ? 'second' : values[member] || 'false'),
		parameter('clear', 'Clear the property after the demonstration', false, 'boolean')
	];
	const chosen = reference
		? multiple
			? domCall(domCall(v('root'), 'querySelectorAll', [input('selector')]), 'values')
			: domCall(v('root'), 'querySelector', [input('selector')])
		: input('value');
	const steps: PlatformExpression[] = [
		describe,
		declare('root', domSurface()),
		declare('sample', domCall(v('root'), 'querySelector', ['#sample'])),
		perform(domSet(v('sample'), 'role', input('role'))),
		declare('chosen', chosen),
		perform(domSet(v('sample'), member, v('chosen'))),
		declare('assigned', show(domGet(v('sample'), member))),
		declare('assignedAttribute', domCall(v('sample'), 'getAttribute', [attribute])),
		perform(domCall(v('sample'), 'setAttribute', [attribute, input('attributeValue')])),
		declare('fromAttribute', show(domGet(v('sample'), member))),
		perform(domSet(v('sample'), member, v('chosen'))),
		{ op: 'if', test: input('clear'), then: [perform(domSet(v('sample'), member, null))] },
		...returns(
			object({
				feature: f.name,
				property: member,
				assigned: v('assigned'),
				assignedAttribute: v('assignedAttribute'),
				fromAttribute: v('fromAttribute'),
				final: show(domGet(v('sample'), member)),
				finalAttribute: domCall(v('sample'), 'getAttribute', [attribute])
			})
		)
	];
	return recipe(
		{
			...base(f),
			parameters,
			document: [
				{
					tag: 'section',
					attributes: { class: 'aria-demo' },
					children: [
						{ tag: 'div', attributes: { id: 'sample', 'aria-label': 'Reusable Thingtime example' }, children: ['Reusable accessible object'] },
						{ tag: 'p', attributes: { id: 'first' }, children: ['First reusable description'] },
						{ tag: 'p', attributes: { id: 'second' }, children: ['Second reusable description'] }
					]
				}
			],
			styles: [
				{ selector: '.aria-demo', declarations: { padding: '20px', background: '#f0fdfa', color: '#134e4a', 'border-radius': '12px' } },
				{ selector: '#sample', declarations: { padding: '12px', border: '1px solid #14b8a6', 'border-radius': '8px' } },
				{ selector: 'p', declarations: { margin: '12px 0 0' } }
			],
			steps
		},
		'interactive',
		'Edit native ARIA properties, content attributes and element relationships. The result compares property assignment with attribute reflection, including null and frozen reference lists. This is a reflection demonstration; complete widgets also need appropriate semantics and keyboard behavior.'
	);
}
