import type { Arg, Policy } from './domBridge';

const mutation = (args: Arg[] = [], min = args.length) => ({ args, min, mutates: true });
const validation = {
	checkValidity: mutation(),
	reportValidity: mutation(),
	setCustomValidity: mutation(['text'])
};
const validityReads = 'willValidate validity validationMessage';
const selection = {
	select: mutation(),
	setSelectionRange: mutation(['number', 'number', 'text'], 2),
	setRangeText: mutation(['text', 'number', 'number', 'text'], 1)
};
function state(groups: Partial<Record<Arg, string>>, readonly = '', calls: Policy['calls'] = {}): Policy {
	const writeArgs = Object.fromEntries(
		Object.entries(groups).flatMap(([rule, names]) =>
			names!
				.split(' ')
				.filter(Boolean)
				.map((name) => [name, rule as Arg])
		)
	);
	const writes = Object.keys(writeArgs).join(' ');
	return { reads: `${writes} ${readonly}`.trim(), writes, writeArgs, calls };
}

/** Native contracts only. Catalogue features are separate editable programs.
 * reset is excluded: Chromium requires an active document for native resetting. */
export const HTML_FORM_RECEIVER_POLICY: Record<string, Policy> = {
	HTMLInputElement: state(
		{
			text: 'accept alt autocomplete capture colorSpace defaultValue dirName max min name placeholder selectionDirection step type value',
			boolean: 'alpha checked defaultChecked disabled formNoValidate indeterminate multiple readOnly required webkitdirectory',
			number: 'height maxLength minLength selectionEnd selectionStart size width',
			finite: 'valueAsNumber'
		},
		`form labels list ${validityReads}`,
		{ ...validation, ...selection, stepDown: mutation(['number'], 0), stepUp: mutation(['number'], 0) }
	),
	HTMLTextAreaElement: state(
		{
			text: 'autocomplete defaultValue dirName name placeholder selectionDirection value wrap',
			boolean: 'disabled readOnly required',
			number: 'cols maxLength minLength rows selectionEnd selectionStart'
		},
		`form labels textLength type ${validityReads}`,
		{ ...validation, ...selection }
	),
	HTMLSelectElement: state(
		{
			text: 'autocomplete name value',
			boolean: 'disabled multiple required',
			number: 'selectedIndex size',
			'allocation-length': 'length'
		},
		`form labels options selectedOptions type ${validityReads}`,
		{
			...validation,
			add: mutation(['node', 'node-or-index'], 1),
			remove: mutation(['number'], 0),
			item: { args: ['number'] },
			namedItem: { args: ['text'] }
		}
	),
	HTMLOptionElement: state({ text: 'label text value', boolean: 'defaultSelected disabled selected' }, 'form index'),
	HTMLOptGroupElement: state({ text: 'label', boolean: 'disabled' }),
	HTMLButtonElement: state(
		{ text: 'command name type value', boolean: 'disabled formNoValidate', 'nullable-node': 'commandForElement' },
		`form labels ${validityReads}`,
		validation
	),
	HTMLFormElement: state(
		{ text: 'acceptCharset autocomplete encoding enctype method name rel target', boolean: 'noValidate' },
		'elements length relList',
		{
			checkValidity: mutation(),
			reportValidity: mutation()
		}
	),
	HTMLFieldSetElement: state({ text: 'name', boolean: 'disabled' }, `elements form type ${validityReads}`, validation),
	HTMLLegendElement: state({ text: 'align' }, 'form'),
	HTMLLabelElement: state({ text: 'htmlFor' }, 'control form'),
	HTMLDataListElement: state({}, 'options'),
	HTMLOutputElement: state({ text: 'defaultValue name value' }, `form htmlFor labels type ${validityReads}`, validation),
	HTMLMeterElement: state({ finite: 'high low max min optimum value' }, 'labels'),
	HTMLProgressElement: state({ finite: 'max value' }, 'labels position'),
	ValidityState: state(
		{},
		'badInput customError patternMismatch rangeOverflow rangeUnderflow stepMismatch tooLong tooShort typeMismatch valid valueMissing'
	),
	HTMLFormControlsCollection: state({}, '', { namedItem: { args: ['text'] } }),
	HTMLOptionsCollection: state({ 'allocation-length': 'length', number: 'selectedIndex' }, '', {
		add: mutation(['node', 'node-or-index'], 1),
		remove: mutation(['number'])
	}),
	RadioNodeList: state({ text: 'value' })
};
