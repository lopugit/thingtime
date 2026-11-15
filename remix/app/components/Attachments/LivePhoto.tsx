import React from 'react';
import { Box, Button, Spinner, Text } from '@chakra-ui/react';
import { ProgressiveImage } from './ProgressiveImage';

type Props = {
	stillSrc: string;
	motionSrc: string;
	label: string;
	onOpen?: () => void;
	fill?: boolean;
	compact?: boolean;
	lightbox?: boolean;
};

/** Shared feed and lightbox control: tap opens, hold previews, release restores the still. */
export function LivePhoto({ stillSrc, motionSrc, label, onOpen, fill, compact, lightbox }: Props) {
	const [playing, setPlaying] = React.useState(false);
	const [ready, setReady] = React.useState(false);
	const [failed, setFailed] = React.useState(false);
	const [stillFailed, setStillFailed] = React.useState(false);
	const [stillAttempt, setStillAttempt] = React.useState(0);
	const video = React.useRef<HTMLVideoElement>(null);
	const generation = React.useRef(0);
	const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const held = React.useRef(false);
	const suppressClick = React.useRef(false);
	const origin = React.useRef<{ x: number; y: number } | null>(null);
	const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
	const stop = React.useCallback(() => {
		generation.current += 1;
		clearTimer();
		if (held.current) suppressClick.current = true;
		held.current = false;
		video.current?.pause();
		if (video.current) { try { video.current.currentTime = 0; } catch { /* Source may not have loaded. */ } }
		setPlaying(false);
	}, []);
	React.useEffect(() => {
		if (!playing || failed) return;
		const current = generation.current;
		const element = video.current;
		void element?.play().then(() => {
			if (current !== generation.current) element.pause();
		}).catch(() => { if (current === generation.current) { setFailed(true); setPlaying(false); } });
	}, [playing, failed]);
	React.useEffect(() => {
		window.addEventListener('scroll', stop, true);
		window.addEventListener('blur', stop);
		const hidden = () => { if (document.hidden) stop(); };
		document.addEventListener('visibilitychange', hidden);
		return () => { window.removeEventListener('scroll', stop, true); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden); stop(); };
	}, [stop]);
	React.useEffect(() => { stop(); setReady(false); setFailed(false); setStillFailed(false); setStillAttempt(0); }, [stillSrc, motionSrc, stop]);
	const start = () => {
		clearTimer();
		suppressClick.current = false;
		timer.current = setTimeout(() => { held.current = true; if (!failed) setPlaying(true); }, 350);
	};
	const retrySrc = stillAttempt ? `${stillSrc}${stillSrc.includes('?') ? '&' : '?'}view=${stillAttempt}` : stillSrc;
	return <Box position={fill ? 'absolute' : 'relative'} inset={fill ? 0 : undefined} width="100%"
		height={fill || lightbox ? '100%' : undefined} maxHeight={lightbox ? '100%' : compact ? '360px' : '640px'}>
	<Box as="button" type="button" aria-label={`${label}, Live Photo. Press and hold to play${onOpen ? '; tap to open' : ''}.`}
		aria-pressed={playing} data-live-photo="true" data-playing={playing ? 'true' : 'false'}
		position="relative" display="block" width="100%"
		height={fill || lightbox ? '100%' : undefined} maxHeight={lightbox ? '100%' : compact ? '360px' : '640px'}
		cursor="pointer" overflow="hidden" borderRadius="var(--tt-radius-md, 12px)"
		sx={{ touchAction: lightbox ? 'pan-y pinch-zoom' : 'pan-y', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
		onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()}
		onPointerDown={(event: React.PointerEvent) => {
			if (event.pointerType === 'mouse' && event.button !== 0) return;
			origin.current = { x: event.clientX, y: event.clientY }; start();
		}}
		onPointerMove={(event: React.PointerEvent) => {
			if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) {
				origin.current = null; stop(); suppressClick.current = true;
			}
		}}
		onPointerUp={() => { origin.current = null; stop(); }}
		onPointerCancel={() => { origin.current = null; stop(); suppressClick.current = true; }}
		onPointerLeave={() => { origin.current = null; stop(); }}
		onBlur={stop}
		onKeyDown={(event: React.KeyboardEvent) => {
			if (event.key === ' ' && !event.repeat) { event.preventDefault(); start(); }
		}}
		onKeyUp={(event: React.KeyboardEvent) => {
			if (event.key === ' ') { event.preventDefault(); stop(); }
		}}
		onClick={(event: React.MouseEvent) => {
			event.stopPropagation();
			if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); return; }
			onOpen?.();
		}}
	>
		{lightbox ? <Box as="img" key={retrySrc} src={retrySrc} alt={label}
			width="100%" height="100%" objectFit="contain" onError={() => setStillFailed(true)} onLoad={() => setStillFailed(false)} /> :
			<ProgressiveImage src={stillSrc} alt={label} loading="lazy" retryControl={false}
				width="100%" height={fill ? '100%' : undefined} objectFit="cover" aspectRatio={!fill ? '4 / 3' : undefined} />}
		<Box as="video" ref={video} src={motionSrc} muted loop playsInline preload="none" aria-hidden="true"
			position="absolute" inset={0} width="100%" height="100%" objectFit={lightbox ? 'contain' : 'cover'}
			opacity={playing && ready && !failed ? 1 : 0} pointerEvents="none"
			onPlaying={() => setReady(true)} onError={() => { setFailed(true); setPlaying(false); }} />
		{playing && !ready && !failed ? <Spinner position="absolute" bottom={2} right={2} size="xs" color="white" aria-label="Loading Live Photo motion" /> : null}
		{failed ? <Text position="absolute" bottom={2} left={2} color="white" background="rgba(0,0,0,.7)" fontSize="xs" paddingX={2} paddingY={1} role="status">Motion unavailable; still photo shown</Text> : null}
		<Text position="absolute" top={2} right={2} color="white" background="rgba(0,0,0,.62)" borderRadius="full"
			fontSize="10px" fontWeight="bold" letterSpacing=".12em" paddingX={2} paddingY={1} aria-hidden="true">LIVE</Text>
	</Box>
	{lightbox && stillFailed ? <Button position="absolute" bottom={3} left={3} size="sm" zIndex={1}
		onClick={(event) => { event.stopPropagation(); setStillFailed(false); setStillAttempt((value) => value + 1); }}>
		Retry still photo
	</Button> : null}
	</Box>;
}
