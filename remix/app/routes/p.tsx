import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link, useNavigate, useParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
// the REGISTRY module (not just the lookups): importing it registers the app
// suites, so a cold load of /p/pokeworld knows the page belongs to an app
import { ALL_SUITES } from '~/schemas/appSuites/index';
import { isSafeCssText } from '../components/Kinds/safeUrl';
import { PageShell } from '../components/Layout/PageShell';
import { WebpageBlocksRenderer } from '../components/Builder/WebpageBlocksRenderer';
import { installSuite, installSuiteOnServer, suiteKeyFromActionKey, suiteKeyOfPage } from '../components/Builder/installSuite';
import { useWebpageDraft } from '../components/Builder/useWebpage';
import { WebpageRuntimeProvider } from '../components/Builder/webpageRuntime';
import type { WebpageBlock } from '../components/Builder/webpageBlocks';

// /p/:id — a published block-based webpage, rendered exactly as the builder
// composed it. ttAction interactivity follows the PreviewModal trust rule:
// live for the page owner viewing their own page, inert for everyone else —
// with one addition: a SYSTEM-seeded page that belongs to a behaviour suite
// (the demo library's suites and the installable APP suites — Pokeworld,
// StarsAlign) is platform-curated, so its controls are live for any
// signed-in viewer. The executor still resolves those clicks owner-only, so
// a control can only run the viewer's own program; when they have none, the
// page installs the suite into their things and re-runs the same click.
//
// `:id` may be a shareId OR a pageKey: the resolver answers with the viewer's
// own twin of a keyed page ahead of the seeded copy, so an installed app's
// links (/p/pokeworld, /p/pokeworld-pokedex) serve everyone the right page.
// The page runtime (WebpageRuntimeProvider) is what makes source-bound
// blocks fetch and refetch after every control run.

