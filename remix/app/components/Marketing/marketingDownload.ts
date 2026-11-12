// Browser-side download + clipboard helpers for the marketing suite. Every
// function is SSR-safe: nothing here touches `document`, `URL` or
// `navigator` at module scope, and on the server the helpers reject with a
// clear Error (rasterise/download) or resolve `false` (copy) instead of
// throwing synchronously. Pure planning helpers live at the bottom so the
// page's "download all" arithmetic is unit-testable under node --test.

const SVG_MIME = 'image/svg+xml;charset=utf-8';

/** How long an object URL stays alive after the anchor click so the browser has started the download. */
const REVOKE_DELAY_MS = 1000;

const hasDocument = () => typeof document !== 'undefined' && !!document.body;
const hasObjectUrls = () => typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof URL.revokeObjectURL === 'function';

const loadImage = (src: string) =>
	new Promise<HTMLImageElement>((resolve, reject) => {
		if (typeof Image === 'undefined') {
			reject(new Error('Images cannot be decoded outside a browser.'));
			return;
		}
		const image = new Image();
		image.decoding = 'async';
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('The SVG could not be decoded as an image.'));
		image.src = src;
	});

/**
 * Draws an SVG string 1:1 onto a canvas of exactly width × height pixels and
 * returns a PNG Blob. devicePixelRatio is ignored on purpose: the SVG already
 * carries the platform pixel size, and the download must match it exactly.
 * Object URLs are always revoked, even when decoding fails.
 */
export const rasteriseSvg = async (svg: string, width: number, height: number): Promise<Blob> => {
	if (!hasDocument() || !hasObjectUrls() || typeof Blob === 'undefined') throw new Error('Rasterising an SVG needs a browser document.');
	const pixelWidth = Math.max(1, Math.round(width));
	const pixelHeight = Math.max(1, Math.round(height));
	const url = URL.createObjectURL(new Blob([svg], { type: SVG_MIME }));
	try {
		const image = await loadImage(url);
		const canvas = document.createElement('canvas');
		canvas.width = pixelWidth;
		canvas.height = pixelHeight;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('The canvas 2D context is unavailable in this browser.');
		context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
		const blob = await new Promise<Blob | null>((resolve) => {
			if (typeof canvas.toBlob !== 'function') {
				resolve(null);
				return;
			}
			canvas.toBlob(resolve, 'image/png');
		});
		if (!blob) throw new Error('The canvas could not encode a PNG.');
		return blob;
	} finally {
		URL.revokeObjectURL(url);
	}
};

/** Saves a Blob through a throwaway anchor click and revokes the object URL after a tick. */
export const triggerDownload = (blob: Blob, filename: string) => {
	if (!hasDocument() || !hasObjectUrls()) return;
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.rel = 'noopener';
	anchor.style.display = 'none';
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};

export const downloadSvg = (svg: string, filename: string) => {
	if (typeof Blob === 'undefined') return;
	triggerDownload(new Blob([svg], { type: SVG_MIME }), filename);
};

export const downloadPng = async (svg: string, width: number, height: number, filename: string) => {
	const blob = await rasteriseSvg(svg, width, height);
	triggerDownload(blob, filename);
};

/**
 * Copies text to the clipboard. Prefers the async Clipboard API and falls
 * back to a hidden textarea + execCommand('copy'). Resolves `false` (never
 * throws) when the browser blocks both paths or when there is no DOM at all.
 */
export const copyText = async (text: string): Promise<boolean> => {
	try {
		if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Permission denied or insecure context: try the legacy path below.
	}
	if (!hasDocument()) return false;
	let textarea: HTMLTextAreaElement | null = null;
	try {
		textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', '');
		textarea.setAttribute('aria-hidden', 'true');
		textarea.style.position = 'fixed';
		textarea.style.top = '0';
		textarea.style.left = '0';
		textarea.style.opacity = '0';
		textarea.style.pointerEvents = 'none';
		document.body.appendChild(textarea);
		textarea.focus();
		textarea.select();
		textarea.setSelectionRange(0, text.length);
		return typeof document.execCommand === 'function' ? document.execCommand('copy') === true : false;
	} catch {
		return false;
	} finally {
		textarea?.remove();
	}
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs downloads one at a time with a small pause between them so browsers
 * do not treat the burst as a pop-up storm and silently drop files. Never
 * throws: a failing item is counted and the run continues. `onProgress`
 * receives the number of items processed so far (successes + failures).
 */
export const downloadSequentially = async <T>(
	items: T[],
	run: (item: T, index: number) => Promise<void>,
	delayMs = 350,
	onProgress?: (done: number, total: number) => void
): Promise<{ done: number; failed: number }> => {
	let done = 0;
	let failed = 0;
	const total = items.length;
	for (let index = 0; index < total; index++) {
		try {
			await run(items[index], index);
			done += 1;
		} catch {
			failed += 1;
		}
		try {
			onProgress?.(done + failed, total);
		} catch {
			// A progress listener must never abort the batch.
		}
		if (index < total - 1 && delayMs > 0) await sleep(delayMs);
	}
	return { done, failed };
};

/** Default cap on a single "download all" batch: enough for a full trend × format sweep, not enough to wedge a browser. */
export const DOWNLOAD_BATCH_CAP = 40;

/** Pure: how many of `count` downloads a batch may start and how many it leaves for the user to narrow down to. */
export const planDownloads = (count: number, batchCap = DOWNLOAD_BATCH_CAP) => {
	const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
	const safeCap = Math.max(0, Math.floor(Number.isFinite(batchCap) ? batchCap : 0));
	return { allowed: Math.min(safeCount, safeCap), skipped: Math.max(0, safeCount - safeCap) };
};
