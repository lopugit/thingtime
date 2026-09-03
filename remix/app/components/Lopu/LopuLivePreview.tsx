import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { parsePartialJson } from '~/utils/partialJson';
import { WebpageBlocksRenderer, type ComponentsByRef } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { defaultsFromArgs, resolveTemplate, sanitizeArgSpecs } from '../ComponentsLibrary/componentTemplate';
import { ChakraThingRenderer, isChakraThingNode, type ChakraThingNode } from '../Kinds/ChakraThingRenderer';
import { HtmlThingRenderer, type HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { isPageBlockLike } from './lopuBuildBridge';
import { LOPU_UI, lopuEyebrowSx, lopuReducedMotionSx } from './lopuTheme';
import { LIVE_PREVIEW_TOOLS, type LopuToolActivity } from './lopuTurnCore';

// The streaming preview inside Lopu's bubble (design note §2.5 "Live
// streaming preview"): while create_component / update_component /
// create_page / patch_page inputs stream in, the accumulated partial JSON is
// parsed tolerantly and, as soon as it yields a plausible `render`
// (component) or `blocks` / `ops` (page), drawn through the SAME sanitising
// allowlist renderers the builder uses — inside a hairline frame, clipped,
// inert (no click wrapper, pointer events off), re-parsed at most once per
// animation frame, with a "streaming" pill while the input is still
// arriving. Once the tool completes, the saved thing (or the complete input)
// replaces the partial, so the frame keeps a faithful thumbnail of what was
// built.

const PREVIEW_MAX_HEIGHT = 320;
const PREVIEW_MAX_HEIGHT_COMPACT = 220;

// Coalesce a fast-changing value to one state update per animation frame.
const useFrameThrottled = <T,>(value: T): T => {
	const [shown, setShown] = React.useState(value);
	const latest = React.useRef(value);
	const scheduled = React.useRef(false);
	React.useEffect(() => {
		latest.current = value;
		if (scheduled.current) return;
		scheduled.current = true;
		const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn: () => void) => setTimeout(fn, 16);
		schedule(() => {
			scheduled.current = false;
			setShown(latest.current);
		});
	}, [value]);
	return shown;
};

// A renderer fed a half-written tree may throw; the preview must never take
// the chat down with it. Resets whenever the key changes (next frame).
class PreviewBoundary extends React.Component<{ children: React.ReactNode; resetKey: unknown }, { failed: boolean; key: unknown }> {
	state = { failed: false, key: this.props.resetKey };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	static getDerivedStateFromProps(props: { resetKey: unknown }, state: { failed: boolean; key: unknown }) {
		return props.resetKey !== state.key ? { failed: false, key: props.resetKey } : null;
	}

	componentDidCatch() {
		// swallowed on purpose — a partial tree is expected to be malformed at times
	}

