import React from 'react';
import { Box, Button, Flex, Spinner, Text } from '@chakra-ui/react';
import { Link, useNavigate } from 'react-router';
import { libraryBuilderHref } from '~/library/builderLinks';
import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { CARD_STYLES } from '../../theme/card';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { BuilderThingMenu } from './BuilderThingMenu';
import { countBlocks, type WebpageBlock } from './webpageBlocks';
import { useBuilderThings } from './useBuilderThings';

const BuilderListStatus = ({ list, label }: { list: ReturnType<typeof useBuilderThings>; label: string }) => (
	<>
		{list.loading ? (
			<Flex role="status" alignItems="center" gap={2} paddingY={2}>
				<Spinner size="sm" aria-hidden="true" />
				<Text>Loading {label}…</Text>
			</Flex>
		) : null}
		{list.error ? (
			<Flex role="alert" alignItems="center" gap={3} flexWrap="wrap" paddingY={2}>
				<Text>{list.error}</Text>
				<Button size="sm" onClick={list.retry} aria-label={`Retry ${label}`}>
					Retry
				</Button>
			</Flex>
		) : list.nextCursor ? (
			<Button alignSelf="flex-start" size="sm" variant="outline" onClick={list.loadMore} isDisabled={list.loading}>
				Load more {label}
			</Button>
		) : null}
	</>
);

export const BuilderPagesList = () => {
	const user = useCurrentUser();
	const dataPlane = useDataPlane();
	return <AccountPagesList key={JSON.stringify([user?.id || 'anonymous', dataPlane])} />;
};

const AccountPagesList = () => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const user = useCurrentUser();
	const navigate = useNavigate();
	const [creating, setCreating] = React.useState(false);
	const [revision, refresh] = React.useReducer((value) => value + 1, 0);
	const pages = useBuilderThings(api.v1.things.list, 'webpage', revision, !!user?.id);
	const components = useBuilderThings(api.v1.things.list, 'component', revision, !!user?.id);

	const createPage = async () => {
		setCreating(true);
		try {
			const resp: any = await apiRef.current.v1.things.create({
				thingtime: ['webpage'],
				crystal: { name: 'Untitled page', version: 1, blocks: [] },
				acl: ['tt:user']
			});
			if (!resp?.ok) throw resp;
			const id = resp?.thing?.id || resp?.id;
			lopu({ title: 'New page created 🧱✨', status: 'success' });
			navigate(`/builder?page=${encodeURIComponent(id)}`);
		} catch (err: any) {
			lopu({ title: err?.error || 'Couldn’t create the page — try again 🌈', status: 'error' });
		} finally {
			setCreating(false);
		}
	};

	return (
		<PageShell width={920}>
			<PageHeader
				eyebrow="Thingtime · block by block"
				title="Builder 🧱"
				subtitle="Build webpages from Thingtime components and actions — manage their settings, privacy and content in one place."
				after={
					<Flex columnGap={2} rowGap={2} flexWrap="wrap" alignItems="center">
						<Button as={Link} to={libraryBuilderHref()} size="sm" variant="outline">
							Integration library
						</Button>
						<Button as={Link} to="/docs/builder" size="sm" variant="outline">
							Builder docs
						</Button>
						<Button as={Link} to="/builder/demos" size="sm" variant="outline" data-testid="builder-demo-library">
							Demo library 🧱
						</Button>
						{user?.id ? (
							<Button size="sm" onClick={createPage} isLoading={creating} data-testid="builder-new-page">
								New page ✨
							</Button>
						) : null}
					</Flex>
				}
			/>
			{!user?.id ? (
				<Flex {...CARD_STYLES} padding={6} flexDirection="column" rowGap={2}>
					<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
						Sign in to build pages 🗝️
					</Text>
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
						Your pages are things — private by default, with the same audience and link sharing options as everything else.
					</Text>
				</Flex>
			) : (
				<Flex flexDirection="column" rowGap={3}>
					<Flex {...CARD_STYLES} padding={4} alignItems="center" justifyContent="space-between" columnGap={3}>
						<Box minWidth={0}>
							<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
								Global blocks 🌐
							</Text>
							<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="11px">
								blocks that render on every page — yours only
							</Text>
						</Box>
						<Button as={Link} to="/builder?page=__global__" size="xs" flexShrink={0}>
							Edit
						</Button>
					</Flex>
					<Text as="h2" fontWeight={700}>
						Pages
					</Text>
					{pages.loaded && !pages.loading && !pages.error && !pages.nextCursor && pages.rows.length === 0 ? (
						<Flex {...CARD_STYLES} padding={6} flexDirection="column" rowGap={2}>
							<Text color="var(--tt-ink, #16161a)" fontWeight={700}>
								No pages yet 🌱
							</Text>
							<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
								Hit “New page ✨” to start one, then use its settings menu to share, duplicate, import or export it.
							</Text>
						</Flex>
					) : null}

					{pages.rows.map((page) => (
						<Flex key={page.id} {...CARD_STYLES} padding={4} alignItems="center" justifyContent="space-between" columnGap={3}>
							<Box minWidth={0}>
								<Text color="var(--tt-ink, #16161a)" fontWeight={700} noOfLines={1}>
									{page.crystal?.name || 'Untitled page'}
								</Text>
								<Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, ui-monospace, monospace)" fontSize="11px" noOfLines={1}>
									{page.crystal?.siteRoute
										? `site page · ${page.crystal.siteRoute}`
										: `${countBlocks((page.crystal?.blocks as WebpageBlock[]) || [])} blocks · /p/${page.id}`}
								</Text>
							</Box>
							<Flex columnGap={2} flexShrink={0}>
								<BuilderThingMenu id={page.id} onChanged={refresh} />
								{!page.crystal?.siteRoute ? (
									<Button as={Link} to={`/p/${page.id}`} size="xs" variant="outline">
										View
									</Button>
								) : (
									<Button as={Link} to={page.crystal.siteRoute} size="xs" variant="outline">
										Visit
									</Button>
								)}
								<Button as={Link} to={`/builder?page=${encodeURIComponent(page.id)}`} size="xs">
									Edit
								</Button>
							</Flex>
						</Flex>
					))}
					<BuilderListStatus list={pages} label="pages" />
					<Text as="h2" fontWeight={700} marginTop={4}>
						Components
					</Text>
					{components.rows.map((component) => (
						<Flex key={component.id} {...CARD_STYLES} padding={4} alignItems="center" gap={3}>
							<Text fontWeight={700} flex={1} minWidth={0} noOfLines={2}>
								{component.crystal?.name || 'Untitled component'}
							</Text>
							<BuilderThingMenu id={component.id} kind="component" onChanged={refresh} />
							<Button as={Link} to={`/thing/${encodeURIComponent(component.id)}`} size="xs">
								Open
							</Button>
						</Flex>
					))}
					{components.loaded && !components.loading && !components.error && !components.nextCursor && !components.rows.length ? (
						<Text color="var(--tt-text, #5a5a66)">No components yet.</Text>
					) : null}
					<BuilderListStatus list={components} label="components" />
				</Flex>
			)}
		</PageShell>
	);
};
