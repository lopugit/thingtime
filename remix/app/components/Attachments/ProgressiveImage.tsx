import React from 'react';
import { Box, Button, Spinner, Text, type BoxProps } from '@chakra-ui/react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { mediaPreferences, registerMediaCache } from '~/utils/mediaCache.client';

const widths = [320, 640, 1280, 1920];
export function imageVariantUrl(src: string, width: number): string | null {
	if (!src.startsWith('/api/v1/attachments/content?')) return null;
	const params = new URLSearchParams(src.split('?')[1]);
	if (!params.has('id') || params.has('download')) return null;
	params.set('width', String(width));
	return `/api/v1/attachments/content?${params}`;
}

// Key the inner component by source so an old decoded image never flashes for a new attachment.
export const ProgressiveImage = (props: BoxProps & { src: string; alt: string; sizes?: string; loading?: 'lazy' | 'eager'; retryControl?: boolean }) => (
	<ImageContent key={props.src} {...props} />
);

function ImageContent({ src, alt, sizes = '(max-width: 640px) 100vw, 680px', loading = 'lazy', retryControl = true, ...props }: Parameters<typeof ProgressiveImage>[0]) {
	const ref = React.useRef<HTMLDivElement>(null);
	const viewId = React.useId();
	const [attempt, setAttempt] = React.useState(0);
	const viewSrc = imageVariantUrl(src, 64) ? `${src}&view=${encodeURIComponent(`${viewId}-${attempt}`)}` : src;
	const [visible, setVisible] = React.useState(loading === 'eager');
	const [variants, setVariants] = React.useState<boolean | null>(imageVariantUrl(src, 64) ? null : false);
	const [ratio, setRatio] = React.useState('4 / 3');
	const [loaded, setLoaded] = React.useState(false);
	const [fallback, setFallback] = React.useState(false);
	const [failed, setFailed] = React.useState(false);
	React.useEffect(() => {
		let live = true;
		if (!imageVariantUrl(src, 64) || !mediaPreferences().previews) {
			setVariants(false);
			return;
		}
		// Cache registration is optional and must never hold the first image paint.
		void registerMediaCache();
		let timer: ReturnType<typeof setTimeout>;
		Promise.race([
			requireThingtimeCapability('api.attachment-content', '1.1.0'),
			new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Preview unavailable')), 5000); })
		]).then(
			() => {
				if (live) setVariants(true);
			},
			() => {
				if (live) setVariants(false);
			}
		).finally(() => clearTimeout(timer));
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [src]);
	React.useEffect(() => {
		if (visible || !ref.current) return;
		if (typeof IntersectionObserver === 'undefined') {
			setVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					setVisible(true);
					observer.disconnect();
				}
			},
			{ rootMargin: '300px' }
		);
		observer.observe(ref.current);
		return () => observer.disconnect();
	}, [visible]);
	const progressive = variants === true && !fallback;
	const active = !!src && visible && variants !== null;
	React.useEffect(() => {
		if (!active || loaded || failed) return;
		const timer = setTimeout(() => {
			if (progressive) setFallback(true);
			else setFailed(true);
		}, progressive ? 30_000 : 45_000);
		return () => clearTimeout(timer);
	}, [active, loaded, failed, progressive, attempt]);
	const retry = () => { setFailed(false); setLoaded(false); setFallback(true); setAttempt(value => value + 1); };
	return (
		<Box
			ref={ref}
			position="relative"
			minHeight="32px"
			aspectRatio={!loaded && props.height !== '100%' ? ratio : undefined}
			{...props}
			overflow="hidden"
			aria-busy={active && !loaded && !failed}
		>
			{active && variants === true && !loaded && !failed ? (
				<Box
					as="img"
					src={imageVariantUrl(viewSrc, 64)!}
					alt=""
					aria-hidden="true"
					onLoad={(event) => setRatio(`${event.currentTarget.naturalWidth} / ${event.currentTarget.naturalHeight}`)}
					position="absolute"
					inset={0}
					width="100%"
					height="100%"
					objectFit={props.objectFit || 'cover'}
					filter="blur(8px)"
				/>
			) : null}
			{active && !failed ? (
				<Box
					key={`${attempt}-${progressive}`}
					as="img"
					src={progressive ? imageVariantUrl(viewSrc, 1280)! : viewSrc}
					srcSet={progressive ? widths.map((width) => `${imageVariantUrl(viewSrc, width)} ${width}w`).join(', ') : undefined}
					sizes={progressive ? sizes : undefined}
					alt={alt}
					decoding="async"
					referrerPolicy="no-referrer"
					// Visibility is already controlled above. A second native lazy gate
					// can leave Safari's sharp layer deferred behind its blurred preview.
					loading="eager"
					width="100%"
					height={props.height === '100%' ? '100%' : undefined}
					maxHeight={props.maxHeight}
					objectFit={props.objectFit || 'cover'}
					display="block"
					opacity={progressive && !loaded ? 0 : 1}
					onLoad={(event) => { setRatio(`${event.currentTarget.naturalWidth} / ${event.currentTarget.naturalHeight}`); setLoaded(true); }}
					onError={() => {
						if (progressive) setFallback(true);
						else setFailed(true);
						setLoaded(false);
					}}
				/>
			) : null}
			{active && !loaded && !failed ? <Box position="absolute" bottom={2} right={2} pointerEvents="none">
				<Spinner size="sm" label={`Loading ${alt || 'image'}`} sx={{ '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }} />
			</Box> : null}
			{failed ? <Box position="absolute" inset={0} display="flex" flexDirection="column" alignItems="center" justifyContent="center" gap={2} padding={2}>
				<Text role="status" fontSize="sm" textAlign="center">{retryControl ? 'Image unavailable' : 'Image unavailable. Open to retry.'}</Text>
				{retryControl ? <Button size="sm" minHeight="44px" aria-label={`Retry ${alt || 'image'}`} onClick={event => { event.preventDefault(); event.stopPropagation(); retry(); }}>Retry image</Button> : null}
			</Box> : null}
		</Box>
	);
}
