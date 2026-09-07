import { Box, Button, Flex, Heading, Input, Table, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useMarketingPublications, usePreviewAsVisitor } from '~/components/Marketing/marketingPublicationsStore';
import { apiErrorMessage } from '~/hooks/apiFailure';
import { CATEGORIES, MARKETING_BASE, pageHref, pagesInCategory } from '~/marketing/catalog';
import { FEATURES } from '~/marketing/features';
import {
	EMPTY_PUBLICATIONS,
	HUB_KEY,
	SOCIAL_KEY,
	allPublishableKeys,
	categoryKey,
	categoryPageKeys,
	changesFor,
	pageKey,
	resolvePublicationKey,
	socialFeatureKey,
	summarizePublications,
	type PublicationState
} from '~/marketing/publishing';
import { CARD_STYLES } from '~/theme/card';

// /admin → Marketing: the whole-suite view of marketing publishing
// (marketing/publishing.ts). The in-page admin bar publishes the surface you
// are looking at; this panel is where you sweep — every category with its
// published/total count, bulk switches, the page list behind each category
// with a filter and one switch per page, the social suite with one switch per
// feature image set, and the sections you hid. Every write goes through the
// same shared store as the marketing pages, so both stay in step.

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';
const PAGE_STEP = 100;

const eyebrow = {
	fontFamily: MONO,
	fontSize: '10px',
	fontWeight: 600,
	letterSpacing: '0.08em',
	textTransform: 'uppercase' as const,
	color: 'var(--tt-muted, #9a9aa6)'
};

const StateDot = ({ on }: { on: boolean }) => (
	<Text as="span" display="inline-flex" alignItems="center" gap={1.5} fontFamily={MONO} fontSize="11px" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase" whiteSpace="nowrap" data-published={on ? 'true' : 'false'}>
		<Box as="span" width="8px" height="8px" borderRadius="999px" background={on ? 'var(--tt-positive, #2f8f4f)' : 'var(--tt-faint, #b6b6c0)'} flex="none" />
		{on ? 'Published' : 'Unpublished'}
	</Text>
);

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
	<Box px={3} py={2} border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-md, 10px)" minWidth="120px">
		<Text {...eyebrow}>{label}</Text>
		<Text fontWeight={700} fontSize="15px" color="var(--tt-ink, #16161a)" marginTop={0.5}>
			{value}
		</Text>
	</Box>
);

type SetState = (keys: string[], state: PublicationState | null, label: string) => Promise<void>;

