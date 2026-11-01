export type Point = { x: number; y: number };
export type ImageZoom = Point & { scale: number };
export type ImageBounds = { width: number; height: number; imageWidth: number; imageHeight: number };
export const INITIAL_IMAGE_ZOOM: ImageZoom = { scale: 1, x: 0, y: 0 };
export const MAX_IMAGE_ZOOM = 5;

export function boundImageZoom(zoom: ImageZoom, bounds: ImageBounds): ImageZoom {
	const scale = Math.max(1, Math.min(MAX_IMAGE_ZOOM, zoom.scale));
	const maxX = Math.max(0, (bounds.imageWidth * scale - bounds.width) / 2);
	const maxY = Math.max(0, (bounds.imageHeight * scale - bounds.height) / 2);
	return { scale, x: maxX ? Math.max(-maxX, Math.min(maxX, zoom.x)) : 0, y: maxY ? Math.max(-maxY, Math.min(maxY, zoom.y)) : 0 };
}

// Points are relative to the stage centre. Preserve the image point under the
// original fingers as their midpoint moves and their separation changes.
export function zoomImageAt(zoom: ImageZoom, scale: number, from: Point, to: Point, bounds: ImageBounds): ImageZoom {
	const nextScale = Math.max(1, Math.min(MAX_IMAGE_ZOOM, scale));
	const ratio = nextScale / zoom.scale;
	return boundImageZoom({ scale: nextScale, x: to.x - (from.x - zoom.x) * ratio, y: to.y - (from.y - zoom.y) * ratio }, bounds);
}
