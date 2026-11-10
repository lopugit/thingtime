import React from 'react';
import { menuPosition } from '../Builder/componentMenuPosition';

function selectValues(value: unknown): string[] {
	if (typeof value === 'string' && value.startsWith('[')) {
		try {
			const decoded: unknown = JSON.parse(value);
			if (Array.isArray(decoded) && decoded.every(entry => typeof entry === 'string')) value = decoded;
		} catch {
			// Existing scalar and CSV selections remain valid.
		}
	}
	const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
	return [...new Set(values.filter((entry): entry is string => typeof entry === 'string' && entry !== ''))];
}

const MultipleSelectContext = React.createContext<{
	selected: Set<string>;
	disabled: boolean;
	editing: boolean;
	change: (value: string, checked: boolean) => void;
} | null>(null);

type Option = { value: string; label: string; disabled: boolean; selected: boolean };

const fieldStyle: React.CSSProperties = {
	border: '1px solid var(--tt-border, #d4d4d8)',
	borderRadius: 'var(--tt-radius-sm, 9px)',
	background: 'var(--tt-card, white)',
	color: 'inherit'
};

function placePopup(button: HTMLButtonElement, popup: HTMLDivElement) {
	const view = popup.ownerDocument.defaultView;
	if (!view || !popup.matches(':popover-open')) return;
	const { left, top } = menuPosition(button.getBoundingClientRect(), popup.getBoundingClientRect(), view.innerWidth, view.innerHeight, false);
	Object.assign(popup.style, { left: `${left}px`, top: `${top}px` });
}

/** The editable option block is the checkbox label when rendered in a multiple select. */
export function HtmlSelectOption({ props, children }: { props: Record<string, any>; children?: React.ReactNode }) {
	const selection = React.useContext(MultipleSelectContext);
	if (!selection) return <option {...props}>{children}</option>;
	const { value, disabled, selected, style, ...labelProps } = props;
	const choice = String(value ?? React.Children.toArray(children).filter(child => typeof child === 'string' || typeof child === 'number').join(''));
	const checked = choice === '' ? selection.selected.size === 0 : selection.selected.has(choice);
	const OptionLabel = selection.editing ? 'div' : 'label';
	return (
		<OptionLabel {...labelProps} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '4px 10px', overflowWrap: 'anywhere', ...style }}>
			{selection.editing ? <span aria-hidden="true" style={{ flex: '0 0 13px', height: 13, border: '1px solid currentColor', borderRadius: 3, fontSize: 12, lineHeight: '11px' }}>{checked ? '✓' : ''}</span> :
				<input type="checkbox" disabled={selection.disabled || !!disabled} checked={checked}
					onChange={event => { event.stopPropagation(); selection.change(choice, event.target.checked); }} />}
			<span data-tt-option-label={choice} data-tt-option-disabled={disabled ? 'true' : undefined}
				data-tt-option-selected={selected ? 'true' : undefined} style={{ minWidth: 0 }}>{children}</span>
		</OptionLabel>
	);
}