export const MarketingPublishingTab = () => {
	const lopu = useLopu();
	const { publications, status, pending, apply, refresh } = useMarketingPublications();
	const [preview, setPreview] = usePreviewAsVisitor();
	const [openCategory, setOpenCategory] = React.useState<string | null>(null);
	const [socialOpen, setSocialOpen] = React.useState(false);
	const [confirming, setConfirming] = React.useState<'publish-all' | 'unpublish-all' | null>(null);

	React.useEffect(() => {
		void refresh({ force: true });
	}, [refresh]);

	const current = publications ?? EMPTY_PUBLICATIONS;
	const published = React.useMemo(() => new Set(current.published), [current.published]);
	const summary = React.useMemo(() => summarizePublications(current), [current]);
	const busy = pending > 0;

	const setState = React.useCallback<SetState>(
		async (keys, state, label) => {
			if (!keys.length) return;
			try {
				await apply(changesFor(keys, state));
				const verb = state === 'published' ? 'Published' : state === 'hidden' ? 'Hidden' : keys[0]?.startsWith('section:') ? 'Showing' : 'Unpublished';
				lopu({ title: `${verb} ${label}`, status: 'success', duration: 3500 });
			} catch (error) {
				lopu({ title: 'Publishing did not save', description: apiErrorMessage(error, 'Thingtime could not update the marketing publish state.'), status: 'error' });
			}
		},
		[apply, lopu]
	);

	const allKeys = React.useMemo(() => allPublishableKeys(), []);
	const unpublishedAll = allKeys.filter((key) => !published.has(key));
	const publishedAll = allKeys.filter((key) => published.has(key));
	const socialKeys = React.useMemo(() => FEATURES.map((feature) => socialFeatureKey(feature.key)), []);
	const socialRemaining = socialKeys.filter((key) => !published.has(key));

	return (
		<Box display="grid" gap={4} data-testid="admin-marketing-tab">
			<Box {...CARD_STYLES} p={5}>
				<Flex justify="space-between" align="flex-start" gap={4} flexWrap="wrap">
					<Box maxWidth="640px">
						<Text {...eyebrow}>Marketing publishing</Text>
						<Heading size="md" letterSpacing="-0.015em" color="var(--tt-ink, #16161a)" marginTop={1}>
							Publish the suite one piece at a time 📣
						</Heading>
						<Text fontSize="sm" color="var(--tt-muted, #777783)" lineHeight="1.7" marginTop={2}>
							Everything under <Box as="code" fontFamily={MONO}>/marketing</Box> is admin-only until you switch it on. Publish the hub, a category
							index, single pages, one feature’s social image set — or hide a section inside a page you already published. Publishing a
							category never publishes its pages: the index lists whatever pages are live.
						</Text>
					</Box>
					<Flex gap={2} flexWrap="wrap" align="center">
						<Button as={RouterLink} to={MARKETING_BASE} size="sm" variant="outline">
							Open /marketing
						</Button>
						<Button size="sm" variant={preview ? 'solid' : 'outline'} onClick={() => setPreview(!preview)} data-testid="admin-marketing-preview">
							{preview ? '👁️ Previewing as visitor' : '👁️ View as visitor'}
						</Button>
						<Button size="sm" variant="outline" isDisabled={busy || status === 'cold'} onClick={() => void refresh({ force: true })}>
							Refresh
						</Button>
					</Flex>
				</Flex>
				<Flex gap={2} flexWrap="wrap" marginTop={4} data-testid="admin-marketing-stats">
					<Stat label="Hub" value={<StateDot on={summary.hub} />} />
					<Stat label="Category indexes" value={`${summary.categories.filter((category) => category.indexPublished).length} / ${summary.categories.length}`} />
					<Stat label="Pages" value={`${summary.pages.published.toLocaleString()} / ${summary.pages.total.toLocaleString()}`} />
					<Stat label="Social suite" value={<StateDot on={summary.social} />} />
					<Stat label="Image sets" value={`${summary.socialFeatures.published} / ${summary.socialFeatures.total}`} />
					<Stat label="Hidden sections" value={summary.hiddenSections} />
					<Stat label="Last change" value={current.updatedAt ? new Date(current.updatedAt).toLocaleString() : '—'} />
				</Flex>
				<Flex gap={2} flexWrap="wrap" marginTop={4} align="center">
					{confirming ? (
						<>
							<Text fontSize="sm" color="var(--tt-ink, #16161a)">
								{confirming === 'publish-all'
									? `Publish all ${unpublishedAll.length.toLocaleString()} remaining surfaces (hub, indexes, pages, suite, image sets)?`
									: `Unpublish all ${publishedAll.length.toLocaleString()} surfaces? Visitors lose the whole suite.`}
							</Text>
							<Button
								size="sm"
								colorScheme={confirming === 'publish-all' ? 'green' : 'red'}
								isDisabled={busy}
								onClick={() => {
									const keys = confirming === 'publish-all' ? unpublishedAll : publishedAll;
									setConfirming(null);
									void setState(keys, confirming === 'publish-all' ? 'published' : null, `${keys.length.toLocaleString()} surfaces`);
								}}
								data-testid="admin-marketing-confirm"
							>
								Yes, {confirming === 'publish-all' ? 'publish' : 'unpublish'} everything
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
								Cancel
							</Button>
						</>
					) : (
						<>
							<Button size="sm" variant="outline" isDisabled={busy || !unpublishedAll.length} onClick={() => setConfirming('publish-all')} data-testid="admin-marketing-publish-everything">
								🌐 Publish everything
							</Button>
							<Button size="sm" variant="outline" isDisabled={busy || !publishedAll.length} onClick={() => setConfirming('unpublish-all')} data-testid="admin-marketing-unpublish-everything">
								🔒 Unpublish everything
							</Button>
						</>
					)}
				</Flex>
			</Box>

			<Box {...CARD_STYLES} p={0} overflow="hidden">
				<Box overflowX="auto">
					<Table size="sm" variant="simple">
						<Thead>
							<Tr>
								<Th>Surface</Th>
								<Th>State</Th>
								<Th isNumeric>Published</Th>
								<Th>Actions</Th>
							</Tr>
						</Thead>
						<Tbody>
							<Tr data-testid="admin-marketing-row" data-key={HUB_KEY}>
								<Td>
									<Text fontWeight={700}>🌈 Marketing hub</Text>
									<Text fontSize="xs" color="var(--tt-muted, #777783)" fontFamily={MONO}>
										/marketing · also gates /marketing/search
									</Text>
								</Td>
								<Td>
									<StateDot on={summary.hub} />
								</Td>
								<Td isNumeric>—</Td>
								<Td>
									<Flex gap={2} flexWrap="wrap">
										<Button size="xs" variant="outline" isDisabled={busy} onClick={() => void setState([HUB_KEY], summary.hub ? null : 'published', 'the marketing hub')}>
											{summary.hub ? 'Unpublish' : 'Publish'}
										</Button>
										<Button as={RouterLink} to={MARKETING_BASE} size="xs" variant="ghost">
											Open
										</Button>
									</Flex>
								</Td>
							</Tr>

							<Tr data-testid="admin-marketing-row" data-key={SOCIAL_KEY}>
								<Td>
									<Text fontWeight={700}>📸 Social image suite</Text>
									<Text fontSize="xs" color="var(--tt-muted, #777783)" fontFamily={MONO}>
										/marketing/social-media · one image set per feature
									</Text>
								</Td>
								<Td>
									<StateDot on={summary.social} />
								</Td>
								<Td isNumeric>
									{summary.socialFeatures.published} / {summary.socialFeatures.total} sets
								</Td>
								<Td>
									<Flex gap={2} flexWrap="wrap">
										<Button size="xs" variant="outline" isDisabled={busy} onClick={() => void setState([SOCIAL_KEY], summary.social ? null : 'published', 'the social image suite')}>
											{summary.social ? 'Unpublish' : 'Publish'}
										</Button>
										<Button
											size="xs"
											variant="outline"
											isDisabled={busy}
											onClick={() =>
												void (socialRemaining.length
													? setState(socialRemaining, 'published', `${socialRemaining.length} image sets`)
													: setState(socialKeys, null, `${socialKeys.length} image sets`))
											}
										>
											{socialRemaining.length ? `Publish all ${socialRemaining.length} sets` : `Unpublish all ${socialKeys.length} sets`}
										</Button>
										<Button size="xs" variant="ghost" onClick={() => setSocialOpen((open) => !open)} aria-expanded={socialOpen}>
											{socialOpen ? 'Hide sets' : 'Image sets'}
										</Button>
									</Flex>
								</Td>
							</Tr>
							{socialOpen ? (
								<Tr>
									<Td colSpan={4} background="var(--tt-surface-alt, #f5f5f7)">
										<Flex gap={2} flexWrap="wrap" data-testid="admin-marketing-social-sets">
											{FEATURES.map((feature) => {
												const key = socialFeatureKey(feature.key);
												const on = published.has(key);
												return (
													<Button
														key={feature.key}
														size="xs"
														variant={on ? 'solid' : 'outline'}
														isDisabled={busy}
														onClick={() => void setState([key], on ? null : 'published', `${feature.name} image set`)}
														aria-pressed={on}
														title={on ? 'Published — click to unpublish' : 'Not published — click to publish'}
													>
														{on ? '🌐' : '🔒'} {feature.emoji} {feature.name}
													</Button>
												);
											})}
										</Flex>
									</Td>
								</Tr>
							) : null}

							{CATEGORIES.map((category) => {
								const row = summary.categories.find((entry) => entry.key === category.key)!;
								const keys = categoryPageKeys(category.key);
								const remaining = keys.filter((key) => !published.has(key));
								const isOpen = openCategory === category.key;
								return (
									<React.Fragment key={category.key}>
										<Tr data-testid="admin-marketing-row" data-key={categoryKey(category.key)}>
											<Td>
												<Text fontWeight={700}>
													{category.emoji} {category.name}
												</Text>
												<Text fontSize="xs" color="var(--tt-muted, #777783)" fontFamily={MONO}>
													/marketing/{category.key}
												</Text>
											</Td>
											<Td>
												<StateDot on={row.indexPublished} />
											</Td>
											<Td isNumeric>
												{row.published.toLocaleString()} / {row.total.toLocaleString()} pages
											</Td>
											<Td>
												<Flex gap={2} flexWrap="wrap">
													<Button
														size="xs"
														variant="outline"
														isDisabled={busy}
														onClick={() => void setState([categoryKey(category.key)], row.indexPublished ? null : 'published', `the ${category.name} index`)}
													>
														{row.indexPublished ? 'Unpublish index' : 'Publish index'}
													</Button>
													<Button
														size="xs"
														variant="outline"
														isDisabled={busy}
														onClick={() =>
															void (remaining.length
																? setState(remaining, 'published', `${remaining.length} ${category.name} pages`)
																: setState(keys, null, `${keys.length} ${category.name} pages`))
														}
													>
														{remaining.length ? `Publish all ${remaining.length}` : `Unpublish all ${keys.length}`}
													</Button>
													<Button size="xs" variant="ghost" onClick={() => setOpenCategory(isOpen ? null : category.key)} aria-expanded={isOpen}>
														{isOpen ? 'Hide pages' : 'Pages'}
													</Button>
													<Button as={RouterLink} to={`${MARKETING_BASE}/${category.key}`} size="xs" variant="ghost">
														Open
													</Button>
												</Flex>
											</Td>
										</Tr>
										{isOpen ? (
											<Tr>
												<Td colSpan={4} background="var(--tt-surface-alt, #f5f5f7)" padding={0}>
													<CategoryPages category={category.key} published={published} busy={busy} setState={setState} />
												</Td>
											</Tr>
										) : null}
									</React.Fragment>
								);
							})}
						</Tbody>
					</Table>
				</Box>
			</Box>

			{current.hidden.length ? (
				<Box {...CARD_STYLES} p={5} data-testid="admin-marketing-hidden">
					<Text {...eyebrow}>Hidden sections</Text>
					<Text fontSize="sm" color="var(--tt-muted, #777783)" marginTop={1} marginBottom={3}>
						Sections switched off inside published pages. Showing one puts it back for visitors.
					</Text>
					<Flex direction="column" gap={2}>
						{current.hidden.map((key) => {
							const resolved = resolvePublicationKey(key);
							const target = resolved.ok && resolved.target.type === 'section' ? resolved.target : null;
							return (
								<Flex key={key} gap={3} align="center" justify="space-between" flexWrap="wrap">
									<Box minWidth={0}>
										<Text fontSize="sm" fontWeight={600} noOfLines={1}>
											{resolved.ok ? resolved.label : key}
										</Text>
										<Text fontSize="xs" fontFamily={MONO} color="var(--tt-muted, #777783)" noOfLines={1}>
											{key}
										</Text>
									</Box>
									<Flex gap={2}>
										{target ? (
											<Button as={RouterLink} to={pageHref(target.slug)} size="xs" variant="ghost">
												Open page
											</Button>
										) : null}
										<Button size="xs" variant="outline" isDisabled={busy} onClick={() => void setState([key], null, resolved.ok ? resolved.label : key)}>
											Show
										</Button>
									</Flex>
								</Flex>
							);
						})}
					</Flex>
				</Box>
			) : null}
		</Box>
	);
};

