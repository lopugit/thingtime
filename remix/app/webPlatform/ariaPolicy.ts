import type { Arg, Policy } from './domBridge';

/** Native Element reflection contracts; example values and relationships live in saved programs. */
export const ARIA_TEXT =
	`role ariaAtomic ariaAutoComplete ariaBrailleLabel ariaBrailleRoleDescription ariaBusy ariaChecked ariaColCount ariaColIndex ariaColIndexText ariaColSpan ariaCurrent ariaDescription ariaDisabled ariaExpanded ariaHasPopup ariaHidden ariaInvalid ariaKeyShortcuts ariaLabel ariaLevel ariaLive ariaModal ariaMultiLine ariaMultiSelectable ariaOrientation ariaPlaceholder ariaPosInSet ariaPressed ariaReadOnly ariaRelevant ariaRequired ariaRoleDescription ariaRowCount ariaRowIndex ariaRowIndexText ariaRowSpan ariaSelected ariaSetSize ariaSort ariaValueMax ariaValueMin ariaValueNow ariaValueText`.split(
		' '
	);
export const ARIA_REFERENCES =
	`ariaControlsElements ariaDescribedByElements ariaDetailsElements ariaErrorMessageElements ariaFlowToElements ariaLabelledByElements ariaOwnsElements`.split(
		' '
	);
export type ARIAArg = 'aria-text' | 'aria-element' | 'aria-elements';
const writeArgs: Record<string, Arg> = {
	...Object.fromEntries(ARIA_TEXT.map((name) => [name, 'aria-text' as const])),
	...Object.fromEntries(ARIA_REFERENCES.map((name) => [name, 'aria-elements' as const])),
	ariaActiveDescendantElement: 'aria-element'
};
export const ARIA_ELEMENT: Policy = { reads: Object.keys(writeArgs).join(' '), writes: Object.keys(writeArgs).join(' '), writeArgs };

export function ariaArgument(value: unknown, rule: string, element: (raw: unknown) => object): unknown {
	if (value === null) return null;
	if (rule === 'aria-text') {
		if (typeof value !== 'string' || value.length > 4096) throw new Error('Expected nullable bounded ARIA text');
		return value;
	}
	if (rule === 'aria-element') return element(value);
	if (rule !== 'aria-elements' || !Array.isArray(value) || value.length > 64) throw new Error('Expected at most 64 ARIA element references');
	return value.map(element);
}