	render() {
		return this.state.failed ? null : this.props.children;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const componentScope = (crystal: Record<string, unknown>): Record<string, unknown> => {
	const specs = sanitizeArgSpecs(crystal.args);
	return { ...defaultsFromArgs(specs), ...(isRecord(crystal.savedArgs) ? crystal.savedArgs : {}) };
};

const ComponentPreview = ({ crystal }: { crystal: Record<string, unknown> }) => {
	const render = crystal.render;
	const resolved = React.useMemo(() => {
		if (render === undefined || render === null || typeof render === 'string') return null;
		try {
			return resolveTemplate(render, componentScope(crystal));
		} catch {
			return null;
		}
	}, [render, crystal]);
	if (!resolved || typeof resolved !== 'object') return null;
	return isChakraThingNode(resolved) ? <ChakraThingRenderer node={resolved as ChakraThingNode} /> : <HtmlThingRenderer node={resolved as HtmlThingNode} />;
};

const plausibleBlocks = (value: unknown): WebpageBlock[] => (Array.isArray(value) ? value.filter((block): block is WebpageBlock => isPageBlockLike(block)) : []);

// blocks a patch would add — the parts of the page Lopu is writing right now
const blocksFromOps = (ops: unknown): WebpageBlock[] => {
	if (!Array.isArray(ops)) return [];
	const out: WebpageBlock[] = [];
	for (const op of ops) {
		if (!isRecord(op)) continue;
		if ((op.op === 'insert' || op.op === 'replace') && isPageBlockLike(op.block)) out.push(op.block);
		else if (op.op === 'setBlocks') out.push(...plausibleBlocks(op.blocks));
	}
	return out;
};

// "● streaming" — a hairline pill with a dot on the rainbow.
const StreamingPill = () => (
	<Flex as="span" className="lopuStreamingPill" align="center" gap="6px" height="20px" px={2} borderRadius={LOPU_UI.pill} border={LOPU_UI.border} bg={LOPU_UI.surfaceAlt} flexShrink={0}>
		<Box
			as="span"
			width="6px"
			height="6px"
			borderRadius="999px"
			background={LOPU_UI.rainbow}
			backgroundSize="calc(100px + 200%)"
			sx={{ animation: `tt-blink 1s steps(1) infinite, ${LOPU_UI.rainbowAnim}`, ...lopuReducedMotionSx }}
			aria-hidden="true"
		/>
		<Text as="span" sx={lopuEyebrowSx}>
			streaming
		</Text>
	</Flex>
);

export type LopuLivePreviewProps = {
	activity: LopuToolActivity;
	// components created earlier in the same turn, so page previews can draw
	// their component blocks before the page resolves
	componentsByRef?: ComponentsByRef;
	compact?: boolean;
};

export const LopuLivePreview = ({ activity, componentsByRef, compact = false }: LopuLivePreviewProps) => {
	const streaming = activity.status === 'streaming';
	const partial = useFrameThrottled(streaming ? activity.partialInput : '');
	const parsedInput = React.useMemo<Record<string, unknown> | null>(() => {
		if (isRecord(activity.input)) return activity.input;
		if (!partial) return null;
		try {
			const parsed = parsePartialJson(partial);
			return isRecord(parsed.value) ? parsed.value : null;
		} catch {
			return null;
		}
	}, [activity.input, partial]);

	if (!LIVE_PREVIEW_TOOLS.has(activity.name)) return null;

	const isComponent = activity.name === 'create_component' || activity.name === 'update_component';
	const savedCrystal = isRecord(activity.thing?.thing?.crystal) ? (activity.thing!.thing.crystal as Record<string, unknown>) : null;

	let body: React.ReactNode = null;
	let caption = '';
	if (isComponent) {
		// the saved thing wins once it lands; before that, the (partial) input
		const crystal = savedCrystal ?? parsedInput;
		if (crystal && crystal.render !== undefined && crystal.render !== null) {
			body = <ComponentPreview crystal={crystal} />;
			caption = typeof crystal.name === 'string' && crystal.name ? crystal.name : 'component';
		}
	} else if (activity.name === 'create_page') {
		const blocks = plausibleBlocks(savedCrystal?.blocks ?? parsedInput?.blocks);
		if (blocks.length) {
			body = <WebpageBlocksRenderer blocks={blocks} componentsByRef={componentsByRef || {}} interactive={false} bare />;
			const name = savedCrystal?.name ?? parsedInput?.name;
			caption = `${typeof name === 'string' && name ? name : 'page'} · ${blocks.length} block${blocks.length === 1 ? '' : 's'}`;
		}
	} else if (activity.name === 'patch_page') {
		const blocks = blocksFromOps(parsedInput?.ops);
		if (blocks.length) {
			body = <WebpageBlocksRenderer blocks={blocks} componentsByRef={componentsByRef || {}} interactive={false} bare />;
			caption = `${blocks.length} new block${blocks.length === 1 ? '' : 's'}`;
		}
	}

	if (!body) return null;

	return (
		<Box className="lopuLivePreview" data-tool={activity.name} data-streaming={streaming ? 'true' : 'false'} border={LOPU_UI.border} borderRadius={LOPU_UI.radiusMd} bg={LOPU_UI.card} overflow="hidden" minW={0}>
			<Flex align="center" gap={2} px={2.5} py={1} minH="30px" borderBottom={LOPU_UI.border}>
				<Text as="span" sx={lopuEyebrowSx}>
					{streaming ? 'Live preview' : 'Preview'}
				</Text>
				<Text as="span" fontSize="11px" color={LOPU_UI.muted} isTruncated minW={0}>
					{caption}
				</Text>
				<Box flex={1} />
				{streaming ? <StreamingPill /> : null}
			</Flex>
			<Box
				position="relative"
				overflow="hidden"
				maxH={`${compact ? PREVIEW_MAX_HEIGHT_COMPACT : PREVIEW_MAX_HEIGHT}px`}
				// inert: a preview is never a control surface
				pointerEvents="none"
				userSelect="none"
				aria-hidden="true"
			>
				<Box p={compact ? 2.5 : 3} minW={0} whiteSpace="normal">
					<PreviewBoundary resetKey={partial.length + (activity.input ? 1 : 0) + (savedCrystal ? 2 : 0)}>{body}</PreviewBoundary>
				</Box>
				<Box position="absolute" left={0} right={0} bottom={0} height="28px" background={`linear-gradient(to bottom, transparent, ${LOPU_UI.card})`} />
			</Box>
		</Box>
	);
};
