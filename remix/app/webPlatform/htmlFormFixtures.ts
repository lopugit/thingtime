import type { Feature, PlatformExpression, PlatformNode, PlatformProgram, Recipe } from './types';
import { HTML_FORM_RECEIVER_POLICY } from './htmlFormPolicy';
import {
	array,
	base,
	declare,
	domCall,
	domDocument,
	domGet,
	domSet,
	get,
	input,
	object,
	parameter,
	perform,
	recipe,
	returns,
	variable
} from './programBuilders';

const doc = variable('doc'),
	sample = variable('sample'),
	receiver = variable('receiver');
const form = variable('form'),
	control = variable('control');
const p = (name: string, value: unknown, type: 'text' | 'number' | 'boolean' = 'text') =>
	parameter(name, name[0].toUpperCase() + name.slice(1), value, type);
const tags: Record<string, string> = {
	HTMLInputElement: 'input',
	HTMLTextAreaElement: 'textarea',
	HTMLSelectElement: 'select',
	HTMLOptionElement: 'option',
	HTMLOptGroupElement: 'optgroup',
	HTMLButtonElement: 'button',
	HTMLFormElement: 'form',
	HTMLFieldSetElement: 'fieldset',
	HTMLLegendElement: 'legend',
	HTMLLabelElement: 'label',
	HTMLDataListElement: 'datalist',
	HTMLOutputElement: 'output',
	HTMLMeterElement: 'meter',
	HTMLProgressElement: 'progress'
};
const profiles: Record<string, string[]> = {
	HTMLInputElement: [
		'type',
		'value',
		'defaultValue',
		'checked',
		'indeterminate',
		'disabled',
		'required',
		'willValidate',
		'selectionStart',
		'selectionEnd',
		'selectionDirection'
	],
	HTMLTextAreaElement: ['value', 'defaultValue', 'textLength', 'selectionStart', 'selectionEnd', 'selectionDirection'],
	HTMLSelectElement: ['value', 'length', 'selectedIndex', 'multiple', 'type'],
	HTMLOptionElement: ['value', 'text', 'label', 'selected', 'defaultSelected', 'index'],
	HTMLOptGroupElement: ['label', 'disabled'],
	HTMLButtonElement: ['type', 'value', 'disabled', 'willValidate'],
	HTMLFormElement: ['length', 'method', 'enctype', 'noValidate'],
	HTMLFieldSetElement: ['type', 'name', 'disabled', 'willValidate'],
	HTMLLegendElement: ['textContent'],
	HTMLLabelElement: ['htmlFor', 'textContent'],
	HTMLDataListElement: ['id'],
	HTMLOutputElement: ['value', 'defaultValue', 'type'],
	HTMLMeterElement: ['min', 'max', 'low', 'high', 'optimum', 'value'],
	HTMLProgressElement: ['max', 'value', 'position']
};
const validityMembers = HTML_FORM_RECEIVER_POLICY.ValidityState.reads.split(' ');
const project = (target: unknown, names: string[]) => object(Object.fromEntries(names.map((name) => [name, domGet(target, name)])));
const nodeSummary = (target: unknown) => ({ op: 'conditional', test: target, then: project(target, ['nodeName', 'textContent']), else: null });
const describe = (target: unknown): unknown => ({
	op: 'conditional',
	test: { op: 'binary', operator: '&&', left: target, right: get(target, '$dom') },
	then: {
		op: 'conditional',
		test: { op: 'binary', operator: '===', left: get(target, 'type'), right: 'ValidityState' },
		then: project(target, validityMembers),
		else: {
			op: 'conditional',
			test: {
				op: 'method',
				target: array('NodeList', 'HTMLCollection', 'HTMLFormControlsCollection', 'HTMLOptionsCollection', 'RadioNodeList'),
				key: 'includes',
				args: [get(target, 'type')]
			},
			then: object({ type: get(target, 'type'), length: domGet(target, 'length'), first: nodeSummary(domCall(target, 'item', [0])) }),
			else: {
				op: 'conditional',
				test: { op: 'binary', operator: '===', left: get(target, 'type'), right: 'DOMTokenList' },
				then: project(target, ['value', 'length']),
				else: nodeSummary(target)
			}
		}
	},
	else: target
});
const option = (value: string, text: string, extra: Record<string, string | boolean> = {}): PlatformNode => ({
	tag: 'option',
	attributes: { value, ...extra },
	children: [text]
});

