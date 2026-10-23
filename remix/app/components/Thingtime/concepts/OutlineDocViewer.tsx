import React from 'react';
import { Box, Flex, Text } from '@chakra-ui/react';

import { AddChildButton, DeleteButton, KindFlip, LeafValueEditor, useConceptLayout, useContainerWidth } from './conceptBits';
import type { ConceptViewerProps } from './conceptBits';
import {
	childKeysOf,
	getAtPath,
	humanizeKey,
	isBranch,
	keyEmoji,
	summarizeThing,
	useThingMutations
} from './conceptData';
import type { ThingPath } from './conceptData';

// Concept 03 — Document. The thing reads like a page: objects become
// headed sections, leaves become labelled lines, lists of same-shaped objects
// become tables (stacked cards on narrow containers), and lists of simple
// values become chips. Nesting is typography, not indentation — so the layout
// never marches off the right edge of the screen, on any device.

// keys shared by every object in the array → it renders as a table
const sharedTableKeys = (items: unknown[]): string[] | null => {
	if (items.length < 2) return null;
	if (!items.every((item) => isBranch(item) && !Array.isArray(item))) return null;

	const first = Object.keys(items[0] as Record<string, unknown>);
	if (!first.length || first.length > 6) return null;

	const allShare = items.every((item) => {
		const keys = Object.keys(item as Record<string, unknown>);
		return first.every((key) => keys.includes(key));
	});

	return allShare ? first : null;
};

const headingSizes = ['xl', 'lg', 'md', 'sm'];