/** Use an ordinary form field for submission and a top-layer checkbox picker for interaction. */
export function HtmlMultipleSelect({ props, editing = false, children }: { props: Record<string, any>; editing?: boolean; children?: React.ReactNode }) {
	const { id, name, style, value, defaultValue, placeholder, disabled, required, multiple: _multiple, 'aria-label': ariaLabel, ...outerProps } = props;
	const [options, setOptions] = React.useState<Option[]>([]);
	const boundValues = selectValues(value ?? defaultValue ?? options.filter(option => option.selected).map(option => option.value));
	const binding = JSON.stringify(boundValues);
	const [draft, setDraft] = React.useState({ binding, values: boundValues });
	if (draft.binding !== binding) setDraft({ binding, values: boundValues });
	const [open, setOpen] = React.useState(false);
	const [requiredError, setRequiredError] = React.useState(false);
	const selectedValues = draft.binding === binding ? draft.values : boundValues;
	const selected = new Set(selectedValues);
	const disabledOptions = new Set(options.filter(option => option.disabled).map(option => option.value));
	const submittedValues = selectedValues.filter(entry => !disabledOptions.has(entry));
	const selectedKey = selectedValues.length < 2 ? selectedValues[0] ?? '' : undefined;
	const trigger = React.useRef<HTMLButtonElement>(null);
	const popup = React.useRef<HTMLDivElement>(null);
	const popupId = React.useId();
	const errorId = `${popupId}-error`;
	const fieldLabel = ariaLabel || props.title || name;
	const invalid = !!required && !disabled && !submittedValues.length && requiredError;
	const change = (choice: string, checked: boolean) => {
		setRequiredError(false);
		if (choice === '') { if (checked) setDraft({ binding, values: [] }); return; }
		setDraft({ binding, values: checked ? [...selected, choice] : selectedValues.filter(entry => entry !== choice) });
	};
	React.useLayoutEffect(() => {
		const content = popup.current;
		const button = trigger.current;
		const view = content?.ownerDocument.defaultView;
		if (!content || !button || !view) return;
		if (disabled && content.matches(':popover-open')) content.hidePopover();
		const place = () => {
			if (!editing) placePopup(button, content);
		};
		const refreshOptions = () => {
			const next = Array.from(content.querySelectorAll<HTMLElement>('[data-tt-option-label]'), element => ({
				value: element.dataset.ttOptionLabel ?? '', label: element.textContent ?? '', disabled: element.dataset.ttOptionDisabled === 'true',
				selected: element.dataset.ttOptionSelected === 'true'
			}));
			setOptions(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
			place();
		};
		refreshOptions();
		const observer = new view.MutationObserver(refreshOptions);
		observer.observe(content, { childList: true, subtree: true, characterData: true, attributes: true,
			attributeFilter: ['data-tt-option-label', 'data-tt-option-disabled', 'data-tt-option-selected'] });
		const resize = new view.ResizeObserver(place);
		resize.observe(button);
		resize.observe(content);
		const toggle = () => { setOpen(content.matches(':popover-open')); place(); };
		content.addEventListener('toggle', toggle);
		view.addEventListener('resize', place);
		view.addEventListener('scroll', place, true);
		return () => {
			observer.disconnect();
			resize.disconnect();
			content.removeEventListener('toggle', toggle);
			view.removeEventListener('resize', place);
			view.removeEventListener('scroll', place, true);
		};
	}, [disabled, editing]);

	const label = selectedKey === undefined ? '' : options.find(option => option.value === selectedKey)?.label;
	const summary = selectedValues.length > 1 ? `${selectedValues.length} selected` : label || selectedKey || placeholder || 'Choose options';
	return (
		<div {...outerProps} style={{ minWidth: 0, ...style }}>
			<button ref={trigger} id={id} type="button" disabled={!!disabled && !editing} aria-expanded={editing || open} aria-controls={popupId}
				aria-label={fieldLabel ? `${fieldLabel}: ${summary}` : undefined}
				aria-describedby={invalid ? errorId : undefined}
				onClick={event => {
					const content = popup.current;
					if (editing || !content?.showPopover) return;
					if (content.matches(':popover-open')) {
						content.hidePopover();
						setOpen(false);
					} else {
						content.showPopover();
						placePopup(event.currentTarget, content);
						setOpen(true);
						content.querySelector<HTMLElement>('input:not(:disabled)')?.focus();
					}
				}}
				style={{ ...fieldStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', minHeight: 44, padding: '8px 12px', textAlign: 'start', font: 'inherit' }}>
				<span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{summary}</span>
				<span aria-hidden="true">▾</span>
			</button>
			<div ref={popup} id={popupId} role="group" aria-label={fieldLabel} popover={editing ? undefined : 'auto'}
				onKeyDown={event => {
					if (event.key !== 'Escape' || editing) return;
					event.preventDefault(); event.stopPropagation();
					if (popup.current?.matches(':popover-open')) popup.current.hidePopover();
					setOpen(false);
					trigger.current?.focus();
				}}
				style={{ ...fieldStyle, ...(!editing && { position: 'fixed', inset: 'auto', margin: 0, minWidth: 180, maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(320px, 60dvh)', overflow: 'auto', boxShadow: '0 8px 24px rgb(0 0 0 / .15)' }), padding: 4 }}>
				<MultipleSelectContext.Provider value={{ selected, disabled: !!disabled, editing, change }}>
					{children}
				</MultipleSelectContext.Provider>
			</div>
			<select name={name} multiple value={submittedValues} onChange={() => {}} disabled={!!disabled || editing} required={!!required}
				aria-hidden="true" tabIndex={-1} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
				onInvalid={event => { event.preventDefault(); setRequiredError(true); trigger.current?.focus(); }}>
				{submittedValues.map(entry => <option key={entry} value={entry}>{entry}</option>)}
			</select>
			{invalid && <span id={errorId} role="alert" style={{ color: 'var(--tt-danger, #b91c1c)' }}>Choose at least one option.</span>}
		</div>
	);
}
