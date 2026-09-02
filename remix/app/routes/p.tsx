import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link, useNavigate, useParams } from 'react-router';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { BEHAVIOUR_SUITES, getBehaviourSuite } from '~/schemas/behaviourSuites';
import { isSafeCssText } from '../components/Kinds/safeUrl';
import { PageShell } from '../components/Layout/PageShell';
import { WebpageBlocksRenderer } from '../components/Builder/WebpageBlocksRenderer';
import { installSuite, suiteKeyFromActionKey, suiteKeyFromPageKey } from '../components/Builder/installSuite';
import { useWebpageDraft } from '../components/Builder/useWebpage';
import type { WebpageBlock } from '../components/Builder/webpageBlocks';

// /p/:id — a published block-based webpage, rendered exactly as the builder
// composed it. ttAction interactivity follows the PreviewModal trust rule:
// live for the page owner viewing their own page, inert for everyone else —
// with one addition: a SYSTEM-seeded page (the demo library's behaviour
// suites) is platform-curated, so its controls are live for any signed-in
// viewer. The executor still resolves those clicks owner-only, so a control
// can only run the viewer's own program; when they have none, the page
// installs the suite into their things and re-runs the same click.

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
	const suiteKey = suiteKeyFromPageKey(page?.crystal?.pageKey);
	const isSeeded = typeof page?.id === 'string' && page.id.startsWith('webpage-demo-suite-') && !!suiteKey;
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

	// a seeded suite control the viewer has no program for: install the suite
	// (their own schemas/controls/actions/data/page), let the click re-run,
	// then take them to their own copy where every control is theirs
	const onUnowned = React.useCallback(
		async (action: string): Promise<boolean> => {
			const key = suiteKeyFromActionKey(action, BEHAVIOUR_SUITES) || suiteKey;
			const suite = key ? getBehaviourSuite(key) : null;
			if (!suite) return false;
			if (!user?.id) {
				lopu({ title: 'Sign in to run this suite 🗝️', description: 'Installing it makes the programs yours.', status: 'info' });
				navigate('/login');
				return false;
			}
			lopu({ title: `Installing the ${suite.emoji} ${suite.title} suite…`, description: 'Your own schemas, controls, actions, and sample data.', status: 'info', duration: 4000 });
			const installed = await installSuite((payload) => apiRef.current.v1.things.create(payload), suite, { seeded: true });
			lopu({
				title: `${suite.emoji} ${suite.title} installed ✨`,
				description: 'Running your click now, then opening your own copy of this page.',
				status: 'success',
				duration: 6000,
				link: { label: 'Open my page', href: `/p/${encodeURIComponent(installed.pageId)}` }
			});
			window.setTimeout(() => navigate(`/p/${encodeURIComponent(installed.pageId)}`), 1500);
			return true;
		},
		[lopu, navigate, suiteKey, user?.id]
	);

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

	return (
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
					interactive={isOwner || (isSeeded && !!suiteKey)}
					onTtActionUnowned={isSeeded ? onUnowned : undefined}
				/>
			</Box>
		</Flex>
	);
}
