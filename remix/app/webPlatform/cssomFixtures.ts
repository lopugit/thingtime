import type { Feature, PlatformExpression, PlatformProgram, Recipe } from './types';
import {
	base,
	recipe,
	parameter,
	input,
	variable as v,
	declare,
	perform,
	domDocument,
	domSurface,
	domGet,
	domSet,
	domCall,
	domConstruct,
	domStatic,
	domConstant,
	object,
	array,
	get,
	method,
	returns,
	awaited,
	call
} from './programBuilders';
const eq = (a: unknown, b: unknown) => ({ op: 'binary', operator: '===', left: a, right: b });
const show = (value: unknown) => awaited(call(v('describeCSSOM'), [value]));
/** Observations are saved program data, not catalogue-specific runtime code. */
const describe: PlatformExpression = {
	op: 'function-declaration',
	name: 'describeCSSOM',
	params: ['item'],
	async: true,
	body: [
		{ op: 'if', test: { op: 'binary', operator: '==', left: v('item'), right: null }, then: returns(v('item')) },
		{
			op: 'if',
			test: method({ op: 'global', name: 'Array' }, 'isArray', [v('item')]),
			then: [
				declare('parts', array()),
				{ op: 'for-of', name: 'part', value: v('item'), body: [perform(method(v('parts'), 'push', [show(v('part'))]))] },
				...returns(v('parts'))
			]
		},
		{
			op: 'if',
			test: get(v('item'), '$dom'),
			then: [
				declare('type', get(v('item'), 'type')),
				...['CSSRuleList', 'StyleSheetList'].map((type) => ({
					op: 'if',
					test: eq(v('type'), type),
					then: [
						declare('items', array()),
						declare('length', domGet(v('item'), 'length')),
						{
							op: 'for-of',
							name: 'index',
							value: method({ op: 'global', name: 'Array' }, 'from', [
								object({ length: v('length') }),
								{ op: 'function', params: ['unused', 'i'], value: v('i') }
							]),
							body: [perform(method(v('items'), 'push', [show(domCall(v('item'), 'item', [v('index')]))]))]
						},
						...returns(object({ type: v('type'), length: v('length'), items: v('items') }))
					]
				})),
				{
					op: 'if',
					test: eq(v('type'), 'CSSStyleDeclaration'),
					then: returns(object({ type: v('type'), text: domGet(v('item'), 'cssText'), length: domGet(v('item'), 'length') }))
				},
				{
					op: 'if',
					test: eq(v('type'), 'MediaList'),
					then: returns(object({ type: v('type'), text: domGet(v('item'), 'mediaText'), length: domGet(v('item'), 'length') }))
				},
				{
					op: 'if',
					test: eq(v('type'), 'CSSStyleSheet'),
					then: [
						{
							op: 'try',
							body: returns(
								object({
									type: v('type'),
									disabled: domGet(v('item'), 'disabled'),
									media: show(domGet(v('item'), 'media')),
									rules: show(domGet(v('item'), 'cssRules'))
								})
							),
							error: 'readError',
							catch: returns(
								object({
									type: v('type'),
									href: domGet(v('item'), 'href'),
									error: object({ name: get(v('readError'), 'name'), message: get(v('readError'), 'message') })
								})
							)
						}
					]
				},
				{
					op: 'if',
					test: method(
						array('CSSStyleRule', 'CSSGroupingRule', 'CSSPageRule', 'CSSMarginRule', 'CSSImportRule', 'CSSNamespaceRule', 'CSSRule'),
						'includes',
						[v('type')]
					),
					then: returns(object({ type: v('type'), text: domGet(v('item'), 'cssText') }))
				},
				{
					op: 'if',
					test: eq(v('type'), 'ShadowRoot'),
					then: returns(object({ type: v('type'), adopted: show(domGet(v('item'), 'adoptedStyleSheets')) }))
				},
				...returns(object({ type: v('type'), name: domGet(v('item'), 'nodeName'), text: domGet(v('item'), 'textContent') }))
			]
		},
		...returns(v('item'))
	]
};
const pageValues: Record<string, string> = {
	bleed: '6px',
	margin: '24px',
	marginTop: '24px',
	marginRight: '24px',
	marginBottom: '24px',
	marginLeft: '24px',
	'margin-top': '24px',
	'margin-right': '24px',
	'margin-bottom': '24px',
	'margin-left': '24px',
	marks: 'crop',
	pageOrientation: 'rotate-left',
	'page-orientation': 'rotate-left',
	size: 'a4'
};
export function cssomRecipe(f: Feature): Recipe | null {
	if (f.language !== 'webapi' || f.spec !== 'https://drafts.csswg.org/cssom-1/') return null;
	const iface = f.interface || f.name,
		member = f.member || '';
	const ps: NonNullable<PlatformProgram['parameters']> = [];
	const add = (name: string, label: string, value: unknown, type: 'text' | 'number' | 'boolean' | 'json' = 'text') => {
		ps.push(parameter(name, label, value, type));
		return input(name);
	};
	const steps: PlatformExpression[] = [describe];
	let selected: unknown = null,
		target: unknown = v('sheet'),
		snapshot: unknown = v('sheet');
	let shadowSample = false;
	let note = 'Edit native CSS rules and declarations as reusable Thingtime program data. The result is read from the browser.';
	const set = (target: unknown, key: string, val: unknown) => steps.push(perform(domSet(target, key, val)));
	const invoke = (target: unknown, key: string, args: unknown[] = []) => steps.push(declare('operation', domCall(target, key, args)));
	const surface = () => steps.push(declare('surface', domSurface()), declare('sample', domCall(v('surface'), 'querySelector', ['#sample'])));
	const detached = (text: unknown) =>
		steps.push(
			declare('document', domDocument()),
			declare('styleElement', domCall(v('document'), 'createElement', ['style'])),
			perform(domSet(v('styleElement'), 'textContent', text)),
			perform(domCall(domGet(v('document'), 'body'), 'appendChild', [v('styleElement')])),
			declare('sheet', domGet(v('styleElement'), 'sheet'))
		);
	const constructed = (options: unknown = object({})) => steps.push(declare('sheet', domConstruct('CSSStyleSheet', [options])));
	const firstRule = (sheet: unknown = v('sheet')) => domCall(domGet(sheet, 'cssRules'), 'item', [0]);
	const finish = () => {
		steps.push(...returns(object({ feature: f.name, selected: show(selected), value: show(snapshot) })));
		return recipe(
			{
				...base(f),
				parameters: ps,
				document: [
					{ tag: 'p', children: ['Edit the CSS, run it, and inspect the browser result.'] },
					{ tag: 'div', attributes: { id: 'sample' }, children: ['Thingtime CSSOM'] },
					{ tag: 'div', attributes: { id: '[[identifier]]' }, children: ['Escaped selector target'] }
				],
				styles: [
					{
						selector: '#sample',
						declarations: {
							padding: '12px',
							'background-color': '#dbeafe',
							...(shadowSample ? {} : { color: '#172554', width: '160px' }),
							'border-radius': '12px',
							'min-height': '48px'
						}
					}
				],
				steps
			},
			'interactive',
			note
		);
	};
	if (iface === 'CSS') {
		const identifier = add('identifier', 'Identifier', 'demo:1');
		surface();
		steps.push(
			declare('escaped', domStatic('CSS', 'escape', [identifier])),
			declare('found', domCall(v('surface'), 'querySelector', [{ op: 'binary', operator: '+', left: '#', right: v('escaped') }]))
		);
		selected = v('escaped');
		snapshot = object({ escaped: v('escaped'), matchedId: domGet(v('found'), 'id') });
		return finish();
	}
	if (iface === 'Window') {
		const css = add('css', 'Inline CSS', 'width: 120px; color: rgb(25, 70, 160)');
		surface();
		set(domGet(v('sample'), 'style'), 'cssText', css);
		selected = domStatic('Window', 'getComputedStyle', [v('sample')]);
		snapshot = object({ width: domCall(selected, 'getPropertyValue', ['width']), color: domCall(selected, 'getPropertyValue', ['color']) }); // Do not serialize hundreds of computed properties.
		selected = snapshot;
		return finish();
	}
	const adoption = iface === 'DocumentOrShadowRoot' && member !== 'styleSheets';
	const baseURL = iface === 'CSSStyleSheetInit' && member === 'baseURL';
	if (adoption || baseURL) {
		shadowSample = true;
		surface();
		steps.push(declare('shadow', domCall(v('sample'), 'attachShadow', [object({ mode: 'open' })])));
		const css = baseURL
			? ':host {background-image: url(asset.png); width: 120px;} :host::before {content:"Thingtime CSSOM"}'
			: add('css', 'Adopted stylesheet', ':host {width:120px; color:rgb(25,70,160)} :host::before {content:"Thingtime CSSOM"}');
		const url = baseURL ? add('baseURL', 'CSS base URL', 'https://example.invalid/a/') : null;
		constructed(baseURL ? object({ baseURL: url }) : object({}));
		invoke(v('sheet'), 'replaceSync', [css]);
		set(v('shadow'), 'adoptedStyleSheets', array(v('sheet')));
		selected = domGet(v('shadow'), 'adoptedStyleSheets');
		snapshot = object({
			adopted: show(selected),
			computedWidth: domCall(domStatic('Window', 'getComputedStyle', [v('sample')]), 'getPropertyValue', ['width'])
		});
		if (baseURL) {
			steps.push(declare('resolved', domCall(domStatic('Window', 'getComputedStyle', [v('sample')]), 'getPropertyValue', ['background-image'])), {
				op: 'if',
				test: { op: 'unary', operator: '!', value: method(v('resolved'), 'includes', [url]) },
				then: returns(object({ status: 'unsupported', message: 'This browser does not apply CSSStyleSheetInit.baseURL.', observed: v('resolved') }))
			});
			selected = v('resolved');
			snapshot = v('resolved');
		}
		return finish();
	}
	if (['CSSStyleDeclaration', 'CSSStyleProperties', 'ElementCSSInlineStyle'].includes(iface)) {
		const css = add('css', 'Inline CSS', 'width: 120px; color: rgb(25, 70, 160); float: left;');
		if (member === 'parentRule') {
			detached({ op: 'binary', operator: '+', left: { op: 'binary', operator: '+', left: '#sample {', right: css }, right: '}' });
			steps.push(declare('declaration', domGet(firstRule(), 'style')));
		} else {
			surface();
			steps.push(declare('declaration', domGet(v('sample'), 'style')));
			set(v('declaration'), 'cssText', css);
		}
		target = v('declaration');
		snapshot = target;
		if (member === 'setProperty')
			invoke(target, member, [add('property', 'Property', 'width'), add('value', 'New value', '180px'), add('priority', 'Priority', 'important')]);
		else if (member === 'removeProperty') invoke(target, member, [add('property', 'Property', 'width')]);
		else if (['getPropertyValue', 'getPropertyPriority'].includes(member)) {
			if (member === 'getPropertyPriority') invoke(target, 'setProperty', ['width', '120px', add('priority', 'Priority', 'important')]);
			selected = domCall(target, member, [add('property', 'Property', 'width')]);
		} else if (member === 'item') selected = domCall(target, member, [add('index', 'Property index', 0, 'number')]);
		else if (member === 'cssFloat' || iface === 'CSSStyleProperties') {
			set(target, 'cssFloat', add('value', 'Float value', 'right'));
			selected = domGet(target, 'cssFloat');
		} else if (member && member !== 'style') selected = domGet(target, member);
		else selected = target;
		if (['setProperty', 'removeProperty'].includes(member)) selected = v('operation');
		return finish();
	}
	if (iface === 'CSSStyleSheetInit' || (iface === 'CSSStyleSheet' && ['constructor', 'replace', 'replaceSync'].includes(member))) {
		const options =
			iface === 'CSSStyleSheetInit' && member === 'disabled'
				? object({ disabled: add('disabled', 'Disabled', true, 'boolean') })
				: iface === 'CSSStyleSheetInit' && member === 'media'
				? object({ media: add('media', 'Media query', 'screen') })
				: add('options', 'Stylesheet options', { media: 'screen', disabled: false }, 'json');
		surface();
		constructed(options);
		invoke(v('sheet'), member === 'replace' ? 'replace' : 'replaceSync', [add('css', 'Stylesheet', '#sample {width: 120px; color: blue}')]);
		selected = member === 'replace' ? v('operation') : v('sheet');
		return finish();
	}
	if (iface === 'MediaList' || (iface === 'StyleSheet' && ['media', 'disabled'].includes(member))) {
		surface();
		constructed(object({ media: add('media', 'Media queries', 'screen') }));
		steps.push(declare('mediaList', domGet(v('sheet'), 'media')));
		target = iface === 'MediaList' ? v('mediaList') : v('sheet');
		snapshot = target;
		if (member === 'disabled') {
			set(target, member, add('disabled', 'Disabled', true, 'boolean'));
			selected = domGet(target, member);
		} else if (member === 'appendMedium') {
			invoke(target, member, [add('medium', 'Append query', 'print')]);
			selected = target;
		} else if (member === 'deleteMedium') {
			invoke(target, member, [add('medium', 'Delete query', 'screen')]);
			selected = target;
		} else if (member === 'mediaText') {
			set(target, member, add('replacement', 'Replacement queries', 'print'));
			selected = domGet(target, member);
		} else if (member === 'item') selected = domCall(target, member, [add('index', 'Query index', 0, 'number')]);
		else selected = member ? domGet(target, member) : target;
		return finish();
	}
	let css: unknown;
	if (iface === 'CSSImportRule') {
		css = add('css', 'Import rule', '@import url("data:text/css,p%7Bcolor%3Ablue%7D") layer(demo) supports(display:grid) screen;');
		note += ' Imported resource loading is restricted by the isolated runtime CSP; styleSheet may be null.';
	} else if (iface === 'CSSNamespaceRule') css = add('css', 'Namespace rule', '@namespace demo "urn:thingtime:demo";');
	else if (['CSSPageRule', 'CSSPageDescriptors', 'CSSMarginRule'].includes(iface))
		css = add('css', 'Page rule', '@page :first {size: a4; margin: 20px; @top-left {content: "Thingtime"}}');
	else if (iface === 'CSSGroupingRule' || (iface === 'CSSRule' && member === 'parentRule'))
		css = add('css', 'Grouped rules', '@media screen {#sample {width: 120px; color: blue}}');
	else css = add('css', 'Stylesheet', '#sample {width: 120px; color: blue}');
	detached(css);
	snapshot = v('sheet');
	if (['StyleSheetList', 'DocumentOrShadowRoot'].includes(iface)) {
		target = domGet(v('document'), 'styleSheets');
		selected =
			member === 'item'
				? domCall(target, 'item', [add('index', 'Sheet index', 0, 'number')])
				: member === 'length'
				? domGet(target, 'length')
				: target;
		return finish();
	}
	if (iface === 'LinkStyle') {
		selected = domGet(v('styleElement'), 'sheet');
		return finish();
	}
	if (iface === 'CSSRuleList') {
		target = domGet(v('sheet'), 'cssRules');
		selected =
			member === 'item'
				? domCall(target, 'item', [add('index', 'Rule index', 0, 'number')])
				: member === 'length'
				? domGet(target, 'length')
				: target;
		return finish();
	}
	if (['CSSStyleSheet', 'StyleSheet'].includes(iface)) target = v('sheet');
	else {
		steps.push(declare('rule', firstRule()));
		target = v('rule');
	}
	if (iface === 'CSSMarginRule') {
		steps.push(declare('marginRule', domCall(domGet(target, 'cssRules'), 'item', [0])));
		target = v('marginRule');
	}
	if (iface === 'CSSPageDescriptors') {
		steps.push(declare('declaration', domGet(target, 'style')));
		target = v('declaration');
		if (member) {
			set(target, member, add('value', 'Descriptor value', pageValues[member]));
			selected = domGet(target, member);
		} else selected = target;
		snapshot = target;
		return finish();
	}
	if (iface === 'CSSRule' && member === 'parentRule') {
		steps.push(declare('child', domCall(domGet(target, 'cssRules'), 'item', [0])));
		target = v('child');
	}
	if (f.kind === 'const') selected = domConstant('CSSRule', member);
	else if (['insertRule', 'addRule'].includes(member)) {
		invoke(
			target,
			member,
			member === 'insertRule'
				? [add('rule', 'New rule', '#sample {width: 180px; color: rebeccapurple}'), 0]
				: [add('selector', 'Selector', '#sample'), add('declarations', 'Declarations', 'width: 180px; color: rebeccapurple'), 0]
		);
		selected = v('operation');
	} else if (['deleteRule', 'removeRule'].includes(member)) {
		invoke(target, member, [add('index', 'Rule index', 0, 'number')]);
		selected = v('operation');
	} else if (member === 'selectorText') {
		set(target, member, add('selector', 'Selector', iface === 'CSSPageRule' ? ':left' : '#sample, .demo'));
		selected = domGet(target, member);
	} else if (member === 'cssText') {
		steps.push(declare('priorRule', domGet(target, member)));
		set(target, member, add('replacement', 'Replacement rule', '#sample {width: 180px}'));
		selected = object({ before: v('priorRule'), after: domGet(target, member), unchanged: eq(v('priorRule'), domGet(target, member)) });
		note += ' The CSSRule.cssText setter is a native no-op; edit the initial stylesheet to change its serialization.';
	} else selected = member ? domGet(target, member) : target;
	return finish();
}
