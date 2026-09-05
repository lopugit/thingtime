import { openStyleDialog } from './StyleDialog';
import { FONT_STACKS, SIZE_PRESETS, STYLE_PALETTE, hasStyleTokens, sanitizeStyleTokens, styleTokensToCss } from './styleTokens';
import type { AlignKey, FontKey, TextStyleTokens } from './styleTokens';

// 🎨 Style — an Editor.js block tune (the official per-block settings
// mechanism) offering colour, size, font, and alignment for any text block.
// Everything it stores and everything it applies passes the styleTokens
// validators, so "complete customisation" never becomes "arbitrary CSS":
// swatch colours and hexes only, clamped px sizes, curated font stacks,
// alignment enums. Data lives at block.tunes.style in the saved document and
// renders through the rich-text kind with the same sanitiser.
//
// Interaction is EVENT-DELEGATED off data attributes: editor.js's settings
// popover clones custom tune HTML, which silently drops addEventListener
// bindings — one global capture listener + a blockId→tune registry survives
// the clone.

type TuneParams = {
	api: any;
	data?: unknown;
	block?: any;
};

const BUTTON_BASE =
	'display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--tt-border, #ececef);background:var(--tt-card, #ffffff);color:var(--tt-text, #5a5a66);border-radius:7px;cursor:pointer;font-size:11px;font-weight:700;padding:3px 7px;line-height:1.2;';

const ACTIVE_RING = '0 0 0 2px var(--tt-accent-tint, #fff5fa), 0 0 0 3px var(--tt-accent, hotpink)';

// blockId → live tune instance (overwritten on re-init; cleared on destroy)
const TUNE_REGISTRY = new Map<string, StyleTune>();

let delegationBound = false;

const bindDelegation = () => {
	if (delegationBound || typeof document === 'undefined') return;
	delegationBound = true;

	document.addEventListener(
		'click',
		(event) => {
			const target = event.target as HTMLElement | null;
			const button = target?.closest?.(
				'[data-tt-style-color], [data-tt-style-size], [data-tt-style-font], [data-tt-style-align], [data-tt-style-reset], [data-tt-style-custom]'
			) as HTMLElement | null;
			if (!button) return;

			const panel = button.closest('[data-tt-style-tune]') as HTMLElement | null;
			const blockId = panel?.getAttribute('data-tt-block-id');
			const tune = blockId ? TUNE_REGISTRY.get(blockId) : undefined;
			if (!panel || !tune) return;

			event.preventDefault();
			event.stopPropagation();

			if (button.hasAttribute('data-tt-style-custom')) {
				tune.openCustom();
			} else if (button.hasAttribute('data-tt-style-reset')) {
				tune.replace({});
			} else if (button.hasAttribute('data-tt-style-color')) {
				const css = button.getAttribute('data-tt-style-css') || '';
				tune.set({ color: tune.data.color === css ? undefined : css });
			} else if (button.hasAttribute('data-tt-style-size')) {
				const px = Number(button.getAttribute('data-tt-style-size'));
				tune.set({ size: tune.data.size === px ? undefined : px });
			} else if (button.hasAttribute('data-tt-style-font')) {
				const font = button.getAttribute('data-tt-style-font') as FontKey;
				tune.set({ font: tune.data.font === font ? undefined : font });
			} else if (button.hasAttribute('data-tt-style-align')) {
				const align = button.getAttribute('data-tt-style-align') as AlignKey;
				tune.set({ align: tune.data.align === align ? undefined : align });
			}

			// repaint the panel the user actually clicked (it may be a clone)
			paintPanel(panel, tune.data);
		},
		true
	);
};

