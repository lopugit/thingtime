import { Box, Flex, IconButton, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import React from 'react';

import { MockScreen } from '~/components/Marketing/MockScreens';
import { MK } from '~/components/Marketing/marketingTheme';
import {
	CLICK_MS,
	MOVE_MS,
	activeTargetFor,
	advance,
	initialState,
	progressFor,
	seekTo,
	seekToHold,
	typedTextFor,
	type PlayerState
} from '~/components/Marketing/walkthroughEngine';
import type { Walkthrough } from '~/marketing/types';

// Plays a Walkthrough (marketing/walkthroughs.ts) over a mock screen: an
// animated macOS-style cursor travels between data-wt targets, clicks
// ripple, typed text lands in the mock, and a caption bar narrates each
// step. The clock is walkthroughEngine.advance() fed with real rAF deltas;
// the loop only runs while the tab is visible and the player is on screen,
// so a page with five players costs nothing until you scroll to them.

type Point = { x: number; y: number };
type CursorPlacement = Point & { animate: boolean };

/** Frames longer than this (a stalled main thread) are treated as one slow frame, not a jump. */
const MAX_FRAME_DELTA_MS = 250;
const VISIBLE_RATIO = 0.2;
const CURSOR_HEIGHT = 22;
const CURSOR_WIDTH = 16;
/** Tip of the arrow inside the 16 × 22 viewBox. */
const CURSOR_HOTSPOT: Point = { x: 1.5, y: 1.5 };
const MOVE_EASE = 'cubic-bezier(.2,.9,.3,1)';

const ripple = keyframes`
	from { transform: translate(-50%, -50%) scale(0.35); opacity: 0.95; }
	to { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
`;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
let reducedMotionCache: { at: number; value: boolean } | null = null;

const readReducedMotion = (): boolean => {
	if (typeof window === 'undefined') return false;
	const now = Date.now();
	if (reducedMotionCache && now - reducedMotionCache.at < 1000) return reducedMotionCache.value;
	let value = false;
	try {
		if (typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches) value = true;
		else if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
			// the theme's motion switches (same gates as confetti / the rainbow text)
			const style = getComputedStyle(document.documentElement);
			if (style.getPropertyValue('--tt-motion').trim() === '0' || style.getPropertyValue('--tt-rainbow-anim').trim() === 'none') value = true;
		}
	} catch {
		value = false;
	}
	reducedMotionCache = { at: now, value };
	return value;
};

const subscribeReducedMotion = (onChange: () => void): (() => void) => {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
	const invalidate = () => {
		reducedMotionCache = null;
		onChange();
	};
	try {
		const query = window.matchMedia(REDUCED_MOTION_QUERY);
		if (typeof query.addEventListener === 'function') {
			query.addEventListener('change', invalidate);
			return () => query.removeEventListener('change', invalidate);
		}
		query.addListener(invalidate);
		return () => query.removeListener(invalidate);
	} catch {
		return () => {};
	}
};

const serverReducedMotion = () => false;

/** True when the viewer prefers reduced motion (media query or the theme's --tt-motion / --tt-rainbow-anim switches). SSR-safe: false on the server. */
export const useReducedMotion = (): boolean => React.useSyncExternalStore(subscribeReducedMotion, readReducedMotion, serverReducedMotion);

/** A macOS-style arrow cursor. The hotspot (tip) sits at (1.5, 1.5) of its 16 × 22 box; scale via `height`. */
export const WalkthroughCursor = ({ height = CURSOR_HEIGHT, style, className }: { height?: number; style?: React.CSSProperties; className?: string }) => (
	<svg
		width={(height * CURSOR_WIDTH) / CURSOR_HEIGHT}
		height={height}
		viewBox={`0 0 ${CURSOR_WIDTH} ${CURSOR_HEIGHT}`}
		aria-hidden="true"
		focusable="false"
		className={className}
		style={{ display: 'block', overflow: 'visible', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))', ...style }}
		data-testid="walkthrough-cursor"
	>
		<path
			d="M1.5 1.5 L1.5 17.6 L5.3 14 L7.9 20.3 L10.9 19 L8.3 12.7 L13.7 12.7 Z"
			fill="#000"
			stroke="#fff"
			strokeWidth={1.5}
			strokeLinejoin="round"
			strokeLinecap="round"
		/>
	</svg>
);