/** Each returned recipe is complete editable data. No feature-specific native
 * dispatch is added to the frame or the worker. */
export function htmlFormRecipe(f: Feature): Recipe | undefined {
	const name = f.interface || f.name,
		member = f.member || '';
	const policy = HTML_FORM_RECEIVER_POLICY[name];
	if (!policy || !['interface', 'attribute', 'operation'].includes(f.kind)) return;
	if (f.kind === 'attribute' && !policy.reads.split(' ').includes(member)) return;
	if (f.kind === 'operation' && !Object.prototype.hasOwnProperty.call(policy.calls || {}, member)) return;
	// These validity flags require real user editing or bounded pattern support;
	// reading a permanently false flag is not an interactive implementation.
	if (name === 'ValidityState' && ['badInput', 'patternMismatch', 'tooLong', 'tooShort'].includes(member)) return;
	const collection = ['HTMLFormControlsCollection', 'HTMLOptionsCollection', 'RadioNodeList'].includes(name);
	const tag = tags[name] || (name === 'HTMLOptionsCollection' ? 'select' : 'input');
	const attrs: Record<string, string | number | boolean> = { id: 'sample', name: 'sample' };
	let children: PlatformNode[] = [];
	const params = [
		p('text', 'Hello Thingtime'),
		p('value', 'Edited value'),
		p('index', 1, 'number'),
		p('start', 1, 'number'),
		p('end', 5, 'number'),
		p('direction', 'forward'),
		p('replacement', '🌈'),
		p('message', 'Please choose a value'),
		p('target', '#target')
	];
	const setup: PlatformExpression[] = [];
	if (tag === 'input') {
		attrs.type = 'text';
		attrs.value = '[[text]]';
		attrs.list = 'suggestions';
		if (
			['min', 'max', 'step', 'valueAsNumber', 'stepUp', 'stepDown'].includes(member) ||
			(name === 'ValidityState' && ['rangeOverflow', 'rangeUnderflow', 'stepMismatch'].includes(member))
		) {
			Object.assign(attrs, { type: 'number', value: '10', min: '0', max: '100', step: '1' });
		}
		if (['checked', 'defaultChecked', 'indeterminate'].includes(member)) attrs.type = 'checkbox';
		if (['accept', 'capture', 'webkitdirectory'].includes(member)) {
			attrs.type = 'file';
			attrs.value = '';
		}
		if (['alpha', 'colorSpace'].includes(member)) {
			attrs.type = 'color';
			attrs.value = '#8040ff';
		}
	}
	if (tag === 'textarea') children = ['[[text]]'];
	if (tag === 'button') {
		attrs.type = ['checkValidity', 'reportValidity', 'setCustomValidity', 'validity', 'validationMessage', 'willValidate'].includes(member)
			? 'submit'
			: 'button';
		children = ['[[text]]'];
	}
	if (['select', 'optgroup', 'datalist'].includes(tag))
		children = [option('one', 'First'), option('two', '[[text]]', { id: 'second', name: 'second' })];
	if (tag === 'option') {
		attrs.value = 'one';
		children = ['[[text]]'];
	}
	if (['output', 'label', 'legend'].includes(tag)) children = ['[[text]]'];
	if (tag === 'label') attrs.for = 'control';
	if (tag === 'output') attrs.for = 'control target';
	if (tag === 'fieldset') children = [{ tag: 'input', attributes: { value: '[[text]]' } }];
	if (tag === 'meter') Object.assign(attrs, { min: 0, max: 1, low: 0.25, high: 0.75, optimum: 0.6, value: 0.4 });
	if (tag === 'progress') Object.assign(attrs, { max: 1, value: 0.4 });
	let sampleNode: PlatformNode = { tag, attributes: attrs, children };
	if (tag === 'option' || tag === 'optgroup') sampleNode = { tag: 'select', children: [sampleNode] };
	if (tag === 'legend') sampleNode = { tag: 'fieldset', children: [sampleNode] };
	const radios: PlatformNode[] = ['one', 'two'].map((value, index) => ({
		tag: 'input',
		attributes: { type: 'radio', name: 'choice', value, checked: !index }
	}));
	const formChildren: PlatformNode[] = [
		{ tag: 'label', attributes: { for: 'sample' }, children: ['[[text]]'] },
		...(tag === 'form' ? [] : [sampleNode]),
		{ tag: 'input', attributes: { id: 'control', name: 'control', value: 'Initial value' } },
		{ tag: 'button', attributes: { type: 'button', id: 'target' }, children: ['Target button'] },
		{ tag: 'datalist', attributes: { id: 'suggestions' }, children: [option('one', 'First suggestion')] },
		...radios
	];
	const document: PlatformNode[] = [{ tag: 'form', attributes: { id: tag === 'form' ? 'sample' : 'demo' }, children: formChildren }];
	let receiverExpression: unknown = sample;
	if (name === 'ValidityState') receiverExpression = domGet(sample, 'validity');
	if (name === 'HTMLFormControlsCollection') receiverExpression = domGet(form, 'elements');
	if (name === 'HTMLOptionsCollection') receiverExpression = domGet(sample, 'options');
	if (name === 'RadioNodeList') receiverExpression = domCall(domGet(form, 'elements'), 'namedItem', ['choice']);
	const writeRule = policy.writeArgs?.[member];
	if (f.kind === 'attribute' && writeRule) {
		const defaults: Record<string, unknown> = {
			type: 'text',
			value: tag === 'select' || name === 'RadioNodeList' ? 'two' : 'Edited value',
			direction: 'forward',
			selectionDirection: 'backward',
			length: 3,
			selectedIndex: 1,
			selectionStart: 1,
			selectionEnd: 5,
			maxLength: 20,
			minLength: 2,
			size: 4,
			rows: 3,
			cols: 24,
			valueAsNumber: 12.5,
			min: '0',
			max: '20',
			step: '2',
			colorSpace: 'display-p3',
			capture: 'user',
			autocomplete: 'off',
			wrap: 'hard',
			accept: 'image/png',
			htmlFor: 'target',
			command: 'toggle-popover',
			method: 'post',
			encoding: 'multipart/form-data',
			enctype: 'multipart/form-data',
			rel: 'nofollow',
			acceptCharset: 'UTF-8'
		};
		const type = writeRule === 'boolean' ? 'boolean' : ['number', 'finite', 'allocation-length'].includes(writeRule) ? 'number' : 'text';
		let value = Object.prototype.hasOwnProperty.call(defaults, member)
			? defaults[member]
			: type === 'boolean'
			? true
			: type === 'number'
			? 0.75
			: 'Edited value';
		if (writeRule === 'number' && !Number.isInteger(value)) value = 4;
		if (['meter', 'progress'].includes(tag)) value = member === 'max' ? 2 : member === 'min' ? 0 : 0.75;
		params[1] = p('value', value, type);
		setup.push(perform(domSet(receiver, member, writeRule === 'nullable-node' ? domCall(doc, 'querySelector', [input('target')]) : input('value'))));
	}
	if (member === 'position') {
		params[1] = p('value', 0.75, 'number');
		setup.push(perform(domSet(sample, 'value', input('value'))));
	}
	if (member === 'textLength') setup.push(perform(domSet(sample, 'value', input('text'))));
	if (['validity', 'validationMessage', 'customError'].includes(member) || (name === 'ValidityState' && ['valid', ''].includes(member)))
		setup.push(perform(domCall(sample, 'setCustomValidity', [input('message')])));
	if (['willValidate', 'valueMissing'].includes(member)) {
		params.push(p('required', true, 'boolean'));
		setup.push(perform(domSet(sample, 'required', input('required'))), perform(domSet(sample, 'value', '')));
		if (!['input', 'textarea', 'select'].includes(tag)) setup.splice(-2);
	}
	if (name === 'ValidityState') {
		if (member === 'typeMismatch') setup.push(perform(domSet(sample, 'type', 'email')), perform(domSet(sample, 'value', input('text'))));
		if (['rangeOverflow', 'rangeUnderflow', 'stepMismatch'].includes(member)) {
			params[1] = p('value', member === 'rangeOverflow' ? 101 : member === 'rangeUnderflow' ? -1 : 10.5, 'number');
			setup.push(perform(domSet(sample, 'valueAsNumber', input('value'))));
		}
	}
	const optionCreation = [
		declare('added', domCall(doc, 'createElement', ['option'])),
		perform(domSet(variable('added'), 'value', 'three')),
		perform(domSet(variable('added'), 'text', input('text')))
	];
	const args: Record<string, unknown[]> = {
		setCustomValidity: [input('message')],
		setSelectionRange: [input('start'), input('end'), input('direction')],
		setRangeText: [input('replacement'), input('start'), input('end'), 'select'],
		stepUp: [input('index')],
		stepDown: [input('index')],
		item: [input('index')],
		namedItem: [name === 'HTMLFormControlsCollection' ? 'choice' : 'second'],
		remove: [input('index')],
		add: [variable('added'), input('index')]
	};
	if (f.kind === 'operation' && member === 'add') setup.push(...optionCreation);
	if (f.kind === 'operation' && ['checkValidity', 'reportValidity'].includes(member))
		setup.push(perform(domCall(tag === 'form' ? control : sample, 'setCustomValidity', [input('message')])));
	let expression: unknown = receiver;
	if (f.kind === 'attribute') expression = domGet(receiver, member);
	if (f.kind === 'operation') expression = domCall(receiver, member, args[member] || []);
	const snapshot =
		name === 'ValidityState'
			? project(receiver, validityMembers)
			: collection
			? describe(receiver)
			: object({
					...Object.fromEntries((profiles[name] || ['nodeName']).map((key) => [key, domGet(sample, key)])),
					...(policy.reads.split(' ').includes('validity')
						? {
								validity: project(domGet(sample, 'validity'), validityMembers),
								validationMessage: domGet(sample, 'validationMessage')
						  }
						: {})
			  });
	const steps = [
		declare('doc', domDocument()),
		declare('form', domCall(doc, 'getElementById', [tag === 'form' ? 'sample' : 'demo'])),
		declare('sample', domCall(doc, 'getElementById', ['sample'])),
		declare('control', domCall(doc, 'getElementById', ['control'])),
		declare('receiver', receiverExpression),
		...setup,
		declare('result', expression),
		...returns(
			object({
				result: describe(variable('result')),
				state: snapshot,
				controlValue: domGet(control, 'value'),
				document: domGet(domGet(doc, 'body'), 'innerHTML')
			})
		)
	];
	const used = new Set(['text']);
	const collect = (value: unknown) => {
		if (value && typeof value === 'object') {
			if ('op' in value && value.op === 'input' && 'name' in value) used.add(String(value.name));
			for (const child of Object.values(value)) collect(child);
		}
	};
	collect(steps);
	const program: PlatformProgram = {
		...base(f),
		description: 'Edit the inputs and compare the native form API result with its control state and document preview.',
		document,
		parameters: params.filter((item) => used.has(item.name)),
		steps,
		styles: [{ selector: 'form', declarations: { display: 'grid', gap: '10px', padding: '12px' } }]
	};
	return recipe(
		program,
		'interactive',
		'Runs the named form member on real detached HTML controls. Native property values and validation state are shown alongside the projected form; active pickers, form reset/submission and user-editing-only validation need their own context.'
	);
}
