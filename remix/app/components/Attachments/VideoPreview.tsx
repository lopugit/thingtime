import React from 'react';
import { Box, type BoxProps } from '@chakra-ui/react';

/** A paused thumbnail, never autoplay. Safari may load metadata without decoding
 * the first frame until a seek; requesting a tiny offset makes it paint inline. */
export function VideoPreview({ src, label, ...props }: BoxProps & { src: string; label: string }) {
	return <Box as="video" key={src} src={src || undefined} aria-label={label}
		muted playsInline preload="metadata" referrerPolicy="no-referrer"
		width="100%" height="100%" objectFit="cover" display="block"
		background="var(--tt-ink, #16161a)" {...props}
		onLoadedMetadata={(event: React.SyntheticEvent<HTMLVideoElement>) => {
			const video = event.currentTarget;
			if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime === 0) {
				try { video.currentTime = Math.min(0.01, video.duration / 2); } catch { /* Playback remains available in the viewer. */ }
			}
		}} />;
}
