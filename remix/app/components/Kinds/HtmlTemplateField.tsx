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
	const field = React.useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
	const baseline = React.useRef<{ value: string; checked?: boolean } | null>(null);
	React.useLayoutEffect(() => {
		const element = field.current;
		if (!element) return;
		const previous = baseline.current;
		const value = 'defaultValue' in fieldProps ? String(fieldProps.defaultValue ?? '') : element.value;
		const checked = 'defaultChecked' in fieldProps ? !!fieldProps.defaultChecked : undefined;
		if (previous && element.value === previous.value && element.type !== 'file') element.value = value;
		if (previous && checked !== undefined && 'checked' in element && element.checked === previous.checked) element.checked = checked;
		baseline.current = { value, checked };
	}, [fieldProps.defaultValue, fieldProps.defaultChecked]);
	return React.createElement(tag, { ...fieldProps, ref: field }, children);
}
