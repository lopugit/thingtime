import React from 'react';
import { Box, Button, Flex, IconButton } from '@chakra-ui/react';
import { Minus, Plus } from 'lucide-react';
import { ProgressiveImage } from './ProgressiveImage';
import { boundImageZoom, INITIAL_IMAGE_ZOOM, MAX_IMAGE_ZOOM, zoomImageAt, type ImageBounds, type Point } from './imageZoomCore';

// Mounted per attachment/open session by MediaLightbox. Only this viewport
// owns touch gestures; video controls and the gallery toolbar stay native.
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
	const stage = React.useRef<HTMLDivElement>(null);
	const pointers = React.useRef(new Map<number, Point>());
	const zoomRef = React.useRef(INITIAL_IMAGE_ZOOM);
	const [zoom, setZoom] = React.useState(INITIAL_IMAGE_ZOOM);
	const apply = (next: typeof zoom) => { zoomRef.current = next; setZoom(next); };
	const bounds = (): ImageBounds => {
		const element = stage.current;
		const width = element?.clientWidth || 0;
		const height = element?.clientHeight || 0;
		const image = element?.querySelector<HTMLImageElement>('img:not([aria-hidden])');
		const fit = image?.naturalWidth && image.naturalHeight ? Math.min(width / image.naturalWidth, height / image.naturalHeight) : 0;
		return { width, height, imageWidth: fit ? image!.naturalWidth * fit : width, imageHeight: fit ? image!.naturalHeight * fit : height };
	};
	React.useEffect(() => {
		const element = stage.current;
		if (!element) return;
		const observer = new ResizeObserver(() => {
			pointers.current.clear();
			zoomRef.current = INITIAL_IMAGE_ZOOM;
			setZoom(INITIAL_IMAGE_ZOOM);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const point = (event: React.PointerEvent<HTMLDivElement>): Point => {
		const rect = event.currentTarget.getBoundingClientRect();
		return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
	};
	const stopPointer = (event: React.PointerEvent<HTMLDivElement>) => {
		pointers.current.delete(event.pointerId);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
	};
	const changeScale = (scale: number) => apply(zoomImageAt(zoomRef.current, scale, { x: 0, y: 0 }, { x: 0, y: 0 }, bounds()));
	return (
		<Flex direction="column" width="100%" height="100%" minHeight={0} minWidth={0} onClick={(event) => event.stopPropagation()}>
			<Box
				ref={stage} flex="1" minHeight={0} width="100%" overflow="hidden" position="relative"
				role="group" aria-label="Zoomable image" tabIndex={0}
				sx={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
				cursor={zoom.scale > 1 ? 'grab' : 'zoom-in'}
				onDragStart={(event) => event.preventDefault()}
				onLoadCapture={() => apply(boundImageZoom(zoomRef.current, bounds()))}
				onPointerDown={(event) => {
					if (event.pointerType === 'mouse' && event.button !== 0) return;
					pointers.current.set(event.pointerId, point(event));
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					if (!pointers.current.has(event.pointerId)) return;
					const before = [...pointers.current.values()];
					pointers.current.set(event.pointerId, point(event));
					const after = [...pointers.current.values()];
					if (before.length >= 2) {
						const midpoint = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
						const distance = (points: Point[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
						if (distance(before) < 1) return;
						apply(zoomImageAt(zoomRef.current, zoomRef.current.scale * distance(after) / distance(before), midpoint(before), midpoint(after), bounds()));
					} else {
						apply(boundImageZoom({ ...zoomRef.current, x: zoomRef.current.x + after[0].x - before[0].x, y: zoomRef.current.y + after[0].y - before[0].y }, bounds()));
					}
				}}
				onPointerUp={stopPointer} onPointerCancel={stopPointer}
				onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
				onDoubleClick={(event) => {
					const rect = event.currentTarget.getBoundingClientRect();
					const focus = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
					apply(zoomRef.current.scale > 1 ? INITIAL_IMAGE_ZOOM : zoomImageAt(zoomRef.current, 2, focus, focus, bounds()));
				}}
				onKeyDown={(event) => {
					if (event.key === '+' || event.key === '=') { event.preventDefault(); changeScale(zoomRef.current.scale + 0.5); }
					if (event.key === '-') { event.preventDefault(); changeScale(zoomRef.current.scale - 0.5); }
					if (event.key === '0') { event.preventDefault(); apply(INITIAL_IMAGE_ZOOM); }
				}}
			>
				{/* A pinch or pan rewrites these every pointer frame. Keep the transform in an
				    inline style so emotion does not insert a fresh CSS rule per frame, and
				    quantise `sizes` to whole steps so the browser reruns srcset selection a
				    handful of times per gesture instead of once per frame. */}
				<ProgressiveImage src={src} alt={alt} loading="eager" sizes={`${Math.ceil(zoom.scale) * 100}vw`}
					width="100%" height="100%" objectFit="contain" borderRadius="var(--tt-radius-md, 12px)"
					style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`, transformOrigin: 'center' }} />
			</Box>
			<Flex justify="center" align="center" gap={1} flexShrink={0} paddingTop={1} color="white">
				<IconButton aria-label="Zoom out" icon={<Minus size={16} />} variant="ghost" minWidth="44px" height="44px" isDisabled={zoom.scale <= 1} onClick={() => changeScale(zoomRef.current.scale - 0.5)} />
				<Button aria-label="Reset image zoom" variant="ghost" height="44px" onClick={() => apply(INITIAL_IMAGE_ZOOM)}>{Math.round(zoom.scale * 100)}%</Button>
				<IconButton aria-label="Zoom in" icon={<Plus size={16} />} variant="ghost" minWidth="44px" height="44px" isDisabled={zoom.scale >= MAX_IMAGE_ZOOM} onClick={() => changeScale(zoomRef.current.scale + 0.5)} />
			</Flex>
		</Flex>
	);
}
