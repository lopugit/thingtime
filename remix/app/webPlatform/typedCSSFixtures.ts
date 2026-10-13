import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	base,
	recipe,
	parameter,
	input,
	variable as v,
	declare,
	perform,
	domSurface,
	domGet,
	domSet,
	domCall,
	domConstruct,
	domStatic,
	object,
	array,
	get,
	method,
	returns
} from './programBuilders';
const value = v('value'),
	sample = v('sample'),
	map = v('styleMap');
const unit = (n: unknown, u: unknown = 'px') => domConstruct('CSSUnitValue', [n, u]);
const parse = (text: unknown) => domStatic('CSSNumericValue', 'parse', [text]);
const stringify = (x: unknown) => domCall(x, 'toString');
const matrix = (x: unknown) =>
	object(Object.fromEntries('a b c d e f m13 m23 m33 m43 m14 m24 m34 m44 is2D'.split(' ').map((k) => [k, domGet(x, k)])));
const isType = (x: unknown, t: string) => ({ op: 'binary', operator: '===', left: get(x, 'type'), right: t });
// This serializer is authored program data too. It dereferences native handles
// through registered operations, so the saved Component contains its observation.
const describe: PlatformExpression = {
	op: 'function-declaration',
	name: 'describe',
	params: ['item'],
	async: true,
	body: [
		{ op: 'if', test: { op: 'binary', operator: '==', left: v('item'), right: null }, then: returns(v('item')) },
		{
			op: 'if',
			test: method({ op: 'global', name: 'Array' }, 'isArray', [v('item')]),
			then: [
				declare('items', array()),
				{
					op: 'for-of',
					name: 'part',
					value: v('item'),
					body: [perform(method(v('items'), 'push', [{ op: 'await', value: { op: 'call', target: v('describe'), args: [v('part')] } }]))]
				},
				...returns(v('items'))
			]
		},
		{
			op: 'if',
			test: get(v('item'), '$dom'),
			then: [
				{ op: 'if', test: isType(v('item'), 'DOMMatrixReadOnly'), then: returns(matrix(v('item'))) },
				{
					op: 'if',
					test: isType(v('item'), 'CSSVariableReferenceValue'),
					then: returns(
						object({
							variable: domGet(v('item'), 'variable'),
							fallback: { op: 'await', value: { op: 'call', target: v('describe'), args: [domGet(v('item'), 'fallback')] } }
						})
					)
				},
				{
					op: 'if',
					test: isType(v('item'), 'CSSNumericArray'),
					then: returns({ op: 'await', value: { op: 'call', target: v('describe'), args: [domCall(v('item'), 'values')] } })
				},
				...returns(object({ type: get(v('item'), 'type'), text: stringify(v('item')) }))
			]
		},
		...returns(v('item'))
	]
};
const show = (x: unknown) => ({ op: 'await', value: { op: 'call', target: v('describe'), args: [x] } });
const colors: Record<string, { keys: string[]; values: unknown[] }> = {
	CSSRGB: { keys: ['r', 'g', 'b', 'alpha'], values: [0.2, 0.5, 0.8, 1] },
	CSSHSL: { keys: ['h', 's', 'l', 'alpha'], values: [unit(210, 'deg'), 0.6, 0.5, 1] },
	CSSHWB: { keys: ['h', 'w', 'b', 'alpha'], values: [unit(210, 'deg'), 0.2, 0.1, 1] },
	CSSLab: { keys: ['l', 'a', 'b', 'alpha'], values: [0.6, 20, 10, 1] },
	CSSLCH: { keys: ['l', 'c', 'h', 'alpha'], values: [0.6, 40, unit(210, 'deg'), 1] },
	CSSOKLab: { keys: ['l', 'a', 'b', 'alpha'], values: [0.6, 0.1, 0.1, 1] },
	CSSOKLCH: { keys: ['l', 'c', 'h', 'alpha'], values: [0.6, 0.2, unit(210, 'deg'), 1] }
};
const transforms = new Set(
	'CSSTranslate CSSRotate CSSScale CSSSkew CSSSkewX CSSSkewY CSSPerspective CSSMatrixComponent CSSTransformValue CSSTransformComponent CSSMatrixComponentOptions CSSPerspectiveValue'.split(
		' '
	)
);
/** Native values and observations are composed entirely as reusable program data. */
export function typedCSSRecipe(f: Feature): Recipe | null {
	if (f.language !== 'webapi' || f.group !== 'CSS Typed OM Level 1') return null;
	const iface = f.interface || f.name,
		member = f.member || '',
		kind = f.kind;
	const parameters: NonNullable<PlatformProgram['parameters']> = [];
	const add = (name: string, label: string, initial: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => {
		parameters.push(parameter(name, label, initial, type));
		return input(name);
	};
	const steps: PlatformExpression[] = [
		describe,
		declare('surface', domSurface()),
		declare('sample', domCall(v('surface'), 'querySelector', ['#sample'])),
		declare('styleMap', domGet(sample, 'attributeStyleMap'))
	];
	let expression: unknown,
		selected: unknown = null,
		apply: string | undefined,
		special = false;
	const set = (key: string, val: unknown, target: unknown = value) => steps.push(perform(domSet(target, key, val)));
	const amount = (initial = 24) => add('amount', 'Amount', initial, 'number');
	const finish = () =>
		recipe(
			{
				...base(f),
				parameters,
				document: [
					{
						tag: 'div',
						attributes: { class: 'typed-demo' },
						children: [
							{ tag: 'p', children: ['Edit the typed value, run it, and inspect the browser result.'] },
							{ tag: 'div', attributes: { id: 'sample' }, children: ['Thingtime'] }
						]
					}
				],
				styles: [
					{
						selector: '#sample',
						declarations: {
							width: '160px',
							height: '80px',
							padding: '12px',
							'background-color': '#dbeafe',
							color: '#172554',
							'border-radius': '12px',
							'transform-origin': 'center'
						}
					}
				],
				steps
			},
			'interactive',
			'Native CSS Typed OM objects, composed as editable Thingtime program data. Browser support is checked when the operation runs.'
		);
	if (iface === 'CSS') {
		expression = domStatic('CSS', member, [amount(12)]);
	} else if (iface === 'CSSStyleValue' || iface === 'CSSImageValue') {
		const property = add(
			'property',
			'CSS property',
			iface === 'CSSImageValue' ? 'background-image' : member === 'parseAll' ? 'transition-duration' : 'width'
		);
		const text = add(
			'text',
			'CSS value',
			iface === 'CSSImageValue'
				? 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=")'
				: member === 'parseAll'
				? '1s, 2s'
				: '120px'
		);
		expression = domStatic('CSSStyleValue', member === 'parseAll' ? 'parseAll' : 'parse', [property, text]);
		if (member !== 'parseAll') {
			steps.push(declare('value', expression), perform(domCall(map, 'set', [property, value])));
			special = true;
		}
	} else if (iface === 'CSSNumericValue') {
		steps.push(declare('left', parse(add('left', 'First numeric value', '24px'))));
		const left = v('left');
		if (member === 'parse' || !member) expression = left;
		else if (member === 'type') expression = domCall(left, 'type');
		else if (member === 'to' || member === 'toSum') expression = domCall(left, member, [add('unit', 'Target unit', 'cm')]);
		else expression = domCall(left, member, [['mul', 'div'].includes(member) ? amount(2) : parse(add('right', 'Second numeric value', '12px'))]);
	} else if (iface === 'CSSNumericType' || f.name === 'CSSNumericBaseType') {
		const units: Record<string, string> = {
			length: 'px',
			angle: 'deg',
			time: 's',
			frequency: 'hz',
			resolution: 'dpi',
			flex: 'fr',
			percent: 'percent'
		};
		const source = unit(amount(), add('unit', 'Numeric unit', units[member] || 'px'));
		steps.push(declare('number', member === 'percentHint' ? domConstruct('CSSMathSum', [source, unit(10, 'percent')]) : source));
		expression = domCall(v('number'), 'type');
		selected = member ? get(value, member) : value;
		steps.push(declare('value', expression), ...returns(object({ feature: f.name, source: show(v('number')), numericType: value, selected })));
		return finish();
	} else if (iface === 'CSSUnitValue' || f.name === 'CSSNumberish') {
		expression = unit(amount(), add('unit', 'Numeric unit', 'px'));
		if (kind === 'attribute' && member === 'value') {
			steps.push(declare('value', unit(12, 'px')), declare('before', show(value)));
			set('value', input('amount'));
			special = true;
		}
	} else if (iface.startsWith('CSSMath') || iface === 'CSSNumericArray') {
		const ctor = iface === 'CSSMathValue' || iface === 'CSSMathOperator' || iface === 'CSSNumericArray' ? 'CSSMathSum' : iface;
		const left = parse(add('left', 'First numeric value', ctor === 'CSSMathInvert' ? '4' : '24px'));
		const right = ['CSSMathSum', 'CSSMathMin', 'CSSMathMax'].includes(ctor) ? parse(add('right', 'Second numeric value', '12px')) : amount(2);
		expression = domConstruct(
			ctor,
			ctor === 'CSSMathClamp' ? [unit(10), left, unit(60)] : ['CSSMathNegate', 'CSSMathInvert'].includes(ctor) ? [left] : [left, right]
		);
		if (iface === 'CSSNumericArray') expression = domGet(expression, 'values');
		if (iface === 'CSSMathOperator') selected = domGet(value, 'operator');
	} else if (transforms.has(iface)) {
		const name =
			iface === 'CSSTransformComponent'
				? 'CSSRotate'
				: iface === 'CSSPerspectiveValue'
				? 'CSSPerspective'
				: iface === 'CSSMatrixComponentOptions'
				? 'CSSMatrixComponent'
				: iface;
		let args: unknown[] = [];
		if (name === 'CSSTranslate') args = [unit(amount()), unit(12), unit(8)];
		if (name === 'CSSRotate') args = [0, 0, 1, unit(amount(30), 'deg')];
		if (name === 'CSSScale') args = [amount(1.2), 1.1, 1];
		if (name === 'CSSSkew') args = [unit(amount(15), 'deg'), unit(5, 'deg')];
		if (name === 'CSSSkewX' || name === 'CSSSkewY') args = [unit(amount(15), 'deg')];
		if (name === 'CSSPerspective') args = [unit(amount(300))];
		if (name === 'CSSMatrixComponent')
			args = [
				domConstruct('DOMMatrix', [add('matrix', 'Matrix entries', [1, 0.1, 0.2, 1, 24, 12], 'json')]),
				object({ is2D: add('is2D', 'Two-dimensional matrix', true, 'boolean') })
			];
		if (name === 'CSSTransformValue')
			args = [array(domConstruct('CSSTranslate', [unit(amount()), unit(12)]), domConstruct('CSSRotate', [unit(15, 'deg')]))];
		expression = domConstruct(name, args);
		steps.push(declare('value', expression), declare('before', show(value)));
		special = true;
		if (kind === 'attribute' && !f.readonly) {
			let replacement: unknown;
			if (member === 'is2D') replacement = add('replacement', 'Two-dimensional transform', false, 'boolean');
			else if (member === 'matrix') replacement = domConstruct('DOMMatrix', [add('replacement', 'Edited matrix', [1, 0, 0, 1, 48, 16], 'json')]);
			else {
				const n = add(
					'replacement',
					'Edited ' + member,
					member === 'length' ? 400 : member === 'angle' || member === 'ax' || member === 'ay' ? 45 : 2,
					'number'
				);
				replacement =
					name === 'CSSScale' || (name === 'CSSRotate' && member !== 'angle')
						? n
						: unit(n, member === 'angle' || member === 'ax' || member === 'ay' ? 'deg' : 'px');
			}
			set(member, replacement);
		}
		steps.push(
			declare('transform', name === 'CSSTransformValue' ? value : domConstruct('CSSTransformValue', [array(value)])),
			perform(domCall(map, 'set', ['transform', v('transform')]))
		);
		if (member === 'toMatrix') steps.push(declare('matrixResult', domCall(value, 'toMatrix')));
		selected =
			member === 'toMatrix'
				? matrix(v('matrixResult'))
				: kind === 'iterable'
				? show(domCall(value, 'values'))
				: kind === 'attribute'
				? show(domGet(value, member))
				: iface === 'CSSMatrixComponentOptions'
				? domGet(value, 'is2D')
				: show(value);
		steps.push(
			...returns(
				object({
					feature: f.name,
					before: v('before'),
					value: show(value),
					selected,
					computed: show(domCall(domCall(sample, 'computedStyleMap'), 'get', ['transform']))
				})
			)
		);
		return finish();
	} else if (iface === 'CSSKeywordValue' || f.name === 'CSSKeywordish') {
		expression = domConstruct('CSSKeywordValue', [add('keyword', 'Display keyword', 'grid')]);
		apply = 'display';
		if (kind === 'attribute') {
			steps.push(declare('value', domConstruct('CSSKeywordValue', ['block'])), declare('before', show(value)));
			set('value', input('keyword'));
			special = true;
		}
	} else if (['CSSUnparsedValue', 'CSSVariableReferenceValue', 'CSSUnparsedSegment'].includes(iface)) {
		const fallback = domConstruct('CSSUnparsedValue', [array(add('fallback', 'Fallback value', '120px'))]);
		const reference = domConstruct('CSSVariableReferenceValue', [add('variable', 'Custom property name', '--demo-width'), fallback]);
		steps.push(
			declare('reference', reference),
			declare('unparsed', domConstruct('CSSUnparsedValue', [array(v('reference'))])),
			perform(domCall(map, 'set', ['width', v('unparsed')]))
		);
		expression = iface === 'CSSVariableReferenceValue' ? v('reference') : v('unparsed');
		if (kind === 'attribute' && member === 'variable') {
			steps.push(declare('value', expression), declare('before', show(value)));
			set('variable', add('replacement', 'Edited custom property name', '--other-width'));
			special = true;
		}
	} else if (iface in colors || iface === 'CSSColor' || iface === 'CSSColorValue' || f.name.startsWith('CSSColor')) {
		let name = iface;
		if (f.kind === 'typedef') name = f.name === 'CSSColorAngle' ? 'CSSHSL' : 'CSSRGB';
		if (name === 'CSSColorValue') {
			expression = domStatic('CSSColorValue', 'parse', [add('text', 'Colour value', 'oklch(65% .2 250)')]);
		} else if (name === 'CSSColor') {
			expression = domConstruct('CSSColor', [
				add('space', 'Colour space', 'display-p3'),
				add('channels', 'Colour channels', [0.2, 0.5, 0.8], 'json'),
				add('alpha', 'Alpha', 0.8, 'number')
			]);
		} else {
			const config = colors[name];
			const args = [...config.values];
			args[0] = name === 'CSSHSL' || name === 'CSSHWB' ? unit(amount(210), 'deg') : amount(0.4);
			expression = domConstruct(name, args);
		}
		if (kind === 'attribute' && !f.readonly) {
			steps.push(declare('value', expression), declare('before', show(value)));
			special = true;
			set(
				member,
				member === 'channels'
					? add('replacement', 'Edited channels', [0.8, 0.3, 0.1], 'json')
					: member === 'colorSpace'
					? add('replacement', 'Edited colour space', 'srgb')
					: member === 'h'
					? unit(add('replacement', 'Edited hue', 120, 'number'), 'deg')
					: add('replacement', 'Edited ' + member, 0.7, 'number')
			);
		}
		apply = 'background-color';
	} else if (['StylePropertyMap', 'StylePropertyMapReadOnly', 'ElementCSSInlineStyle', 'Element', 'CSSStyleRule'].includes(iface)) {
		const property = add('property', 'CSS property', member === 'append' ? 'transition-duration' : 'width');
		const text = add('text', 'CSS value', member === 'append' ? '1s' : '120px');
		steps.push(perform(domCall(map, 'set', [property, text])));
		if (iface === 'CSSStyleRule') {
			steps.push(
				declare('sheet', domConstruct('CSSStyleSheet')),
				perform(domCall(v('sheet'), 'insertRule', ['.sample { width: 24px; }', 0])),
				declare('rule', domCall(domGet(v('sheet'), 'cssRules'), 'item', [0])),
				declare('ruleMap', domGet(v('rule'), 'styleMap')),
				perform(domCall(v('ruleMap'), 'set', [property, text]))
			);
			expression = v('ruleMap');
		} else
			expression = iface === 'Element' || (iface === 'StylePropertyMapReadOnly' && kind !== 'iterable') ? domCall(sample, 'computedStyleMap') : map;
		steps.push(declare('value', expression), declare('before', show(domCall(value, 'getAll', [property]))));
		if (['set', 'append', 'delete', 'clear'].includes(member))
			steps.push(
				perform(
					domCall(
						value,
						member,
						member === 'clear'
							? []
							: member === 'delete'
							? [property]
							: [property, add('edited', 'Edited CSS value', member === 'append' ? '2s' : '200px')]
					)
				)
			);
		selected =
			member === 'has'
				? domCall(value, 'has', [property])
				: member === 'size'
				? domGet(value, 'size')
				: kind === 'iterable'
				? show(domCall(value, 'entries'))
				: show(domCall(value, member === 'getAll' ? 'getAll' : 'get', [property]));
		steps.push(
			...returns(
				object({
					feature: f.name,
					before: v('before'),
					selected,
					after: show(domCall(value, 'getAll', [property])),
					size: domGet(value, 'size'),
					computed: show(domCall(domCall(sample, 'computedStyleMap'), 'getAll', [property]))
				})
			)
		);
		return finish();
	} else return null;
	if (!special) steps.push(declare('value', expression));
	if (apply) steps.push(perform(domCall(map, 'set', [apply, value])));
	if (selected === null) {
		if (kind === 'attribute') selected = show(domGet(value, member));
		else if (kind === 'iterable') selected = show(domCall(value, 'values'));
		else selected = show(value);
	}
	steps.push(
		...returns(
			object({
				feature: f.name,
				...(iface === 'CSSNumericValue' ? { source: show(v('left')) } : {}),
				value: show(value),
				selected,
				...(apply ? { computed: show(domCall(domCall(sample, 'computedStyleMap'), 'get', [apply])) } : {})
			})
		)
	);
	return finish();
}
