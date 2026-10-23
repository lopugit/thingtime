import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import {
	AddChildButton,
	ConceptCrumbs,
	DeleteButton,
	KindFlip,
	LeafValueEditor,
	useConceptLayout,
	useContainerWidth
} from './conceptBits';
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

// Concept 02 — Focus. One thing at a time: the screen belongs to the focused
// thing, its children are big friendly cards, and breadcrumbs take you back
// up. Leaves edit in place on their card. This is the most layperson-shaped
// walk through nested data — it never shows more depth than one level, so a
// phone and a desktop only differ by how many cards fit per row.

export const FocusCardsViewer = (props: ConceptViewerProps) => {
	const { thing, onThingChange, edit } = props;
	const mutations = useThingMutations(thing, onThingChange);
	const [containerRef, width] = useContainerWidth<HTMLDivElement>();
	const layout = useConceptLayout(props.variant, width);

	const [focusPath, setFocusPath] = React.useState<ThingPath>([]);

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

	const focused = getAtPath(thing, path);
	const keys = childKeysOf(focused);

	const cardBase = {
		background: 'var(--tt-card, #ffffff)',
		border: '1px solid var(--tt-border, #ececef)',
		borderRadius: 'var(--tt-radius-md, 12px)',
		boxShadow: 'var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))',
		padding: 3.5,
		textAlign: 'left' as const,
		transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease',
		width: '100%'
	};

	return (
		<Box ref={containerRef} width="100%">
			<Flex alignItems="center" columnGap={2} flexWrap="wrap" marginBottom={3} rowGap={2}>
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
						←
					</Box>
				) : null}
				<ConceptCrumbs path={path} onNavigate={setFocusPath} />
			</Flex>

			<KindFlip thing={focused}>
				<Grid
					gap={3}
					templateColumns={layout === 'mobile' ? '1fr' : 'repeat(auto-fill, minmax(210px, 1fr))'}
				>
					{keys.map((key) => {
						const childPath = [...path, key];
						const child = getAtPath(thing, childPath);
						const branch = isBranch(child);

						if (branch) {
							return (
								<Flex
									key={String(key)}
									as="button"
									type="button"
									{...cardBase}
									alignItems="center"
									columnGap={3}
									cursor="pointer"
									onClick={() => setFocusPath(childPath)}
									_hover={{ transform: 'translateY(-1px)', boxShadow: 'var(--tt-shadow-popover, 0 8px 24px rgba(20,20,40,0.12))' }}
								>
									<Text fontSize="24px" aria-hidden>
										{keyEmoji(key, child)}
									</Text>
									<Box flex="1" minWidth={0}>
										<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={750} noOfLines={1}>
											{humanizeKey(key)}
										</Text>
										<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" noOfLines={1}>
											{summarizeThing(child, 40)} · {childCountLabel(child)}
										</Text>
									</Box>
									{edit ? <DeleteButton onClick={() => mutations.deleteValue(childPath)} /> : null}
									<Text color="var(--tt-faint, #b6b6c0)" fontSize="sm">
										›
									</Text>
								</Flex>
							);
						}

						return (
							<Box key={String(key)} {...cardBase}>
								<Flex alignItems="center" columnGap={2} marginBottom={1.5}>
									<Text fontSize="15px" aria-hidden>
										{keyEmoji(key, child)}
									</Text>
									<Text
										color="var(--tt-muted, #9a9aa6)"
										fontSize="11px"
										fontWeight={700}
										letterSpacing="0.08em"
										textTransform="uppercase"
										noOfLines={1}
										flex="1"
									>
										{humanizeKey(key)}
									</Text>
									{edit ? <DeleteButton onClick={() => mutations.deleteValue(childPath)} /> : null}
								</Flex>
								<LeafValueEditor value={child} edit={edit} onValueChange={(next) => mutations.setValue(childPath, next)} />
							</Box>
						);
					})}

					{!keys.length ? (
						<Box {...cardBase}>
							<Text color="var(--tt-faint, #b6b6c0)" fontSize="sm">
								Nothing here yet — imagine something ✨
							</Text>
						</Box>
					) : null}
				</Grid>

				{edit && isBranch(focused) ? (
					<Box marginTop={3}>
						<AddChildButton onClick={() => mutations.addChild(path)} />
					</Box>
				) : null}
			</KindFlip>
		</Box>
	);
};
