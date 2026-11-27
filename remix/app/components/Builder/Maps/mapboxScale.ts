const finite = (value: unknown, fallback: number) => {
	const parsed = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
	return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function mapboxMarkerScale(base: unknown, adaptive: unknown, reference: unknown, zoom: unknown) {
	const markerBaseScale = clamp(finite(base, 1), 0.25, 2);
	const factor = adaptive === true || adaptive === 'true' ? clamp(2 ** ((finite(zoom, 12) - finite(reference, 12)) / 4), 0.5, 1.5) : 1;
	return { markerBaseScale, markerScale: Math.max(0.2, markerBaseScale * factor) };
}

type ZoomMap = { getZoom?: () => number; on: (event: string, callback: () => void) => void; off?: (event: string, callback: () => void) => void };
type Frames = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>;
/** Read the SDK's actual camera and coalesce zoom events in the owning realm. */
export function observeMapboxZoom(map: ZoomMap, view: Frames, receive: (zoom: number) => void): () => void {
	let live = true, frame: number | null = null;
	const read = () => { const zoom = map.getZoom?.(); if (live && typeof zoom === 'number' && Number.isFinite(zoom)) receive(zoom); };
	const schedule = () => { if (frame === null && live) frame = view.requestAnimationFrame(() => { frame = null; read(); }); };
	map.on('zoom', schedule); read();
	return () => { live = false; map.off?.('zoom', schedule); if (frame !== null) view.cancelAnimationFrame(frame); frame = null; };
}

/** Only the inner visual is transformed; the SDK owns the anchor transform. */
export function applyMapboxMarkerScale(anchor: HTMLElement, visual: HTMLElement, scale: number) {
	anchor.style.setProperty('--tt-map-marker-scale', String(scale));
	visual.style.setProperty('--tt-map-marker-min-target', `${44 / Math.min(1, scale)}px`);
	visual.style.transform = `scale(${scale})`;
	visual.style.transformOrigin = 'center center';
}
