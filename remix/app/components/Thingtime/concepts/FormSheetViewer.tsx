import React from 'react';
import { Box, Flex, Grid, Text } from '@chakra-ui/react';

import { AddChildButton, DeleteButton, KindFlip, LeafValueEditor, useConceptLayout, useContainerWidth } from './conceptBits';
import type { ConceptViewerProps } from './conceptBits';
import {
	childCountLabel,
	childKeysOf,
	getAtPath,
	humanizeKey,
	isBranch,
	keyEmoji,
	useThingMutations
} from './conceptData';
import type { ThingPath } from './conceptData';

// Concept 04 — Form. Every thing is a settings page: top-level branches are
// section cards, leaves are labelled fields, and deeper branches are nested
// fieldsets with a soft left rule. This is the concept the screenshotted edit
// mode wants to grow into — same data, but laid out like a form a person has
// filled in a hundred times before. Desktop shows sections in a two-column
// masonry-ish grid; mobile stacks them.

const MAX_INLINE_DEPTH = 3;

export const FormSheetViewer = (props: ConceptViewerProps) => {
	const { thing, onThingChange, edit } = props;
	const mutations = useThingMutations(thing, onThingChange);
	const [containerRef, width] = useContainerWidth<HTMLDivElement>();
	const layout = useConceptLayout(props.variant, width, 700);

	const renderField = (path: ThingPath, key: string | number, value: unknown) => (
		<Box key={String(key)} paddingY={2} borderBottom="1px solid var(--tt-border-light, #f0f0f2)" _last={{ borderBottom: 'none' }}>
			<Flex alignItems="center" columnGap={1.5} marginBottom={1}>
				<Text fontSize="13px" aria-hidden>
					{keyEmoji(key, value)}
				</Text>
				<Text color="var(--tt-muted, #9a9aa6)" fontSize="11px" fontWeight={700} letterSpacing="0.08em" textTransform="uppercase">
					{humanizeKey(key)}
				</Text>
				{edit ? <DeleteButton onClick={() => mutations.deleteValue(path)} /> : null}
			</Flex>
			<LeafValueEditor value={value} edit={edit} fontSize="15px" onValueChange={(next) => mutations.setValue(path, next)} />
		</Box>
	);

	const renderGroup = (path: ThingPath, value: unknown, depth: number): React.ReactNode => {
		const keys = childKeysOf(value);

		if (depth > MAX_INLINE_DEPTH) {
			return (
				<Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
					{childCountLabel(value)} deeper — open in a drill-down view
				</Text>
			);
		}

		return (
			<Flex flexDirection="column">
				{keys.map((key) => {
					const childPath = [...path, key];
					const child = getAtPath(thing, childPath);

					if (!isBranch(child)) {
						return renderField(childPath, key, child);
					}

					return (
						<Box key={String(key)} paddingY={2}>
							<Flex alignItems="center" columnGap={1.5} marginBottom={1.5}>
								<Text fontSize="14px" aria-hidden>
									{keyEmoji(key, child)}
								</Text>
								<Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight={750}>
									{humanizeKey(key)}
								</Text>
								<Text color="var(--tt-faint, #b6b6c0)" fontSize="xs">
									{childCountLabel(child)}
								</Text>
								{edit ? <DeleteButton onClick={() => mutations.deleteValue(childPath)} /> : null}
							</Flex>
							<Box borderLeft="2px solid var(--tt-border-light, #f0f0f2)" paddingLeft={3.5}>
								<KindFlip thing={child} defaultRendered={false}>
									{renderGroup(childPath, child, depth + 1)}
									{edit ? (
										<Box marginTop={1.5}>
											<AddChildButton label="Add" onClick={() => mutations.addChild(childPath)} />
										</Box>
									) : null}
								</KindFlip>
							</Box>
						</Box>
					);
				})}
				{!keys.length ? (
					<Text color="var(--tt-faint, #b6b6c0)" fontSize="sm" paddingY={1}>
						Nothing here yet
					</Text>
				) : null}
			</Flex>
		);
	};

	const rootKeys = childKeysOf(thing);

	// leaves at the very top level collect into their own "General" card
	const rootLeaves = rootKeys.filter((key) => !isBranch(getAtPath(thing, [key])));
	const rootBranches = rootKeys.filter((key) => isBranch(getAtPath(thing, [key])));

	return (
		<Box ref={containerRef} width="100%">
			<Grid gap={4} templateColumns={layout === 'mobile' ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))'}>
				{rootLeaves.length ? (
					<Box
						background="var(--tt-card, #ffffff)"
						border="1px solid var(--tt-border, #ececef)"
						borderRadius="var(--tt-radius-lg, 16px)"
						boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))"
						padding={4}
					>
						<Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={800} marginBottom={2}>
							✨ General
						</Text>
						{rootLeaves.map((key) => renderField([key], key, getAtPath(thing, [key])))}
					</Box>
				) : null}

				{rootBranches.map((key) => {
					const childPath = [key];
					const child = getAtPath(thing, childPath);

					return (
						<Box
							key={String(key)}
							background="var(--tt-card, #ffffff)"
							border="1px solid var(--tt-border, #ececef)"
							borderRadius="var(--tt-radius-lg, 16px)"
							boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))"
							padding={4}
						>
							<Flex alignItems="center" columnGap={2} marginBottom={2}>
								<Text fontSize="18px" aria-hidden>
									{keyEmoji(key, child)}
								</Text>
								<Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={800}>
									{humanizeKey(key)}
								</Text>
								{edit ? <DeleteButton onClick={() => mutations.deleteValue(childPath)} /> : null}
							</Flex>
							<KindFlip thing={child} defaultRendered={false}>
								{renderGroup(childPath, child, 1)}
								{edit ? (
									<Box marginTop={2}>
										<AddChildButton label="Add" onClick={() => mutations.addChild(childPath)} />
									</Box>
								) : null}
							</KindFlip>
						</Box>
					);
				})}
			</Grid>

			{edit && isBranch(thing) ? (
				<Box marginTop={4}>
					<AddChildButton label="Grow a new section" onClick={() => mutations.addChild([], {})} />
				</Box>
			) : null}
		</Box>
	);
};
