import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { ConceptCrumbs, DeleteButton, KindFlip, LeafValueEditor, useContainerWidth } from './conceptBits';
import type { ConceptViewerProps } from './conceptBits';
import {
	childCountLabel,
	childKeysOf,
	getAtPath,
	humanizeKey,
	isBranch,
	keyEmoji,
	summarizeThing,
	useThingMutations
} from './conceptData';
import type { ThingPath } from './conceptData';

// Concept 05 — Galaxy. Your thing is a little solar system: the focused thing
// sits in the centre and its children orbit it. Tapping a moon that has its
// own children makes it the new sun; tapping a leaf opens it in a bottom
// sheet for reading/editing. Structure becomes *place*, which is the mental
// model laypeople already have — things inside things, not brackets inside
// brackets. Scales to mobile by shrinking the orbit, not the idea.

const MAX_ORBITERS = 9;

export const OrbitCanvasViewer = (props: ConceptViewerProps) => {
	const { thing, onThingChange, edit } = props;
	const mutations = useThingMutations(thing, onThingChange);
	const [containerRef, width] = useContainerWidth<HTMLDivElement>();

	const [focusPath, setFocusPath] = React.useState<ThingPath>([]);
	const [openLeaf, setOpenLeaf] = React.useState<ThingPath | null>(null);
	const [showAll, setShowAll] = React.useState(false);

	// trim stale focus after deletes
	const path = React.useMemo(() => {
		const valid: ThingPath = [];
		let current: unknown = thing;
		for (const segment of focusPath) {
			if (!isBranch(current) || !(childKeysOf(current) as Array<string | number>).some((key) => String(key) === String(segment))) break;
			valid.push(segment);
			current = (current as Record<string, unknown>)[segment as string];
		}
		return valid;
	}, [thing, focusPath]);

	React.useEffect(() => {
		setShowAll(false);
	}, [path.join('¶')]);

	const focused = getAtPath(thing, path);
	const keys = childKeysOf(focused);
	const visibleKeys = keys.slice(0, MAX_ORBITERS);
	const hiddenCount = keys.length - visibleKeys.length;

	const size = Math.max(Math.min(width || 480, 520), 260);
	const compact = size < 380;
	const centre = size / 2;
	const orbitRadius = size * 0.36;
	const moonSize = compact ? 64 : 84;
	const sunSize = compact ? 92 : 120;

	const focusedKey = path.length ? path[path.length - 1] : undefined;
	const openLeafValue = openLeaf ? getAtPath(thing, openLeaf) : undefined;

	const bubbleBase = {
		alignItems: 'center',
		background: 'var(--tt-card, #ffffff)',
		border: '1px solid var(--tt-border, #ececef)',
		borderRadius: '999px',
		boxShadow: 'var(--tt-shadow-card, 0 2px 8px rgba(20,20,40,0.08))',
		cursor: 'pointer',
		flexDirection: 'column' as const,
		justifyContent: 'center',
		overflow: 'hidden',
		position: 'absolute' as const,
		textAlign: 'center' as const,
		transition: 'left 320ms ease, top 320ms ease, width 320ms ease, height 320ms ease, box-shadow 160ms ease',
		zIndex: 1
	};

	return (
		<Box ref={containerRef} width="100%">
			<Flex alignItems="center" columnGap={2} flexWrap="wrap" marginBottom={2} rowGap={2}>
				{path.length ? (
					<Box
						as="button"
						type="button"
						background="var(--tt-surface-alt, #f5f5f7)"
						borderRadius="999px"
						color="var(--tt-ink, #16161a)"
						cursor="pointer"
						fontSize="13px"
						fontWeight={800}
						paddingX="10px"
						paddingY="4px"
						onClick={() => setFocusPath(path.slice(0, -1))}
					>
						↑ Up
					</Box>
				) : null}
				<ConceptCrumbs path={path} rootLabel="🌞 Everything" onNavigate={setFocusPath} />
			</Flex>

			<Box
				position="relative"
				width="100%"
				height={`${size}px`}
				background="radial-gradient(circle at 50% 42%, var(--tt-accent-tint, #fff5fa) 0%, var(--tt-surface, #fafafb) 62%)"
				border="1px solid var(--tt-border, #ececef)"
				borderRadius="var(--tt-radius-lg, 16px)"
				overflow="hidden"
			>
				{/* orbit ring */}
				<Box
					position="absolute"
					left={`${centre - orbitRadius}px`}
					top={`${centre - orbitRadius}px`}
					width={`${orbitRadius * 2}px`}
					height={`${orbitRadius * 2}px`}
					border="1.5px dashed var(--tt-border, #ececef)"
					borderRadius="999px"
					pointerEvents="none"
				/>

				{/* the sun: the focused thing */}
				<Flex
					{...bubbleBase}
					cursor="default"
					left={`${centre - sunSize / 2}px`}
					top={`${centre - sunSize / 2}px`}
					width={`${sunSize}px`}
					height={`${sunSize}px`}
					background="var(--tt-ink, #16161a)"
					border="none"
					zIndex={2}
				>
					<Text fontSize={compact ? '22px' : '28px'} aria-hidden>
						{focusedKey !== undefined ? keyEmoji(focusedKey, focused) : '🌞'}
					</Text>
					<Text color="var(--tt-card, #ffffff)" fontSize={compact ? '10px' : '11px'} fontWeight={800} maxWidth="86%" noOfLines={1}>
						{focusedKey !== undefined ? humanizeKey(focusedKey) : 'Everything'}
					</Text>
					<Text color="rgba(255,255,255,0.6)" fontSize="9px" fontWeight={600}>
						{isBranch(focused) ? childCountLabel(focused) : summarizeThing(focused, 12)}
					</Text>
				</Flex>

				{/* the moons: children in orbit */}
				{visibleKeys.map((key, idx) => {
					const total = visibleKeys.length + (hiddenCount > 0 ? 1 : 0);
					const angle = (idx / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
					const x = centre + Math.cos(angle) * orbitRadius;
					const y = centre + Math.sin(angle) * orbitRadius;
					const childPath = [...path, key];
					const child = getAtPath(thing, childPath);
					const branch = isBranch(child);

					return (
						<Flex
							key={String(key)}
							as="button"
							type="button"
							{...bubbleBase}
							left={`${x - moonSize / 2}px`}
							top={`${y - moonSize / 2}px`}
							width={`${moonSize}px`}
							height={`${moonSize}px`}
							onClick={() => (branch ? setFocusPath(childPath) : setOpenLeaf(childPath))}
							_hover={{ boxShadow: 'var(--tt-shadow-popover, 0 10px 28px rgba(20,20,40,0.18))', zIndex: 3 }}
						>
							<Text fontSize={compact ? '17px' : '21px'} aria-hidden>
								{keyEmoji(key, child)}
							</Text>
							<Text color="var(--tt-ink, #16161a)" fontSize={compact ? '9px' : '10.5px'} fontWeight={750} maxWidth="88%" noOfLines={1}>
								{humanizeKey(key)}
							</Text>
							<Text color="var(--tt-muted, #9a9aa6)" fontSize="8.5px" maxWidth="88%" noOfLines={1}>
								{branch ? childCountLabel(child) : summarizeThing(child, 12)}
							</Text>
						</Flex>
					);
				})}

				{/* overflow moon */}
				{hiddenCount > 0 ? (
					<Flex
						as="button"
						type="button"
						{...bubbleBase}
						left={`${centre + Math.cos(-Math.PI / 2 + ((visibleKeys.length / (visibleKeys.length + 1)) * Math.PI * 2)) * orbitRadius - moonSize / 2}px`}
						top={`${centre + Math.sin(-Math.PI / 2 + ((visibleKeys.length / (visibleKeys.length + 1)) * Math.PI * 2)) * orbitRadius - moonSize / 2}px`}
						width={`${moonSize}px`}
						height={`${moonSize}px`}
						borderStyle="dashed"
						onClick={() => setShowAll(true)}
					>
						<Text color="var(--tt-muted, #9a9aa6)" fontSize="13px" fontWeight={800}>
							+{hiddenCount}
						</Text>
						<Text color="var(--tt-faint, #b6b6c0)" fontSize="9px">
							more
						</Text>
					</Flex>
				) : null}
			</Box>

			{/* full child list, for busy orbits */}
			{showAll ? (
				<Box
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-md, 12px)"
					marginTop={2}
					maxHeight="220px"
					overflowY="auto"
					padding={2}
				>
					{keys.map((key) => {
						const childPath = [...path, key];
						const child = getAtPath(thing, childPath);
						const branch = isBranch(child);

						return (
							<Flex
								key={String(key)}
								as="button"
								type="button"
								alignItems="center"
								borderRadius="var(--tt-radius-sm, 9px)"
								columnGap={2}
								cursor="pointer"
								paddingX={2}
								paddingY={1.5}
								textAlign="left"
								width="100%"
								onClick={() => {
									setShowAll(false);
									branch ? setFocusPath(childPath) : setOpenLeaf(childPath);
								}}
								_hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
							>
								<Text fontSize="15px" aria-hidden>
									{keyEmoji(key, child)}
								</Text>
								<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={650} flex="1" noOfLines={1}>
									{humanizeKey(key)}
								</Text>
								<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" noOfLines={1}>
									{branch ? childCountLabel(child) : summarizeThing(child, 24)}
								</Text>
							</Flex>
						);
					})}
				</Box>
			) : null}

			{/* leaf bottom sheet */}
			{openLeaf ? (
				<Box
					background="var(--tt-card, #ffffff)"
					border="1px solid var(--tt-border, #ececef)"
					borderRadius="var(--tt-radius-lg, 16px)"
					boxShadow="var(--tt-shadow-popover, 0 16px 40px -12px rgba(20,20,40,0.3))"
					marginTop={2}
					padding={4}
				>
					<Flex alignItems="center" columnGap={2} marginBottom={2}>
						<Text fontSize="18px" aria-hidden>
							{keyEmoji(openLeaf[openLeaf.length - 1], openLeafValue)}
						</Text>
						<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={800} flex="1">
							{humanizeKey(openLeaf[openLeaf.length - 1])}
						</Text>
						{edit ? (
							<DeleteButton
								onClick={() => {
									mutations.deleteValue(openLeaf);
									setOpenLeaf(null);
								}}
							/>
						) : null}
						<Box
							as="button"
							type="button"
							aria-label="Close"
							color="var(--tt-muted, #9a9aa6)"
							cursor="pointer"
							fontSize="14px"
							fontWeight={800}
							onClick={() => setOpenLeaf(null)}
						>
							✕
						</Box>
					</Flex>
					<LeafValueEditor value={openLeafValue} edit={edit} onValueChange={(next) => mutations.setValue(openLeaf, next)} />
				</Box>
			) : null}

			{/* rendered preview when the focused subtree carries a kind */}
			{isBranch(focused) && !Array.isArray(focused) && (focused as Record<string, unknown>).kind ? (
				<Box marginTop={3}>
					<KindFlip thing={focused}>
						<></>
					</KindFlip>
				</Box>
			) : null}
		</Box>
	);
};
