import { clamp, hslToRgba, parseColor, rgbaToHex, rgbaToHsl } from './styleColor';
import { FONT_SIZE_UNITS, SIZE_LIMITS, STYLE_PALETTE, sanitizeStyleTokens, styleTokensToCss } from './styleTokens';
import type { FontKey, TextStyleTokens } from './styleTokens';
import { makeEditorPanelMovable, makeEditorPanelResizable } from './floatingEditorPanel';

let closeActive: (() => void) | undefined;

/** A single shared picker with live document previews and an explicit Save/Cancel boundary. */
export const openStyleDialog = ({
	initial,
	apply,
	preview: previewDocument,
	cancel,
	historyCommand,
	title = 'Text style',
	alignment = false,
	restoreFocus,
	emPixels = 16
}: {
	initial: TextStyleTokens;
	apply: (tokens: TextStyleTokens, clearExisting: boolean) => void;
	preview?: (tokens: TextStyleTokens, clearExisting: boolean) => void;
	cancel?: () => void;
	historyCommand?: (redo: boolean) => void;
	title?: string;
	alignment?: boolean;
	restoreFocus?: () => void;
	emPixels?: number;
}): (() => void) => {
	closeActive?.();
	let draft = { ...initial };
	let clearExisting = false;
	let colourTarget: 'color' | 'background' = 'color';
	let colour = parseColor(draft.color || '') || hslToRgba(320, 100, 50, 1);
	let [hue, saturation, lightness] = rgbaToHsl(colour);
	let initialized = false,
		previewed = false,
		saved = false;
	const previousFocus = document.activeElement as HTMLElement | null;
	const dialog = document.createElement('dialog');
	dialog.className = 'tt-style-dialog';
	dialog.setAttribute('aria-label', title);
	dialog.style.cssText =
		'padding:0;border:1px solid var(--tt-border,#ddd);border-radius:18px;background:var(--tt-card,#fff);color:var(--tt-ink,#16161a);width:min(680px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);box-shadow:0 18px 80px #0004;overflow:auto;resize:both;container-type:inline-size;';
	// Static markup only. Stored values are assigned through DOM properties below.
	dialog.innerHTML = `<style>
 .tt-style-dialog::backdrop{background:#0001}.tt-style-dialog *{box-sizing:border-box}
 .tt-style-dialog form{padding:18px;display:grid;gap:14px;font:14px system-ui}
 .tt-style-dialog section{display:grid;align-content:start;gap:14px;min-width:0}.tt-style-dialog form>header,.tt-style-dialog footer{grid-column:1/-1}
 @container (min-width:560px){.tt-style-dialog form{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}.tt-style-dialog section+section{border-left:1px solid var(--tt-border,#ddd);padding-left:18px}}
 .tt-style-dialog label{display:grid;gap:5px;min-width:0}.tt-style-dialog .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
 .tt-style-dialog input,.tt-style-dialog select,.tt-style-dialog button{font:inherit;color:inherit;min-width:0;min-height:36px;border:1px solid var(--tt-border,#ddd);border-radius:8px;background:var(--tt-card,#fff);padding:6px 8px}
 .tt-style-dialog input:not([type=range]),.tt-style-dialog select{width:100%}.tt-style-dialog input[type=range]{width:100%;padding:0;accent-color:var(--tt-accent,hotpink)}
 .tt-style-dialog button{cursor:pointer}.tt-style-dialog button[aria-pressed=true]{background:var(--tt-accent-tint,#fff0f8);border-color:var(--tt-accent,hotpink)}
 .tt-style-dialog :focus-visible{outline:2px solid var(--tt-accent,hotpink);outline-offset:2px}.tt-style-dialog .fill{flex:1}
 .tt-style-dialog .wheel{position:relative;width:180px;height:180px;margin:auto;border-radius:50%;touch-action:none;background:radial-gradient(circle,#fff,transparent),conic-gradient(from 90deg,red,#ff0,#0f0,#0ff,#00f,#f0f,red)}
 .tt-style-dialog .wheel i{position:absolute;width:14px;height:14px;border:2px solid white;box-shadow:0 0 0 1px #222;border-radius:50%;transform:translate(-50%,-50%);pointer-events:none}
 .tt-style-dialog .swatches{display:flex;flex-wrap:wrap;gap:6px}.tt-style-dialog .swatches button{width:27px;min-height:27px;border-radius:50%;padding:0}
 .tt-style-dialog footer{display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:-18px;background:var(--tt-card,#fff);padding:10px 0}
 .tt-style-dialog .preview{padding:12px;border:1px solid var(--tt-border,#ddd);border-radius:8px;overflow-wrap:anywhere;max-height:100px;overflow:auto}
 </style><form>
 <header class="row"><strong class="fill" data-title></strong><button type="button" data-reset>Reset</button></header>
 <section>
 <div class="row"><button type="button" data-target="color" aria-pressed="true">Text colour</button><button type="button" data-target="background" aria-pressed="false">Highlight</button><button type="button" data-clear>Clear</button></div>
 <div class="swatches"></div>
 <div class="wheel" role="slider" tabindex="0" aria-label="Colour wheel hue" aria-valuemin="0" aria-valuemax="360"><i></i></div>
 <div class="row"><label class="fill">Hue<input data-hue type="range" min="0" max="360" step="1"></label><label class="fill">Saturation<input data-saturation type="range" min="0" max="100" step="1"></label></div>
 <label>Lightness<input data-lightness type="range" min="0" max="100" step="1"></label>
 <div class="row"><label class="fill">Opacity<input data-alpha type="range" min="0" max="100" step="1"></label><label style="width:82px">Alpha %<input data-alpha-number type="number" min="0" max="100" step="1"></label></div>
 <div class="row"><label style="width:90px">Format<select data-format><option>HEX</option><option>RGB</option><option>RGBA</option><option>HSL</option><option>HSLA</option></select></label><label class="fill">Colour value<input data-colour type="text" spellcheck="false" aria-describedby="tt-colour-error"></label></div>
 <small id="tt-colour-error" role="status" hidden>Enter a valid hex, RGB(A), or HSL(A) colour.</small>
 </section><section>
 <div class="row"><label class="fill">Font size<div class="row" style="flex-wrap:nowrap"><button type="button" data-step="-1" aria-label="Decrease font size">−</button><input data-size type="number" step="any" placeholder="Default" aria-label="Font size"><button type="button" data-step="1" aria-label="Increase font size">+</button></div></label><label style="width:80px">Unit<select data-unit></select></label></div>
 <label>Font family<select data-font><option value="">Default</option><option value="body">Sans serif</option><option value="serif">Serif</option><option value="mono">Monospace</option><option value="rounded">Rounded</option></select></label>
 <div class="row"><button type="button" data-flag="bold">Bold</button><button type="button" data-flag="italic">Italic</button><button type="button" data-decoration="underline">Underline</button><button type="button" data-decoration="line-through">Strikethrough</button><button type="button" data-decoration="overline">Overline</button></div>
 <label data-alignment>Alignment<select data-align><option value="">Default</option><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>
 <div class="preview"><span data-preview>The quick brown fox ✨</span></div>
 </section>
 <footer><button type="button" data-cancel>Cancel</button><button type="submit">Save</button><button type="button" data-resize>⤡</button></footer>
 </form>`;
	const q = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
	q('[data-title]').textContent = title;
	q('[data-alignment]').hidden = !alignment;
	q<HTMLSelectElement>('[data-unit]').replaceChildren(...FONT_SIZE_UNITS.map((unit) => new Option(unit, unit)));
	const format = q<HTMLSelectElement>('[data-format]');
	const input = q<HTMLInputElement>('[data-colour]');
	const size = q<HTMLInputElement>('[data-size]');
	const unit = q<HTMLSelectElement>('[data-unit]');
	const font = q<HTMLSelectElement>('[data-font]');
	const preview = q('[data-preview]');
	const wheel = q('.wheel');
	const previewDraft = () => {
		preview.removeAttribute('style');
		Object.assign(preview.style, styleTokensToCss(sanitizeStyleTokens(draft)));
		dialog
			.querySelectorAll<HTMLElement>('[data-flag]')
			.forEach((b) => b.setAttribute('aria-pressed', String(Boolean(draft[b.dataset.flag as 'bold' | 'italic']))));
		dialog
			.querySelectorAll<HTMLElement>('[data-decoration]')
			.forEach((b) => b.setAttribute('aria-pressed', String(draft.decoration?.split(' ').includes(b.dataset.decoration!) || false)));
		if (initialized) {
			previewed = true;
			previewDocument?.(sanitizeStyleTokens(draft), clearExisting);
		}
	};
	const syncColour = () => {
		const [h, s, l] = rgbaToHsl(colour),
			a = Math.round(colour.a * 1000) / 1000;
		const channels = [colour.r, colour.g, colour.b].map(Math.round).join(', ');
		input.value =
			format.value === 'HEX'
				? rgbaToHex(colour)
				: format.value.startsWith('RGB')
				? `${format.value === 'RGBA' || a < 1 ? 'rgba' : 'rgb'}(${channels}${format.value === 'RGBA' || a < 1 ? ', ' + a : ''})`
				: `${format.value === 'HSLA' || a < 1 ? 'hsla' : 'hsl'}(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%${
						format.value === 'HSLA' || a < 1 ? ', ' + a : ''
				  })`;
		q<HTMLInputElement>('[data-alpha]').value = q<HTMLInputElement>('[data-alpha-number]').value = String(Math.round(colour.a * 100));
		q<HTMLInputElement>('[data-hue]').value = String(hue);
		q<HTMLInputElement>('[data-saturation]').value = String(saturation);
		q<HTMLInputElement>('[data-lightness]').value = String(lightness);
		wheel.setAttribute('aria-valuenow', String(Math.round(hue)));
		wheel.setAttribute('aria-valuetext', `${Math.round(hue)} degrees, ${Math.round(saturation)}% saturation`);
		wheel.style.background = `radial-gradient(circle closest-side,hsl(0 0% ${lightness}%),transparent),conic-gradient(from 90deg,${[
			0, 60, 120, 180, 240, 300, 360
		]
			.map((h) => `hsl(${h} 100% ${lightness}%)`)
			.join(',')})`;
		const indicator = q<HTMLElement>('.wheel i');
		indicator.style.left = `${50 + (Math.cos((hue * Math.PI) / 180) * saturation) / 2}%`;
		indicator.style.top = `${50 + (Math.sin((hue * Math.PI) / 180) * saturation) / 2}%`;
		indicator.style.background = rgbaToHex(colour);
		input.setCustomValidity('');
		input.removeAttribute('aria-invalid');
		q('#tt-colour-error').hidden = true;
	};
	const updateColour = (fromHsl = false) => {
		if (fromHsl) colour = hslToRgba(hue, saturation, lightness, colour.a);
		draft[colourTarget] = rgbaToHex(colour);
		syncColour();
		previewDraft();
	};
	const loadColour = () => {
		const token = draft[colourTarget];
		// Resolve a theme swatch through the DOM without storing a computed theme colour.
		const probe = document.createElement('span');
		probe.style.color = token || 'hsl(320 100% 50%)';
		dialog.append(probe);
		colour = parseColor(token || '') || parseColor(getComputedStyle(probe).color) || hslToRgba(320, 100, 50, 1);
		probe.remove();
		[hue, saturation, lightness] = rgbaToHsl(colour);
		syncColour();
	};
	const loadDraft = () => {
		const match = /^(\d+(?:\.\d+)?)(.*)$/.exec(String(draft.size ?? ''));
		size.value = match?.[1] || '';
		unit.value = match?.[2] || 'px';
		font.value = draft.font || '';
		q<HTMLSelectElement>('[data-align]').value = draft.align || '';
		loadColour();
		previewDraft();
	};
	STYLE_PALETTE.forEach((swatch) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.title = swatch.label;
		b.setAttribute('aria-label', swatch.label);
		b.style.background = swatch.css;
		b.onclick = () => {
			draft[colourTarget] = swatch.css;
			loadColour();
			previewDraft();
		};
		q('.swatches').append(b);
	});
	dialog.querySelectorAll<HTMLElement>('[data-target]').forEach(
		(b) =>
			(b.onclick = () => {
				colourTarget = b.dataset.target as typeof colourTarget;
				dialog.querySelectorAll<HTMLElement>('[data-target]').forEach((t) => t.setAttribute('aria-pressed', String(t === b)));
				loadColour();
			})
	);
	q('[data-clear]').onclick = () => {
		delete draft[colourTarget];
		loadColour();
		previewDraft();
	};
	q('[data-reset]').onclick = () => {
		draft = {};
		clearExisting = true;
		loadDraft();
	};
	format.onchange = syncColour;
	input.oninput = () => {
		const parsed = parseColor(input.value);
		if (!parsed) {
			input.setCustomValidity('Enter a valid colour');
			input.setAttribute('aria-invalid', 'true');
			q('#tt-colour-error').hidden = false;
			return;
		}
		colour = parsed;
		[hue, saturation, lightness] = rgbaToHsl(colour);
		draft[colourTarget] = rgbaToHex(colour);
		input.setCustomValidity('');
		input.removeAttribute('aria-invalid');
		q('#tt-colour-error').hidden = true;
		const typed = input.value;
		syncColour();
		input.value = typed;
		previewDraft();
	};
	input.onchange = () => {
		if (input.validity.valid) syncColour();
	};
	const changeAlpha = (e: Event) => {
		const n = Number((e.target as HTMLInputElement).value);
		if (Number.isFinite(n)) {
			colour.a = clamp(n / 100);
			updateColour();
		}
	};
	q<HTMLInputElement>('[data-alpha]').oninput = changeAlpha;
	q<HTMLInputElement>('[data-alpha-number]').oninput = changeAlpha;
	q<HTMLInputElement>('[data-hue]').oninput = (e) => {
		hue = Number((e.target as HTMLInputElement).value);
		updateColour(true);
	};
	q<HTMLInputElement>('[data-saturation]').oninput = (e) => {
		saturation = Number((e.target as HTMLInputElement).value);
		updateColour(true);
	};
	q<HTMLInputElement>('[data-lightness]').oninput = (e) => {
		lightness = Number((e.target as HTMLInputElement).value);
		updateColour(true);
	};
	const pick = (e: PointerEvent) => {
		const rect = wheel.getBoundingClientRect(),
			x = e.clientX - rect.left - rect.width / 2,
			y = e.clientY - rect.top - rect.height / 2;
		hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
		saturation = clamp(Math.hypot(x, y) / (rect.width / 2)) * 100;
		updateColour(true);
	};
	wheel.onpointerdown = (e) => {
		wheel.setPointerCapture(e.pointerId);
		pick(e);
	};
	wheel.onpointermove = (e) => {
		if (wheel.hasPointerCapture(e.pointerId)) pick(e);
	};
	wheel.onkeydown = (e) => {
		if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(e.key)) {
			e.preventDefault();
			hue = (hue + (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1) + 360) % 360;
			updateColour(true);
		}
	};
	const saveSize = () => {
		const [min, max] = SIZE_LIMITS[unit.value];
		size.min = String(min);
		size.max = String(max);
		if (size.value === '') delete draft.size;
		else draft.size = `${clamp(Number(size.value), min, max)}${unit.value}`;
		previewDraft();
	};
	size.oninput = saveSize;
	let previousUnit = unit.value;
	unit.onfocus = () => {
		previousUnit = unit.value;
	};
	unit.onchange = () => {
		const pixels: Record<string, number> = {
			px: 1,
			em: emPixels,
			rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
			pt: 4 / 3,
			'%': emPixels / 100
		};
		if (size.value) size.value = String(Math.round(((Number(size.value) * pixels[previousUnit]) / pixels[unit.value]) * 100) / 100);
		previousUnit = unit.value;
		saveSize();
	};
	dialog.querySelectorAll<HTMLElement>('[data-step]').forEach(
		(b) =>
			(b.onclick = () => {
				const [min, max] = SIZE_LIMITS[unit.value];
				const step = ['em', 'rem'].includes(unit.value) ? 0.1 : 1;
				size.value = String(
					Math.round(
						clamp(
							Number(size.value || (['em', 'rem'].includes(unit.value) ? 1 : unit.value === '%' ? 100 : 16)) + Number(b.dataset.step) * step,
							min,
							max
						) * 100
					) / 100
				);
				saveSize();
			})
	);
	font.onchange = () => {
		draft.font = (font.value as FontKey) || undefined;
		previewDraft();
	};
	q<HTMLSelectElement>('[data-align]').onchange = (e) => {
		draft.align = ((e.target as HTMLSelectElement).value as TextStyleTokens['align']) || undefined;
		previewDraft();
	};
	dialog.querySelectorAll<HTMLElement>('[data-flag]').forEach(
		(b) =>
			(b.onclick = () => {
				const key = b.dataset.flag as 'bold' | 'italic';
				draft[key] = !draft[key];
				previewDraft();
			})
	);
	dialog.querySelectorAll<HTMLElement>('[data-decoration]').forEach(
		(b) =>
			(b.onclick = () => {
				const values = new Set((draft.decoration || '').split(' ').filter((v) => v && v !== 'none'));
				const key = b.dataset.decoration!;
				if (values.has(key)) values.delete(key);
				else values.add(key);
				draft.decoration = [...values].join(' ') || 'none';
				previewDraft();
			})
	);
	const close = () => {
		if (!dialog.isConnected) return;
		if (!saved && previewed) cancel?.();
		cleanupResize();
		cleanupMove();
		dialog.close();
		dialog.remove();
		window.visualViewport?.removeEventListener('resize', resize);
		if (closeActive === close) closeActive = undefined;
		if (restoreFocus) restoreFocus();
		else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
	};
	const resize = () => {
		dialog.style.maxHeight = `${Math.max(160, (window.visualViewport?.height || window.innerHeight) - 24)}px`;
	};
	q('[data-cancel]').onclick = close;
	dialog.oncancel = (e) => {
		e.preventDefault();
		close();
	};
	q<HTMLFormElement>('form').onsubmit = (e) => {
		e.preventDefault();
		if (!q<HTMLFormElement>('form').reportValidity()) return;
		const clean = sanitizeStyleTokens(draft);
		saved = true;
		close();
		apply(clean, clearExisting);
	};
	// Editor.js must not treat keyboard events in the picker as block commands.
	dialog.addEventListener('keydown', (e) => {
		e.stopPropagation();
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.altKey && !e.isComposing && historyCommand) {
			e.preventDefault();
			saved = true;
			close();
			historyCommand(e.shiftKey);
		}
	});
	document.body.append(dialog);
	dialog.showModal();
	const cleanupResize = makeEditorPanelResizable(dialog, q('[data-resize]'));
	const cleanupMove = makeEditorPanelMovable(dialog, q('[data-title]'));
	resize();
	window.visualViewport?.addEventListener('resize', resize);
	loadDraft();
	initialized = true;
	closeActive = close;
	return close;
};
