import React from 'react';
import { Box, type BoxProps } from '@chakra-ui/react';
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
export const ProgressiveImage = (props: BoxProps & { src: string; alt: string; sizes?: string; loading?: 'lazy' | 'eager' }) => (
	<ImageContent key={props.src} {...props} />
);

function ImageContent({ src, alt, sizes = '(max-width: 640px) 100vw, 680px', loading = 'lazy', ...props }: Parameters<typeof ProgressiveImage>[0]) {
	const ref = React.useRef<HTMLDivElement>(null);
	const viewId = React.useId();
	const viewSrc = imageVariantUrl(src, 64) ? `${src}&view=${encodeURIComponent(viewId)}` : src;
	const [visible, setVisible] = React.useState(loading === 'eager');
	const [variants, setVariants] = React.useState<boolean | null>(imageVariantUrl(src, 64) ? null : false);
	const [ratio, setRatio] = React.useState('4 / 3');
	const [loaded, setLoaded] = React.useState(false);
	const [fallback, setFallback] = React.useState(false);
	React.useEffect(() => {
		let live = true;
		if (!imageVariantUrl(src, 64) || !mediaPreferences().previews) {
			setVariants(false);
			return;
		}
		Promise.race([
			Promise.all([requireThingtimeCapability('api.attachment-content', '1.1.0'), registerMediaCache()]),
			new Promise((_, reject) => setTimeout(() => reject(new Error('Preview unavailable')), 5000))
		]).then(
			() => {
				if (live) setVariants(true);
			},
			() => {
				if (live) setVariants(false);
			}
		);
		return () => {
			live = false;
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
	const active = visible && variants !== null;
	return (
		<Box
			ref={ref}
			position="relative"
			minHeight="32px"
			aspectRatio={!loaded && props.height !== '100%' ? ratio : undefined}
			{...props}
			overflow="hidden"
		>
			{active && progressive && !loaded ? (
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
			{active ? (
				<Box
					as="img"
					src={progressive ? imageVariantUrl(viewSrc, 1280)! : viewSrc}
					srcSet={progressive ? widths.map((width) => `${imageVariantUrl(viewSrc, width)} ${width}w`).join(', ') : undefined}
					sizes={progressive ? sizes : undefined}
					alt={alt}
					decoding="async"
					referrerPolicy="no-referrer"
					loading={loading}
					width="100%"
					height={props.height === '100%' ? '100%' : undefined}
					maxHeight={props.maxHeight}
					objectFit={props.objectFit || 'cover'}
					display="block"
					opacity={progressive && !loaded ? 0 : 1}
					onLoad={() => setLoaded(true)}
					onError={() => {
						setFallback(true);
						setLoaded(false);
					}}
				/>
			) : null}
		</Box>
	);
}