const CategoryPages = ({ category, published, busy, setState }: { category: string; published: Set<string>; busy: boolean; setState: SetState }) => {
	const [filter, setFilter] = React.useState('');
	const [limit, setLimit] = React.useState(PAGE_STEP);
	const pages = React.useMemo(() => pagesInCategory(category), [category]);
	const filtered = React.useMemo(() => {
		const needle = filter.trim().toLowerCase();
		if (!needle) return pages;
		return pages.filter((entry) => `${entry.title} ${entry.slug}`.toLowerCase().includes(needle));
	}, [filter, pages]);
	const unpublishedMatches = filtered.filter((entry) => !published.has(pageKey(entry.slug)));

	return (
		<Box p={3} data-testid="admin-marketing-pages">
			<Flex gap={2} align="center" marginBottom={2} flexWrap="wrap">
				<Input
					size="sm"
					maxWidth="320px"
					value={filter}
					onChange={(event) => {
						setFilter(event.target.value);
						setLimit(PAGE_STEP);
					}}
					placeholder={`Filter ${pages.length.toLocaleString()} pages…`}
					aria-label="Filter pages"
					background="var(--tt-card, #ffffff)"
				/>
				<Text fontSize="xs" fontFamily={MONO} color="var(--tt-muted, #777783)">
					{filtered.length - unpublishedMatches.length} of {filtered.length} shown pages published
				</Text>
				{filter.trim() && unpublishedMatches.length ? (
					<Button
						size="xs"
						variant="outline"
						isDisabled={busy}
						onClick={() => void setState(unpublishedMatches.map((entry) => pageKey(entry.slug)), 'published', `${unpublishedMatches.length} matching pages`)}
					>
						Publish {unpublishedMatches.length} matches
					</Button>
				) : null}
			</Flex>
			<Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(min(320px, 100%), 1fr))" gap={1.5}>
				{filtered.slice(0, limit).map((entry) => {
					const key = pageKey(entry.slug);
					const on = published.has(key);
					return (
						<Flex
							key={entry.slug}
							gap={2}
							align="center"
							px={2}
							py={1.5}
							border="1px solid var(--tt-border, #ececef)"
							borderRadius="var(--tt-radius-md, 10px)"
							background="var(--tt-card, #ffffff)"
							data-testid="admin-marketing-page-row"
							data-published={on ? 'true' : 'false'}
						>
							<Button
								size="xs"
								variant={on ? 'solid' : 'outline'}
								flex="none"
								isDisabled={busy}
								onClick={() => void setState([key], on ? null : 'published', entry.title)}
								aria-pressed={on}
								aria-label={`${on ? 'Unpublish' : 'Publish'} ${entry.title}`}
							>
								{on ? '🌐' : '🔒'}
							</Button>
							<Box minWidth={0} flex="1 1 auto">
								<Text fontSize="sm" fontWeight={600} noOfLines={1} title={entry.title}>
									{entry.title}
								</Text>
								<Text fontSize="xs" fontFamily={MONO} color="var(--tt-muted, #777783)" noOfLines={1}>
									{entry.slug}
								</Text>
							</Box>
							<Button as={RouterLink} to={pageHref(entry.slug)} size="xs" variant="ghost" flex="none">
								Open
							</Button>
						</Flex>
					);
				})}
			</Box>
			{filtered.length > limit ? (
				<Flex justify="center" marginTop={3}>
					<Button size="sm" variant="outline" onClick={() => setLimit((current) => current + PAGE_STEP)}>
						Show {Math.min(PAGE_STEP, filtered.length - limit)} more of {filtered.length - limit}
					</Button>
				</Flex>
			) : null}
		</Box>
	);
};