export const OutlineDocViewer = (props: ConceptViewerProps) => {
	const { thing, onThingChange, edit } = props;
	const mutations = useThingMutations(thing, onThingChange);
	const [containerRef, width] = useContainerWidth<HTMLDivElement>();
	const layout = useConceptLayout(props.variant, width);

	const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

	const toggleCollapsed = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

	const renderLeafRow = (path: ThingPath, key: string | number, value: unknown) => (
		<Flex
			key={String(key)}
			alignItems={layout === 'mobile' ? 'flex-start' : 'baseline'}
			columnGap={3}
			flexDirection={layout === 'mobile' ? 'column' : 'row'}
			paddingY={1.5}
			rowGap={0.5}
			role="group"
		>
			<Flex alignItems="center" columnGap={1.5} flexShrink={0} width={layout === 'mobile' ? 'auto' : '180px'}>
				<Text fontSize="13px" aria-hidden>
					{keyEmoji(key, value)}
				</Text>
				<Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" fontWeight={700} letterSpacing="0.04em" noOfLines={1}>
					{humanizeKey(key)}
				</Text>
				{edit ? <DeleteButton onClick={() => mutations.deleteValue(path)} /> : null}
			</Flex>
			<Box flex="1" minWidth={0} width="100%">
				<LeafValueEditor value={value} edit={edit} fontSize="15px" onValueChange={(next) => mutations.setValue(path, next)} />
			</Box>
		</Flex>
	);

	const renderChipList = (path: ThingPath, items: unknown[]) => (
		<Flex columnGap={1.5} flexWrap="wrap" rowGap={1.5} paddingY={1}>
			{items.map((item, idx) => (
				<Flex
					key={idx}
					alignItems="center"
					background="var(--tt-surface-alt, #f5f5f7)"
					borderRadius="999px"
					columnGap={1}
					fontSize="13px"
					paddingX="10px"
					paddingY="3px"
				>
					<Text color="var(--tt-text, #5a5a66)">{String(item)}</Text>
					{edit ? <DeleteButton onClick={() => mutations.deleteValue([...path, idx])} /> : null}
				</Flex>
			))}
			{edit ? <AddChildButton label="Add" onClick={() => mutations.addChild(path)} /> : null}
		</Flex>
	);

	// table cells hold leaves; a nested branch cell renders as a muted summary
	const renderCellValue = (cellPath: ThingPath, value: unknown, fontSize: string) => {
		if (isBranch(value)) {
			return (
				<Text color="var(--tt-muted, #9a9aa6)" fontSize={fontSize} noOfLines={1}>
					{summarizeThing(value, 28)}
				</Text>
			);
		}
		return <LeafValueEditor value={value} edit={edit} fontSize={fontSize} onValueChange={(next) => mutations.setValue(cellPath, next)} />;
	};

	const renderTable = (path: ThingPath, items: unknown[], keys: string[]) => {
		if (layout === 'mobile') {
			return (
				<Flex flexDirection="column" rowGap={2} paddingY={1}>
					{items.map((item, idx) => (
						<Box
							key={idx}
							background="var(--tt-surface, #fafafb)"
							border="1px solid var(--tt-border-light, #f0f0f2)"
							borderRadius="var(--tt-radius-md, 12px)"
							padding={3}
						>
							{keys.map((key) => (
								<Flex key={key} columnGap={2} justifyContent="space-between" paddingY={0.5}>
									<Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" fontWeight={700}>
										{humanizeKey(key)}
									</Text>
									<Box minWidth={0} textAlign="right">
										{renderCellValue([...path, idx, key], (item as Record<string, unknown>)[key], '13px')}
									</Box>
								</Flex>
							))}
						</Box>
					))}
				</Flex>
			);
		}

		return (
			<Box overflowX="auto" paddingY={1}>
				<Box as="table" width="100%" style={{ borderCollapse: 'collapse' }}>
					<Box as="thead">
						<Box as="tr">
							{keys.map((key) => (
								<Box as="th" key={key} paddingX={2} paddingY={1.5} textAlign="left" borderBottom="1px solid var(--tt-border, #ececef)">
									<Text color="var(--tt-muted, #9a9aa6)" fontSize="11px" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase">
										{humanizeKey(key)}
									</Text>
								</Box>
							))}
							{edit ? <Box as="th" width="30px" borderBottom="1px solid var(--tt-border, #ececef)" /> : null}
						</Box>
					</Box>
					<Box as="tbody">
						{items.map((item, idx) => (
							<Box as="tr" key={idx} borderBottom="1px solid var(--tt-border-light, #f0f0f2)">
								{keys.map((key) => (
									<Box as="td" key={key} paddingX={2} paddingY={1.5}>
										{renderCellValue([...path, idx, key], (item as Record<string, unknown>)[key], '14px')}
									</Box>
								))}
								{edit ? (
									<Box as="td" paddingX={1}>
										<DeleteButton onClick={() => mutations.deleteValue([...path, idx])} />
									</Box>
								) : null}
							</Box>
						))}
					</Box>
				</Box>
			</Box>
		);
	};

	const renderBranch = (path: ThingPath, value: unknown, depth: number): React.ReactNode => {
		const keys = childKeysOf(value);

		return (
			<Flex flexDirection="column" rowGap={depth === 0 ? 4 : 1}>
				{keys.map((key) => {
					const childPath = [...path, key];
					const child = getAtPath(thing, childPath);
					const id = childPath.join('¶');

					if (!isBranch(child)) {
						return renderLeafRow(childPath, key, child);
					}

					const items = Array.isArray(child) ? child : null;
					const tableKeys = items ? sharedTableKeys(items) : null;
					const allLeaves = items ? items.every((item) => !isBranch(item)) : false;
					const isCollapsed = collapsed[id] === true;
					const headingSize = headingSizes[Math.min(depth, headingSizes.length - 1)];

					return (
						<Box key={String(key)} marginTop={depth === 0 ? 0 : 2}>
							<Flex alignItems="center" columnGap={2} role="group">
								<Box
									as="button"
									type="button"
									aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
									color="var(--tt-faint, #b6b6c0)"
									cursor="pointer"
									fontSize="11px"
									onClick={() => toggleCollapsed(id)}
								>
									{isCollapsed ? '▸' : '▾'}
								</Box>
								<Text fontSize="16px" aria-hidden>
									{keyEmoji(key, child)}
								</Text>
								<Text
									color="var(--tt-ink, #16161a)"
									fontSize={headingSize}
									fontWeight={800}
									letterSpacing="-0.01em"
									lineHeight="1.2"
								>
									{humanizeKey(key)}
								</Text>
								{edit ? <DeleteButton onClick={() => mutations.deleteValue(childPath)} /> : null}
							</Flex>

							{!isCollapsed ? (
								<Box
									borderLeft={depth >= 1 ? '2px solid var(--tt-border-light, #f0f0f2)' : 'none'}
									marginTop={1.5}
									paddingLeft={depth >= 1 ? 4 : 6}
								>
									<KindFlip thing={child} defaultRendered={false}>
										{items && tableKeys
											? renderTable(childPath, items, tableKeys)
											: items && allLeaves
												? renderChipList(childPath, items)
												: renderBranch(childPath, child, depth + 1)}
										{edit && !(items && allLeaves) ? (
											<Box marginTop={2}>
												<AddChildButton label="Grow" onClick={() => mutations.addChild(childPath, items ? {} : '')} />
											</Box>
										) : null}
									</KindFlip>
								</Box>
							) : (
								<Text color="var(--tt-faint, #b6b6c0)" fontSize="xs" marginLeft={6} marginTop={1}>
									{Array.isArray(child) ? `[…] ${child.length}` : `{…} ${childKeysOf(child).length}`}
								</Text>
							)}
						</Box>
					);
				})}
			</Flex>
		);
	};

	return (
		<Box
			ref={containerRef}
			background="var(--tt-card, #ffffff)"
			border="1px solid var(--tt-border, #ececef)"
			borderRadius="var(--tt-radius-lg, 16px)"
			boxShadow="var(--tt-shadow-card, 0 1px 2px rgba(0,0,0,0.05))"
			padding={layout === 'mobile' ? 4 : 6}
			width="100%"
		>
			{isBranch(thing) ? (
				<>
					{renderBranch([], thing, 0)}
					{edit ? (
						<Box marginTop={4}>
							<AddChildButton onClick={() => mutations.addChild([])} />
						</Box>
					) : null}
				</>
			) : (
				<LeafValueEditor value={thing} edit={edit} onValueChange={(next) => mutations.setValue([], next)} />
			)}
		</Box>
	);
};