// active-state styling driven purely by data attributes, so it works on any
// copy of the panel
const paintPanel = (panel: HTMLElement, data: TextStyleTokens) => {
	panel.querySelectorAll<HTMLElement>('[data-tt-style-color]').forEach((button) => {
		const active = data.color === button.getAttribute('data-tt-style-css');
		button.style.boxShadow = active ? ACTIVE_RING : '';
	});
	panel.querySelectorAll<HTMLElement>('[data-tt-style-size]').forEach((button) => {
		const active = data.size === Number(button.getAttribute('data-tt-style-size'));
		button.style.boxShadow = active ? ACTIVE_RING : '';
		button.style.color = active ? 'var(--tt-ink, #16161a)' : 'var(--tt-text, #5a5a66)';
	});
	panel.querySelectorAll<HTMLElement>('[data-tt-style-font]').forEach((button) => {
		const active = data.font === button.getAttribute('data-tt-style-font');
		button.style.boxShadow = active ? ACTIVE_RING : '';
		button.style.color = active ? 'var(--tt-ink, #16161a)' : 'var(--tt-text, #5a5a66)';
	});
	panel.querySelectorAll<HTMLElement>('[data-tt-style-align]').forEach((button) => {
		const active = data.align === button.getAttribute('data-tt-style-align');
		button.style.boxShadow = active ? ACTIVE_RING : '';
		button.style.color = active ? 'var(--tt-ink, #16161a)' : 'var(--tt-text, #5a5a66)';
	});
};

export class StyleTune {
	static get isTune() {
		return true;
	}

	api: any;
	block: any;
	data: TextStyleTokens;
	wrapper: HTMLElement | null = null;
	closeDialog?: () => void;
	observer?: MutationObserver;

	constructor({ api, data, block }: TuneParams) {
		this.api = api;
		this.block = block;
		this.data = sanitizeStyleTokens(data);

		bindDelegation();
		const blockId = this.blockId();
		if (blockId) TUNE_REGISTRY.set(blockId, this);
	}

	blockId(): string | null {
		return typeof this.block?.id === 'string' ? this.block.id : null;
	}

	// tune data saved into the document (undefined keeps saved docs clean)
	save(): TextStyleTokens | undefined {
		const clean = sanitizeStyleTokens(this.data);
		return hasStyleTokens(clean) ? clean : undefined;
	}

