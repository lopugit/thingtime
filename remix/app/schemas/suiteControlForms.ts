import type { SuiteActionDef, SuiteRefs } from './behaviourSuites';

const inputStyle = {
	width: '100%',
	minWidth: 0,
	boxSizing: 'border-box',
	padding: '9px 12px',
	border: '1px solid var(--tt-border, #ddd)',
	borderRadius: '8px',
	background: 'var(--tt-card, #fff)',
	color: 'var(--tt-ink, #16161a)'
};

// Older suites exposed inputs only in the builder inspector. Derive their
// live forms from the same Action descriptors that validate the server run.
// Keep fixed choices (Yes/No, poll answers) fixed and each submit group local.
export const suiteControlForms = (render: Record<string, unknown>, actions: SuiteActionDef[], refs: SuiteRefs): Record<string, unknown> => {
	const containsField = (value: unknown): boolean =>
		!!value &&
		typeof value === 'object' &&
		(Array.isArray(value)
			? value.some(containsField)
			: ['input', 'select', 'textarea', 'tt-upload'].includes(String((value as any).tag)) || Object.values(value).some(containsField));
	if (containsField(render)) return render;
	const walk = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(walk);
		if (!value || typeof value !== 'object') return value;
		const node = value as Record<string, any>;
		const action = actions.find((candidate) => refs.actionKey(candidate.key) === node.ttAction);
		const fields =
			action?.inputs.filter(
				(input) => typeof node.ttActionInputs?.[input.name] === 'string' && /^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(node.ttActionInputs[input.name])
			) || [];
		if (fields.length)
			return {
				tag: 'fieldset',
				props: { style: { display: 'grid', gap: '10px', minWidth: 0, width: '100%', padding: 0, border: 'none' } },
				children: [
					...fields.map((input) => ({
						tag: 'label',
						props: { style: { display: 'grid', gap: '4px', fontSize: '13px' } },
						children: [
							input.label,
							{
								tag: input.type === 'enum' ? 'select' : input.type === 'text' ? 'textarea' : 'input',
								props: {
									name: input.name,
									style: inputStyle,
									required: input.required === true,
									...(input.type === 'boolean'
										? { type: 'checkbox', checked: { ttArg: node.ttActionInputs[input.name].slice(1, -1) } }
										: { value: node.ttActionInputs[input.name] }),
									...(input.type === 'string' ? { type: /email/i.test(input.name) ? 'email' : /url/i.test(input.name) ? 'url' : 'text' } : {}),
									...(input.type === 'number'
										? {
												type: 'number',
												step: 'any',
												...(input.min === undefined ? {} : { min: input.min }),
												...(input.max === undefined ? {} : { max: input.max })
										  }
										: {}),
									...(input.maxLength ? { maxLength: input.maxLength } : {}),
									...(input.type === 'text' ? { rows: 3 } : {})
								},
								...(input.values ? { children: input.values.map((option) => ({ tag: 'option', props: { value: option }, children: [option] })) } : {})
							}
						]
					})),
					node
				]
			};
		return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
	};
	return walk(render) as Record<string, unknown>;
};
