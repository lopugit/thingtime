import React from 'react';

/** Uncontrolled template fields adopt late defaults while preserving edits.
 * A result refresh must not overwrite a value the visitor has already changed. */
export function HtmlTemplateField({
	tag,
	fieldProps,
	children
}: {
	tag: 'input' | 'textarea' | 'select';
	fieldProps: Record<string, any>;
	children?: React.ReactNode;
}) {
	type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
	const field = React.useRef<Field>(null);
 const forwarded = fieldProps.ref as React.Ref<Field> | undefined;
	const setField = React.useCallback((element: Field | null) => {
		field.current = element;
		if (typeof forwarded === 'function') forwarded(element);
		else if (forwarded) forwarded.current = element;
	}, [forwarded]);
	const baseline = React.useRef<{ element: Field; value: string | string[]; checked?: boolean } | null>(null);
	React.useLayoutEffect(() => {
		const element = field.current;
		if (!element) return;
		const previous = baseline.current?.element === element ? baseline.current : null;
		if (element.tagName === 'SELECT' && (element as HTMLSelectElement).multiple) {
			const select = element as HTMLSelectElement;
			const current = Array.from(select.selectedOptions, (option) => option.value);
			if (!Array.isArray(fieldProps.defaultValue)) {
				if (!Array.isArray(previous?.value)) baseline.current = { element, value: current };
				return;
			}
			const defaults = new Set(fieldProps.defaultValue.map(String));
			const options = Array.from(select.options);
			const previousValues = previous?.value;
			if (Array.isArray(previousValues) && current.length === previousValues.length &&
				current.every((value, index) => value === previousValues[index])) {
				for (const option of options) option.selected = defaults.has(option.value);
			}
			// Compare the next refresh with the last defaults in DOM order, rather
			// than a visitor's possibly edited selection or the first option alone.
			baseline.current = { element, value: options.filter((option) => defaults.has(option.value)).map((option) => option.value) };
			return;
		}
		const value = 'defaultValue' in fieldProps ? String(fieldProps.defaultValue ?? '') : element.value;
		const checked = 'defaultChecked' in fieldProps ? !!fieldProps.defaultChecked : undefined;
		if (previous && element.value === previous.value && element.type !== 'file') element.value = value;
		if (previous && checked !== undefined && 'checked' in element && element.checked === previous.checked) element.checked = checked;
		baseline.current = { element, value, checked };
	}, [tag, fieldProps.defaultValue, fieldProps.defaultChecked, fieldProps.multiple, children]);
	return React.createElement(tag, { ...fieldProps, ref: setField }, children);
}