const escapeAttribute = (value: string): string => {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
	return value.replace(/["\\]/g, '\\$&');
};

const findTarget = (frame: HTMLElement, target: string): HTMLElement | null => {
	try {
		return frame.querySelector<HTMLElement>(`[data-wt="${escapeAttribute(target)}"]`);
	} catch {
		return null;
	}
};

/** Centre of `element` in the frame's padding-box coordinates (the cursor layer's origin). */
const centreOf = (frame: HTMLElement, element: HTMLElement): Point => {
	const frameRect = frame.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	return {
		x: rect.left - frameRect.left - frame.clientLeft + frame.scrollLeft + rect.width / 2,
		y: rect.top - frameRect.top - frame.clientTop + frame.scrollTop + rect.height / 2
	};
};

const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

const isScrollable = (node: HTMLElement, frame: HTMLElement): boolean => {
	if (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1) return false;
	try {
		const style = getComputedStyle(node);
		const allowed = node === frame ? ['auto', 'scroll', 'overlay', 'hidden'] : ['auto', 'scroll', 'overlay'];
		return allowed.includes(style.overflowY) || allowed.includes(style.overflowX);
	} catch {
		return node === frame;
	}
};

/**
 * Bring `element` into view inside the frame only — scrolls the frame and
 * any scrollable ancestor between them, never the page.
 */
const scrollWithinFrame = (frame: HTMLElement, element: HTMLElement, reducedMotion: boolean) => {
	if (element.closest('[data-wt-frame]') !== frame) return;
	let node: HTMLElement | null = element.parentElement;
	while (node && frame.contains(node)) {
		if (isScrollable(node, frame)) {
			const outer = node.getBoundingClientRect();
			const inner = element.getBoundingClientRect();
			let top = node.scrollTop;
			let left = node.scrollLeft;
			if (inner.top < outer.top) top += inner.top - outer.top;
			else if (inner.bottom > outer.bottom) top += Math.min(inner.bottom - outer.bottom, inner.top - outer.top);
			if (inner.left < outer.left) left += inner.left - outer.left;
			else if (inner.right > outer.right) left += Math.min(inner.right - outer.right, inner.left - outer.left);
			if (top !== node.scrollTop || left !== node.scrollLeft) {
				if (typeof node.scrollTo === 'function') node.scrollTo({ top, left, behavior: reducedMotion ? 'auto' : 'smooth' });
				else {
					node.scrollTop = top;
					node.scrollLeft = left;
				}
			}
		}
		if (node === frame) break;
		node = node.parentElement;
	}
};

const isEditable = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

const CONTROL_STYLE = {
	size: 'sm' as const,
	minWidth: '32px',
	height: '32px',
	background: MK.card,
	color: MK.ink,
	border: `1px solid ${MK.hairline}`,
	borderRadius: MK.radiusSm,
	_hover: { borderColor: MK.ink, background: MK.cardSolid },
	_active: { transform: 'translateY(1px)' },
	_focusVisible: { outline: `3px solid ${MK.accent}`, outlineOffset: '2px', boxShadow: 'none' }
};

export const WalkthroughPlayer = ({ walkthrough, autoplay = true, compact = false }: { walkthrough: Walkthrough; autoplay?: boolean; compact?: boolean }) => {
	const reducedMotion = useReducedMotion();
	const reducedRef = React.useRef(reducedMotion);
	const walkthroughRef = React.useRef(walkthrough);
	const rootRef = React.useRef<HTMLDivElement>(null);
	const frameRef = React.useRef<HTMLDivElement>(null);
	const barRef = React.useRef<HTMLDivElement>(null);
	const stateRef = React.useRef<PlayerState>(initialState());
	const startedRef = React.useRef(false);
	const mountedRef = React.useRef(false);
	const rafRef = React.useRef<number | null>(null);
	const lastTickRef = React.useRef<number | null>(null);
	const wantsPlayRef = React.useRef(autoplay);

	const [view, setView] = React.useState<PlayerState>(() => initialState());
	const [cursor, setCursor] = React.useState<CursorPlacement | null>(null);
	const [wantsPlay, setWantsPlay] = React.useState(autoplay);
	const [inView, setInView] = React.useState(false);
	const [tabVisible, setTabVisible] = React.useState(true);

	const count = walkthrough.steps.length;
	const running = wantsPlay && inView && tabVisible && count > 0;

	React.useEffect(() => {
		reducedRef.current = reducedMotion;
	}, [reducedMotion]);
	React.useEffect(() => {
		walkthroughRef.current = walkthrough;
	}, [walkthrough]);
	React.useEffect(() => {
		wantsPlayRef.current = wantsPlay;
	}, [wantsPlay]);
	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const commitView = React.useCallback((next: PlayerState) => {
		if (!mountedRef.current) return;
		setView((prev) =>
			prev.stepIndex === next.stepIndex && prev.phase === next.phase && prev.typedChars === next.typedChars && prev.loops === next.loops ? prev : next
		);
		const bar = barRef.current;
		if (bar) bar.style.width = `${(progressFor(next, walkthroughRef.current, reducedRef.current) * 100).toFixed(2)}%`;
	}, []);

	// Move the cursor to the current step's target (or a resting spot before
	// the tour starts). Missing targets leave the cursor where it is.
	const placeCursor = React.useCallback((animate: boolean) => {
		const frame = frameRef.current;
		if (!frame || !mountedRef.current) return;
		if (!startedRef.current) {
			const rest: CursorPlacement = { x: frame.clientWidth * 0.64, y: frame.clientHeight * 0.7, animate: false };
			setCursor((prev) => (prev && !prev.animate && samePoint(prev, rest) ? prev : rest));
			return;
		}
		const step = walkthroughRef.current.steps[stateRef.current.stepIndex];
		const element = step ? findTarget(frame, step.target) : null;
		if (!element) return;
		const point = centreOf(frame, element);
		setCursor((prev) => (prev && prev.animate === animate && samePoint(prev, point) ? prev : { ...point, animate }));
	}, []);

	const scrollForStep = React.useCallback((stepIndex: number) => {
		const frame = frameRef.current;
		const step = walkthroughRef.current.steps[stepIndex];
		if (!frame || !step || step.action !== 'scroll') return;
		const element = findTarget(frame, step.target);
		if (element) scrollWithinFrame(frame, element, reducedRef.current);
	}, []);

	const enterStep = React.useCallback(
		(stepIndex: number) => {
			scrollForStep(stepIndex);
			placeCursor(true);
		},
		[placeCursor, scrollForStep]
	);

	// Reset when a different walkthrough arrives.
	React.useEffect(() => {
		stateRef.current = initialState();
		startedRef.current = false;
		lastTickRef.current = null;
		commitView(stateRef.current);
		placeCursor(false);
	}, [walkthrough.key, commitView, placeCursor]);

	// Pause while the tab is hidden.
	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		const update = () => setTabVisible(document.visibilityState !== 'hidden');
		update();
		document.addEventListener('visibilitychange', update);
		return () => document.removeEventListener('visibilitychange', update);
	}, []);

	// Pause while scrolled out of view (and autoplay only once on screen).
	React.useEffect(() => {
		const root = rootRef.current;
		if (!root || typeof window === 'undefined') return;
		if (typeof IntersectionObserver !== 'function') {
			setInView(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[entries.length - 1];
				if (entry) setInView(entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO);
			},
			{ threshold: [VISIBLE_RATIO] }
		);
		observer.observe(root);
		return () => observer.disconnect();
	}, []);

	// Keep the cursor on its target through layout changes and inner scrolls.
	React.useEffect(() => {
		const frame = frameRef.current;
		if (!frame || typeof window === 'undefined') return;
		const onLayout = () => placeCursor(false);
		const onScroll = () => placeCursor(true);
		window.addEventListener('resize', onLayout);
		frame.addEventListener('scroll', onScroll, { capture: true, passive: true });
		let observer: ResizeObserver | null = null;
		if (typeof ResizeObserver === 'function') {
			observer = new ResizeObserver(onLayout);
			observer.observe(frame);
		} else onLayout();
		return () => {
			window.removeEventListener('resize', onLayout);
			frame.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
			if (observer) observer.disconnect();
		};
	}, [placeCursor]);

	// The clock: one rAF loop while running, fed real deltas.
	React.useEffect(() => {
		if (!running || typeof window === 'undefined') return;
		let cancelled = false;
		lastTickRef.current = null;
		const tick = (now: number) => {
			if (cancelled || !mountedRef.current) return;
			const last = lastTickRef.current;
			lastTickRef.current = now;
			if (!startedRef.current) {
				startedRef.current = true;
				enterStep(stateRef.current.stepIndex);
			}
			if (last !== null) {
				const delta = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, now - last));
				const prev = stateRef.current;
				const next = advance(prev, walkthroughRef.current, delta, reducedRef.current);
				if (next !== prev) {
					stateRef.current = next;
					if (next.stepIndex !== prev.stepIndex || next.loops !== prev.loops) enterStep(next.stepIndex);
					commitView(next);
				}
			}
			rafRef.current = window.requestAnimationFrame(tick);
		};
		rafRef.current = window.requestAnimationFrame(tick);
		return () => {
			cancelled = true;
			if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		};
	}, [running, enterStep, commitView]);

	const seek = React.useCallback(
		(index: number, options: { play?: boolean } = {}) => {
			const current = walkthroughRef.current;
			const total = current.steps.length;
			if (total === 0) return;
			const wrapped = ((Math.round(index) % total) + total) % total;
			const loops = stateRef.current.loops;
			const playing = options.play ?? wantsPlayRef.current;
			startedRef.current = true;
			stateRef.current = playing ? seekTo(wrapped, current, loops) : seekToHold(wrapped, current, loops);
			lastTickRef.current = null;
			commitView(stateRef.current);
			enterStep(wrapped);
		},
		[commitView, enterStep]
	);

	const toggle = React.useCallback(() => setWantsPlay((playing) => !playing), []);
	const previous = React.useCallback(() => seek(stateRef.current.stepIndex - 1), [seek]);
	const next = React.useCallback(() => seek(stateRef.current.phase === 'done' ? 0 : stateRef.current.stepIndex + 1), [seek]);
	const replay = React.useCallback(() => {
		seek(0, { play: true });
		setWantsPlay(true);
	}, [seek]);

	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (isEditable(event.target)) return;
		if (event.key === ' ' || event.key === 'Spacebar') {
			if (event.target !== event.currentTarget) return;
			event.preventDefault();
			toggle();
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			previous();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			next();
		}
	};

	const step = walkthrough.steps[Math.min(view.stepIndex, Math.max(0, count - 1))] ?? null;
	const activeTarget = React.useMemo(() => activeTargetFor(view, walkthrough), [view, walkthrough]);
	const typed = React.useMemo(() => typedTextFor(view, walkthrough), [view, walkthrough]);
	const clicking = view.phase === 'act' && step?.action === 'click';
	const stepNumber = count === 0 ? 0 : Math.min(view.stepIndex, count - 1) + 1;
	const label = step?.label ?? 'No steps yet';
	const caption = count === 0 ? label : compact ? `${stepNumber}/${count} · ${label}` : `Step ${stepNumber} of ${count} — ${label}`;
	const cursorTransform = cursor ? `translate(${(cursor.x - CURSOR_HOTSPOT.x).toFixed(1)}px, ${(cursor.y - CURSOR_HOTSPOT.y).toFixed(1)}px)` : undefined;

	return (
		<Box
			ref={rootRef}
			data-testid="walkthrough-player"
			data-walkthrough={walkthrough.key}
			data-step={view.stepIndex}
			data-phase={view.phase}
			data-loops={view.loops}
			data-playing={running ? 'true' : 'false'}
			role="region"
			aria-label={`${walkthrough.title}: animated walkthrough`}
			aria-roledescription="animated walkthrough"
			tabIndex={0}
			onKeyDown={onKeyDown}
			fontFamily={MK.font}
			color={MK.ink}
			width="100%"
			maxWidth="100%"
			borderRadius={MK.radius}
			_focusVisible={{ outline: `3px solid ${MK.accent}`, outlineOffset: '4px' }}
			sx={{ '& *': { boxSizing: 'border-box' } }}
		>
			<Box
				ref={frameRef}
				data-wt-frame=""
				position="relative"
				overflow="hidden"
				border={MK.border}
				borderRadius={MK.radius}
				boxShadow={MK.shadow}
				background={MK.bg2}
				width="100%"
			>
				<MockScreen screen={walkthrough.screen} active={activeTarget} typed={typed} />
				<Box aria-hidden="true" position="absolute" inset={0} overflow="hidden" pointerEvents="none" zIndex={3}>
					{cursor && clicking ? (
						<Box
							key={`${view.loops}-${view.stepIndex}`}
							data-testid="walkthrough-ripple"
							position="absolute"
							left={`${cursor.x}px`}
							top={`${cursor.y}px`}
							width="28px"
							height="28px"
							borderRadius="50%"
							border={`2px solid ${MK.accent}`}
							boxShadow={`0 0 0 1px ${MK.bg2}`}
							transform="translate(-50%, -50%)"
							opacity={reducedMotion ? 0.7 : undefined}
							animation={reducedMotion ? undefined : `${ripple} ${CLICK_MS}ms ease-out forwards`}
						/>
					) : null}
					{cursor ? (
						<Box
							position="absolute"
							left={0}
							top={0}
							style={{
								willChange: 'transform',
								transform: cursorTransform,
								transition: cursor.animate && !reducedMotion ? `transform ${MOVE_MS}ms ${MOVE_EASE}` : 'none'
							}}
						>
							<Box
								style={{
									transform: clicking ? 'scale(0.85)' : 'scale(1)',
									transformOrigin: `${CURSOR_HOTSPOT.x}px ${CURSOR_HOTSPOT.y}px`,
									transition: reducedMotion ? 'none' : 'transform 120ms ease-out'
								}}
							>
								<WalkthroughCursor />
							</Box>
						</Box>
					) : null}
				</Box>
			</Box>

			<Box
				marginTop={2}
				height="4px"
				background={MK.hairline}
				borderRadius="2px"
				overflow="hidden"
				role="progressbar"
				aria-label="Walkthrough progress"
				aria-valuemin={0}
				aria-valuemax={count}
				aria-valuenow={view.phase === 'done' ? count : Math.max(0, stepNumber - 1)}
				aria-valuetext={count === 0 ? 'No steps' : `Step ${stepNumber} of ${count}`}
			>
				<Box
					ref={barRef}
					height="100%"
					width="0%"
					background={MK.accent}
					borderRadius="2px"
					style={{ transition: reducedMotion ? 'none' : 'width 120ms linear' }}
				/>
			</Box>

			<Flex marginTop={2} alignItems="center" gap={2} flexWrap="wrap">
				<Text
					flex="1 1 160px"
					minWidth={0}
					fontSize={compact ? '12px' : '13px'}
					fontWeight={700}
					lineHeight={1.4}
					color={MK.ink}
					fontFamily={MK.font}
					aria-live={running ? 'off' : 'polite'}
					aria-atomic="true"
					data-testid="walkthrough-caption"
				>
					{caption}
				</Text>
				<Flex flex="none" gap={1} alignItems="center" role="group" aria-label="Walkthrough controls">
					<IconButton
						{...CONTROL_STYLE}
						aria-label="Previous step"
						title="Previous step (←)"
						onClick={previous}
						isDisabled={count === 0}
						icon={<SkipBack size={14} aria-hidden="true" />}
					/>
					<IconButton
						{...CONTROL_STYLE}
						aria-label={wantsPlay ? 'Pause walkthrough' : 'Play walkthrough'}
						aria-pressed={wantsPlay}
						title={wantsPlay ? 'Pause (space)' : 'Play (space)'}
						onClick={toggle}
						isDisabled={count === 0}
						background={wantsPlay ? MK.accent : MK.card}
						color={wantsPlay ? MK.accentContrast : MK.ink}
						borderColor={wantsPlay ? MK.accent : MK.hairline}
						icon={wantsPlay ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
					/>
					<IconButton
						{...CONTROL_STYLE}
						aria-label="Next step"
						title="Next step (→)"
						onClick={next}
						isDisabled={count === 0}
						icon={<SkipForward size={14} aria-hidden="true" />}
					/>
					<IconButton
						{...CONTROL_STYLE}
						aria-label="Replay walkthrough"
						title="Replay from the start"
						onClick={replay}
						isDisabled={count === 0}
						icon={<RotateCcw size={14} aria-hidden="true" />}
					/>
				</Flex>
			</Flex>

			{!compact && count > 0 ? (
				<Flex as="ol" listStyleType="none" margin={0} marginTop={2} padding={0} gap={1.5} flexWrap="wrap" aria-label="Steps" data-testid="walkthrough-dots">
					{walkthrough.steps.map((item, index) => {
						const isCurrent = index === Math.min(view.stepIndex, count - 1);
						return (
							<Box as="li" key={`${index}-${item.target}`} display="flex">
								<Box
									as="button"
									type="button"
									aria-label={`Go to step ${index + 1}`}
									aria-current={isCurrent ? 'step' : undefined}
									title={item.label}
									onClick={() => seek(index)}
									width="22px"
									height="22px"
									padding={0}
									display="inline-flex"
									alignItems="center"
									justifyContent="center"
									background="transparent"
									border="none"
									cursor="pointer"
									_focusVisible={{ outline: `3px solid ${MK.accent}`, outlineOffset: '1px', borderRadius: '50%' }}
								>
									<Box
										as="span"
										display="block"
										width={isCurrent ? '12px' : '8px'}
										height={isCurrent ? '12px' : '8px'}
										borderRadius="50%"
										background={isCurrent ? MK.accent : MK.hairline}
										border={`1px solid ${isCurrent ? MK.accent : MK.muted}`}
										style={{ transition: reducedMotion ? 'none' : 'width 140ms ease, height 140ms ease, background-color 140ms ease' }}
									/>
								</Box>
							</Box>
						);
					})}
				</Flex>
			) : null}
		</Box>
	);
};