export default function PublicWebpage() {
	const { id } = useParams();
	const user = useCurrentUser();
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const lopu = useLopu();
	const navigate = useNavigate();
	const draft = useWebpageDraft(React.useMemo(() => (id ? { kind: 'id' as const, id } : null), [id]));
	const page = draft.resolved?.page || null;
	const isOwner = !!user?.id && page?.author?.id === user.id;
	// system docs project no author; the seeded suite pages are exactly the
	// reserved-prefix ids (user creates refuse webpage-), so the id is the test
	const suiteKey = suiteKeyOfPage(page?.crystal as { suiteKey?: unknown; pageKey?: unknown } | null);
	const isSeeded =
		typeof page?.id === 'string' &&
		page.id.startsWith('webpage-') &&
		!!suiteKey &&
		!!ALL_SUITES.some((suite) => suite.key === suiteKey) &&
		draft.resolved?.source !== 'user';
	// /p/ renders ANOTHER user's page, so previewBg is untrusted here. The write
	// gate only bounds it (length, no <>, no javascript:); isSafeCssText is the
	// shared render-time screen the component previews already apply to this
	// same field, and the only thing blocking @import / expression().
	const previewBg =
		typeof page?.crystal?.previewBg === 'string' && isSafeCssText(page.crystal.previewBg)
			? page.crystal.previewBg
			: 'var(--tt-surface, #fafafb)';

	React.useEffect(() => {
		if (typeof document !== 'undefined' && page?.crystal?.name) {
			document.title = `${page.crystal.name} · Thingtime`;
		}
	}, [page?.crystal?.name]);

	// The post-install hand-off is deferred so the "installed ✨" toast is
	// readable before the page moves. That timer OUTLIVES this component if the
	// viewer navigates away inside the delay, and it would then yank them off
	// whatever they opened next (or reload it). Held in a ref so unmount — and
	// a second install — cancels the pending hand-off.
	const handoffRef = React.useRef<number | null>(null);
	const scheduleHandoff = React.useCallback((run: () => void, delayMs: number) => {
		if (handoffRef.current !== null) window.clearTimeout(handoffRef.current);
		handoffRef.current = window.setTimeout(() => {
			handoffRef.current = null;
			run();
		}, delayMs);
	}, []);
	React.useEffect(
		() => () => {
			if (handoffRef.current !== null) {
				window.clearTimeout(handoffRef.current);
				handoffRef.current = null;
			}
		},
		[]
	);

	// Install the page's suite for the viewer. App suites go through the
	// one-request idempotent server install (every page keeps its key, so the
	// current URL now serves the viewer's own copy); the demo suites keep the
	// part-by-part client install and open the personal copy by id.
	const installForViewer = React.useCallback(
		async (key: string): Promise<{ href: string | null } | null> => {
			const suite = ALL_SUITES.find((entry) => entry.key === key) || null;
			if (!suite) return null;
			if (!user?.id) {
				lopu({ title: 'Sign in to install this 🗝️', description: 'Installing it makes the programs — and the data — yours.', status: 'info' });
				navigate('/login');
				return null;
			}
			lopu({ title: `Installing ${suite.emoji} ${suite.title}…`, description: 'Your own schemas, controls, actions, and pages.', status: 'info', duration: 4000 });
			if (suite.app) {
				const installed = await installSuiteOnServer(suite.key);
				lopu({
					title: `${suite.emoji} ${suite.title} installed ✨`,
					description: `${installed.created} things created · ${installed.updated} refreshed — this page is yours now.`,
					status: 'success',
					duration: 6000
				});
				return { href: `/p/${encodeURIComponent(installed.entryPageKey)}` };
			}
			const installed = await installSuite((payload) => apiRef.current.v1.things.create(payload), suite, { seeded: true });
			lopu({
				title: `${suite.emoji} ${suite.title} installed ✨`,
				description: 'Opening your own copy of this page.',
				status: 'success',
				duration: 6000,
				link: { label: 'Open my page', href: `/p/${encodeURIComponent(installed.pageId)}` }
			});
			return { href: `/p/${encodeURIComponent(installed.pageId)}` };
		},
		[lopu, navigate, user?.id]
	);

	// a seeded suite control the viewer has no program for: install the suite
	// (their own schemas/controls/actions/data/page), let the click re-run,
	// then take them to their own copy where every control is theirs
	const onUnowned = React.useCallback(
		async (action: string): Promise<boolean> => {
			const key = suiteKeyFromActionKey(action, ALL_SUITES) || suiteKey;
			if (!key) return false;
			try {
				const outcome = await installForViewer(key);
				if (!outcome) return false;
				if (outcome.href) {
					const target = outcome.href;
					scheduleHandoff(() => {
						// same URL for app suites — a reload re-resolves the viewer's twin
						if (target === window.location.pathname) window.location.reload();
						else navigate(target);
					}, 1200);
				}
				return true;
			} catch (err: any) {
				lopu({ title: err?.error || 'Couldn’t install — try again 🌈', status: 'error' });
				return false;
			}
		},
		[installForViewer, lopu, navigate, scheduleHandoff, suiteKey]
	);

	const onInstall = React.useCallback(async (): Promise<boolean> => {
		if (!suiteKey) return false;
		try {
			const outcome = await installForViewer(suiteKey);
			if (!outcome) return false;
			if (outcome.href) {
				const target = outcome.href;
				if (target === window.location.pathname) window.location.reload();
				else navigate(target);
			}
			return true;
		} catch (err: any) {
			lopu({ title: err?.error || 'Couldn’t install — try again 🌈', status: 'error' });
			return false;
		}
	}, [installForViewer, lopu, navigate, suiteKey]);

	if (!draft.loading && !page) {
		return (
			<PageShell width={680}>
				<Flex flexDirection="column" rowGap={2} paddingTop={12} alignItems="center" textAlign="center">
					<Text fontSize="3xl">🫧</Text>
					<Text color="var(--tt-ink, #16161a)" fontFamily="heading" fontSize="xl" fontWeight={800}>
						This page isn’t here
					</Text>
					<Text color="var(--tt-text, #5a5a66)" fontSize="sm">
						It may be private, moved, or never have existed. Build your own in the builder 🧱
					</Text>
					<Button as={Link} to="/builder" size="sm" marginTop={2}>
						Open the builder
					</Button>
				</Flex>
			</PageShell>
		);
	}

	const interactive = isOwner || isSeeded;

	return (
		<WebpageRuntimeProvider
			pageId={page?.id || null}
			pageKey={typeof page?.crystal?.pageKey === 'string' ? page.crystal.pageKey : null}
			suiteKey={suiteKey}
			source={draft.resolved?.source || null}
			onInstall={isSeeded ? onInstall : undefined}
		>
			<Flex
				flexDirection="column"
				width="100%"
				minHeight="100vh"
				background={previewBg}
				paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
				paddingBottom={12}
				whiteSpace="normal"
			>
				<Box width="100%" maxWidth="960px" marginX="auto" paddingX={4} paddingTop={6}>
					{isOwner ? (
						<Flex justifyContent="flex-end" marginBottom={2}>
							<Button as={Link} to={`/builder?page=${encodeURIComponent(page!.id)}`} size="xs" variant="outline" data-testid="p-edit-in-builder">
								✏️ Edit in builder
							</Button>
						</Flex>
					) : null}
					<WebpageBlocksRenderer
						blocks={(page?.crystal?.blocks as WebpageBlock[]) || []}
						componentsByRef={draft.componentsByRef}
						interactive={interactive}
						onTtActionUnowned={isSeeded ? onUnowned : undefined}
					/>
				</Box>
			</Flex>
		</WebpageRuntimeProvider>
	);
}
