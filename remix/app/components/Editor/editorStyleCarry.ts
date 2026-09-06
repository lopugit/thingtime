import { sanitizeStyleTokens } from './styleTokens';
import type { TextStyleTokens } from './styleTokens';

export const STYLE_CARRY_PROPERTIES = [
	['color', 'Text colour'],
	['background', 'Highlight'],
	['size', 'Size'],
	['font', 'Font'],
	['bold', 'Bold'],
	['italic', 'Italic'],
	['decoration', 'Decoration'],
	['align', 'Alignment']
] as const;
export type StyleCarryPreferences = Partial<Record<keyof TextStyleTokens, boolean>>;
export const carryStyleTokens = (tokens: unknown, preferences: StyleCarryPreferences): TextStyleTokens =>
	Object.fromEntries(Object.entries(sanitizeStyleTokens(tokens)).filter(([key]) => preferences[key as keyof TextStyleTokens] !== false));

/** Editor.js conversions replace one DOM block with another without forwarding tunes. */
export const watchEditorStyleCarry = (
	holder: HTMLElement,
	apply: (id: string, tokens: TextStyleTokens) => void,
	preferences: () => StyleCarryPreferences
) => {
	const observer = new MutationObserver((records) => {
		if (holder.dataset.ttRestoring === 'true') return;
		for (const record of records) {
			const removed = Array.from(record.removedNodes).find((n): n is HTMLElement => n instanceof HTMLElement && n.matches('.ce-block'));
			const addition = records.find(
				(r) =>
					r.target === record.target && r.previousSibling === record.previousSibling && r.nextSibling === record.nextSibling && r.addedNodes.length
			);
			const added = Array.from(addition?.addedNodes || []).find((n): n is HTMLElement => n instanceof HTMLElement && n.matches('.ce-block'));
			if (!removed || !added || removed.dataset.id === added.dataset.id) continue;
			const raw = removed.querySelector<HTMLElement>('[data-tt-style]')?.dataset.ttStyle;
			if (!raw || !added.dataset.id) continue;
			try {
				apply(added.dataset.id, carryStyleTokens(JSON.parse(raw), preferences()));
			} catch {
				/* Only validated tune data is eligible. */
			}
		}
	});
	observer.observe(holder, { childList: true, subtree: true });
	return () => observer.disconnect();
};