	// every block's content gets wrapped so validated styles apply live
	wrap(blockContent: HTMLElement): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.classList.add('tt-style-tune-wrap');
		wrapper.appendChild(blockContent);
		this.wrapper = wrapper;
		this.observer?.disconnect();
		// List/table tools create additional fields after wrap(); style those too.
		this.observer = new MutationObserver(() => this.applyStyles());
		this.observer.observe(wrapper, { childList: true, subtree: true });
		this.applyStyles();
		return wrapper;
	}

	applyStyles() {
		if (!this.wrapper) return;
		const css = styleTokensToCss(this.data);
		// Apply to text fields themselves: relative units must resolve once, not at both wrapper and heading.
		this.wrapper
			.querySelectorAll<HTMLElement>(
				'[contenteditable], textarea, .ce-paragraph, .ce-header, .cdx-input, .tc-cell, .cdx-list__item-content, .cdx-checklist__item-text'
			)
			.forEach((field) => {
				for (const key of ['color', 'fontSize', 'fontFamily', 'textAlign', 'backgroundColor', 'fontWeight', 'fontStyle', 'textDecoration'] as const)
					if (field.style[key] !== String(css[key] ?? '')) field.style[key] = String(css[key] ?? '');
			});
	}
	replace(tokens: TextStyleTokens) {
		this.data = sanitizeStyleTokens(tokens);
		this.applyStyles();
		this.block?.dispatchChange?.();
		this.wrapper?.dispatchEvent(new Event('input', { bubbles: true }));
	}
	openCustom() {
		this.closeDialog?.();
		this.closeDialog = openStyleDialog({
			initial: this.data,
			title: 'Block text style',
			alignment: true,
			emPixels: this.wrapper ? parseFloat(getComputedStyle(this.wrapper).fontSize) || 16 : 16,
			apply: (tokens) => this.replace(tokens)
		});
	}

	set(partial: Partial<Record<keyof TextStyleTokens, unknown>>) {
		const merged: Record<string, unknown> = { ...this.data, ...partial };
		// explicit undefined = clear that token
		Object.keys(partial).forEach((key) => {
			if (partial[key as keyof TextStyleTokens] === undefined) delete merged[key];
		});
		this.data = sanitizeStyleTokens(merged);
		this.applyStyles();
		// nudge both editor.js change tracking and the holder's raw-input
		// fallback so the document saves
		this.block?.dispatchChange?.();
		this.wrapper?.dispatchEvent(new Event('input', { bubbles: true }));
	}

	// settings-popover UI: colour swatches, size chips, font chips, alignment.
	// Structure only — no listeners (see delegation note above).
	render(): HTMLElement {
		const panel = document.createElement('div');
		panel.setAttribute('data-tt-style-tune', '');
		if (this.blockId()) panel.setAttribute('data-tt-block-id', this.blockId() as string);
		panel.style.cssText = 'padding:6px 8px;display:flex;flex-direction:column;gap:7px;min-width:210px;';

		// label + reset
		const label = document.createElement('div');
		label.style.cssText =
			'display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--tt-muted, #9a9aa6);';
		label.textContent = '🎨 Style';
		const reset = document.createElement('button');
		reset.type = 'button';
		reset.textContent = '✕ reset';
		reset.setAttribute('data-tt-style-reset', '');
		reset.style.cssText = BUTTON_BASE + 'font-size:9px;padding:2px 6px;text-transform:none;letter-spacing:0;';
		label.appendChild(reset);
		panel.appendChild(label);

		// colours
		const colors = document.createElement('div');
		colors.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
		STYLE_PALETTE.forEach((swatch) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.title = swatch.label;
			button.setAttribute('data-tt-style-color', swatch.key);
			button.setAttribute('data-tt-style-css', swatch.css);
			button.style.cssText = `width:18px;height:18px;border-radius:999px;cursor:pointer;border:1px solid var(--tt-border, #ececef);background:${swatch.css};`;
			colors.appendChild(button);
		});
		panel.appendChild(colors);

		// sizes
		const sizes = document.createElement('div');
		sizes.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
		SIZE_PRESETS.forEach((preset) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = preset.label;
			button.title = `${preset.px}px`;
			button.setAttribute('data-tt-style-size', String(preset.px));
			button.style.cssText = BUTTON_BASE;
			sizes.appendChild(button);
		});
		panel.appendChild(sizes);

		// fonts
		const fonts = document.createElement('div');
		fonts.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
		(Object.keys(FONT_STACKS) as FontKey[]).forEach((key) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = 'Aa';
			button.title = key;
			button.setAttribute('data-tt-style-font', key);
			button.style.cssText = BUTTON_BASE + `font-family:${FONT_STACKS[key]};`;
			fonts.appendChild(button);
		});
		panel.appendChild(fonts);

		// alignment
		const aligns = document.createElement('div');
		aligns.style.cssText = 'display:flex;gap:4px;';
		(['left', 'center', 'right'] as AlignKey[]).forEach((align) => {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = align === 'left' ? '⇤' : align === 'center' ? '☰' : '⇥';
			button.title = `Align ${align}`;
			button.setAttribute('data-tt-style-align', align);
			button.style.cssText = BUTTON_BASE + 'flex:1;';
			aligns.appendChild(button);
		});
		panel.appendChild(aligns);

		const custom = document.createElement('button');
		custom.type = 'button';
		custom.textContent = '🎨 More text styles…';
		custom.setAttribute('data-tt-style-custom', '');
		custom.style.cssText = BUTTON_BASE + 'min-height:36px;width:100%;';
		panel.appendChild(custom);
		paintPanel(panel, this.data);
		return panel;
	}

	destroy() {
		this.closeDialog?.();
		this.observer?.disconnect();
		const blockId = this.blockId();
		if (blockId && TUNE_REGISTRY.get(blockId) === this) TUNE_REGISTRY.delete(blockId);
	}
}
