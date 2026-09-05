import { openStyleDialog } from './StyleDialog';
import { sanitizeEditorJsInlineHtml } from './inlineHtmlText';
import { inlineStyleToTokens, sanitizeInlineStyle, tokensToInlineStyle } from './styleTokens';
import type { TextStyleTokens } from './styleTokens';

const fieldFor = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[contenteditable="true"]');

/** Split at selection boundaries, so changing a styled substring cannot affect its neighbours. */
export const applySelectionStyle = (range: Range, tokens: TextStyleTokens, initial: TextStyleTokens = {}, clearExisting = false): boolean => {
	const field = fieldFor(range.startContainer);
	if (!field || field !== fieldFor(range.endContainer) || !field.isConnected || range.collapsed) return false;
	const before = document.createRange();
	before.selectNodeContents(field);
	before.setEnd(range.startContainer, range.startOffset);
	const after = document.createRange();
	after.selectNodeContents(field);
	after.setStart(range.endContainer, range.endOffset);
	const selected = range.cloneContents();
	let middle: Node = selected;
	let ancestor = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
	while (ancestor && ancestor !== field) {
		const clone = ancestor.cloneNode(false);
		clone.appendChild(middle);
		middle = clone;
		ancestor = ancestor.parentElement;
	}
	const styled = document.createElement('span');
	styled.appendChild(middle);
	// Preserve mixed colours/fonts when changing an unrelated property.
	const changed = new Set((Object.keys({ ...initial, ...tokens }) as (keyof TextStyleTokens)[]).filter((key) => initial[key] !== tokens[key]));
	if (!clearExisting && !changed.size) return true;
	styled.querySelectorAll('span').forEach((span) => {
		const kept = clearExisting ? {} : inlineStyleToTokens(span.getAttribute('style') || '');
		for (const key of changed) delete kept[key];
		const value = tokensToInlineStyle(kept);
		if (value) span.setAttribute('style', value);
		else span.removeAttribute('style');
	});
	const overrides: Record<string, string[]> = { bold: ['b', 'strong'], italic: ['i', 'em'], decoration: ['u', 's'], background: ['mark'] };
	for (const [key, tags] of Object.entries(overrides)) {
		if (clearExisting || changed.has(key as keyof TextStyleTokens))
			styled.querySelectorAll(tags.join(',')).forEach((el) => el.replaceWith(...el.childNodes));
	}
	const appliedTokens = clearExisting ? tokens : Object.fromEntries([...changed].map((key) => [key, tokens[key]]));
	const style = tokensToInlineStyle(appliedTokens);
	styled.querySelectorAll('span:not([style])').forEach((span) => span.replaceWith(...span.childNodes));
	if (style) styled.setAttribute('style', style);
	const combined = document.createElement('div');
	combined.append(before.cloneContents(), styled, after.cloneContents());
	const html = sanitizeEditorJsInlineHtml(combined.innerHTML);
	const selectionStart = before.toString().length,
		selectionEnd = selectionStart + range.toString().length;
	field.focus({ preventScroll: true });
	const all = document.createRange();
	all.selectNodeContents(field);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(all);
	// Browser editing command retains the native undo transaction; never replace the document through Editor.js render().
	const applied = document.execCommand('insertHTML', false, html);
	if (applied) {
		// Keep the formatted words selected rather than moving the caret to the end of the block.
		const restored = document.createRange(),
			walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
		let offset = 0,
			started = false,
			node: Node | null;
		while ((node = walker.nextNode())) {
			const end = offset + (node.textContent?.length || 0);
			if (!started && selectionStart <= end) {
				restored.setStart(node, selectionStart - offset);
				started = true;
			}
			if (started && selectionEnd <= end) {
				restored.setEnd(node, selectionEnd - offset);
				break;
			}
			offset = end;
		}
		if (started) {
			selection?.removeAllRanges();
			selection?.addRange(restored);
		}
		field.dispatchEvent(new Event('input', { bubbles: true }));
	}
	return applied;
};

export class InlineStyle {
	static get isInline() {
		return true;
	}
	static get title() {
		return 'Text style';
	}
	static get sanitize() {
		return {
			span: (element: HTMLElement) => {
				const style = sanitizeInlineStyle(element.getAttribute('style') || '');
				if (style) element.setAttribute('style', style);
				else element.removeAttribute('style');
				return { style: true };
			}
		};
	}
	render() {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'ce-inline-tool';
		button.title = 'Text style';
		button.setAttribute('aria-label', 'Text style');
		button.textContent = '🎨';
		return button;
	}
	surround(range: Range | null) {
		if (!range || range.collapsed) return;
		const saved = range.cloneRange();
		const field = fieldFor(saved.startContainer);
		if (!field || field !== fieldFor(saved.endContainer)) return;
		let initial: TextStyleTokens = {};
		let ancestor = saved.startContainer instanceof Element ? saved.startContainer : saved.startContainer.parentElement;
		const ancestors: Element[] = [];
		while (ancestor && ancestor !== field) {
			ancestors.unshift(ancestor);
			ancestor = ancestor.parentElement;
		}
		for (const el of ancestors) {
			initial = { ...initial, ...inlineStyleToTokens(el.getAttribute('style') || '') };
			if (el.matches('b,strong')) initial.bold = true;
			if (el.matches('i,em')) initial.italic = true;
			if (el.matches('u')) initial.decoration = 'underline';
			if (el.matches('s')) initial.decoration = [initial.decoration, 'line-through'].filter(Boolean).join(' ');
		}
		openStyleDialog({
			initial,
			title: 'Selected text style',
			emPixels: parseFloat(getComputedStyle(field).fontSize) || 16,
			restoreFocus: () => {
				if (field.isConnected) {
					field.focus({ preventScroll: true });
					const s = window.getSelection();
					s?.removeAllRanges();
					s?.addRange(saved);
				}
			},
			apply: (tokens, clearExisting) => applySelectionStyle(saved, tokens, initial, clearExisting)
		});
	}
	checkState() {
		return false;
	}
}
