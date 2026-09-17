import React from 'react';
import { createPortal } from 'react-dom';

export const VIEWPORT_PRESETS = [
	{ id: 'full', label: 'Full width', width: 0, height: 0 },
	{ id: 'desktop', label: 'Desktop · 1440 × 900', width: 1440, height: 900 },
	{ id: 'tablet', label: 'Tablet · 768 × 1024', width: 768, height: 1024 },
	{ id: 'mobile', label: 'Mobile · 390 × 844', width: 390, height: 844 },
	{ id: 'iphone-se', label: 'iPhone SE · 375 × 667', width: 375, height: 667 },
	{ id: 'iphone-14', label: 'iPhone 14 · 390 × 844', width: 390, height: 844 },
	{ id: 'ipad-air', label: 'iPad Air · 820 × 1180', width: 820, height: 1180 },
	{ id: 'laptop', label: 'Laptop · 1366 × 768', width: 1366, height: 768 },
	{ id: 'wide', label: 'Wide desktop · 1920 × 1080', width: 1920, height: 1080 }
] as const;
export type BuilderViewportSize = { width: number; height: number } | null;
export const boundViewportDimension = (value: number, fallback: number) =>
	Number.isFinite(value) ? Math.round(Math.min(3840, Math.max(240, value))) : fallback;

// A portal preserves the live React/runtime context, while the iframe gives
// CSS media queries a real viewport. No app scripts or duplicate API runtime
// are booted inside it. Only the host's styles are mirrored into its head.
export function BuilderViewport({ size, children }: { size: BuilderViewportSize; children: React.ReactNode }) {
	const holder = React.useRef<HTMLDivElement>(null);
	const frame = React.useRef<HTMLIFrameElement>(null);
	const [doc, setDoc] = React.useState<Document | null>(null);
	const [available, setAvailable] = React.useState(960);
	const framed = !!size;
	React.useLayoutEffect(() => {
		if (!holder.current) return;
		const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
		observer.observe(holder.current);
		return () => observer.disconnect();
	}, [framed]);
	React.useLayoutEffect(() => {
		if (!doc) return;
		const sync = () => {
			const next = document.createDocumentFragment();
			for (const style of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
				const clone = style.cloneNode(true) as HTMLElement;
				clone.dataset.previewStyle = 'true';
				// Emotion's production sheets can use CSSOM insertRule rather than
				// text nodes. Copy the actual rules, not an empty style element.
				if (style instanceof HTMLStyleElement && style.sheet) {
					try {
						clone.textContent = Array.from(style.sheet.cssRules, (rule) => rule.cssText).join('\n');
					} catch {
						/* cross-origin sheet */
					}
				}
				next.append(clone);
			}
			for (const old of doc.head.querySelectorAll('[data-preview-style]')) old.remove();
			doc.head.append(next);
			const computed = getComputedStyle(document.documentElement);
			for (const name of Array.from(computed))
				if (name.startsWith('--')) doc.documentElement.style.setProperty(name, computed.getPropertyValue(name));
		};
		sync();
		const followFragment = (event: MouseEvent) => {
			if (event.defaultPrevented) return;
			const anchor = (event.target as Element)?.closest?.('a[href^="#"]');
			const fragment = anchor?.getAttribute('href')?.slice(1);
			if (!fragment) return;
			let id = fragment;
			try {
				id = decodeURIComponent(fragment);
			} catch {
				/* literal id */
			}
			const target = doc.getElementById(id);
			if (target) {
				event.preventDefault();
				target.scrollIntoView();
			}
		};
		doc.addEventListener('click', followFragment);
		const observer = new MutationObserver(sync);
		observer.observe(document.head, { subtree: true, childList: true, characterData: true });
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
		return () => {
			observer.disconnect();
			doc.removeEventListener('click', followFragment);
		};
	}, [doc, children]);
	if (!size) return <>{children}</>;
	const scale = Math.min(1, available / size.width);
	return (
		<div ref={holder} data-testid="builder-viewport" style={{ width: '100%', minWidth: 0 }}>
			<div
				style={{
					width: size.width * scale,
					height: size.height * scale,
					margin: '0 auto',
					overflow: 'hidden',
					outline: '1px solid #ddd',
					outlineOffset: '-1px',
					boxSizing: 'content-box',
					maxWidth: '100%'
				}}
			>
				<iframe
					ref={frame}
					title="Responsive page preview"
					srcDoc={
						'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_top"></head><body style="margin:0"><div id="page"></div></body></html>'
					}
					onLoad={() => setDoc(frame.current?.contentDocument || null)}
					style={{ display: 'block', border: 0, width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
				/>
			</div>
			{doc?.getElementById('page') ? createPortal(children, doc.getElementById('page')!) : null}
		</div>
	);
}
