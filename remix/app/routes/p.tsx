import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Link, useParams } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { isSafeCssText } from '../components/Kinds/safeUrl';
import { PageShell } from '../components/Layout/PageShell';
import { WebpageBlocksRenderer } from '../components/Builder/WebpageBlocksRenderer';
import { useWebpageDraft } from '../components/Builder/useWebpage';
import type { WebpageBlock } from '../components/Builder/webpageBlocks';

// /p/:id — a published block-based webpage, rendered exactly as the builder
// composed it. ttAction interactivity follows the PreviewModal trust rule:
// live for the page owner viewing their own page, inert for everyone else.

export default function PublicWebpage() {
	const { id } = useParams();
	const user = useCurrentUser();
	const draft = useWebpageDraft(React.useMemo(() => (id ? { kind: 'id' as const, id } : null), [id]));
	const page = draft.resolved?.page || null;
	const isOwner = !!user?.id && page?.author?.id === user.id;
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
					interactive={isOwner}
				/>
			</Box>
		</Flex>
	);
}
