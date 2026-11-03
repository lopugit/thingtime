import { Box, Flex, Text } from '@chakra-ui/react';
import React from 'react';
import { Link } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useTtTheme } from '~/hooks/useTtTheme';

import { ThemePreviewCard } from './ThemeStudio';
import { resolveTheme, THINGTIME_THEME } from '~/theme/tokens';
import type { TtTheme } from '~/theme/tokens';

// /themes/gallery — the public theme gallery (claude-todo/10 ✨): every public
// shared theme as a browsable grid. Sharing already worked (?apply=<shareId>
// deep links), but public themes were invisible without a link — this page
// makes Thingtime's most demoable feature discoverable. Works for guests too:
// applying a theme only writes local thingtime state.

type GalleryTheme = {
	id: string;
	name: string;
	theme: TtTheme;
	updatedAt: string;
};

const MONO = 'var(--tt-font-mono, ui-monospace, Menlo, monospace)';

const CardButton = ({ onClick, children, ...props }: any) => (
	<Box
		as="button"
		onClick={onClick}
		padding="6px 10px"
		borderRadius="var(--tt-radius-sm, 9px)"
		border="1px solid var(--tt-border, #ececef)"
		background="var(--tt-card, #fff)"
		color="var(--tt-text, #5a5a66)"
		fontSize="12px"
		fontWeight={600}
		cursor="pointer"
		transition="all 140ms ease"
		_hover={{ background: 'var(--tt-surface-alt, #f5f5f7)' }}
		{...props}
	>
		{children}
	</Box>
);

export const ThemeGallery = () => {
	const api = useApi();
	const lopu = useLopu();
	const { applyThemeDoc, appliedThemeShareId } = useTtTheme();

	const [themes, setThemes] = React.useState<GalleryTheme[] | null>(null);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await api.v1.themes.listShared();
				if (cancelled) return;
				if (res?.ok && Array.isArray(res.themes)) {
					// Resolve every listed theme against the default before it reaches a
					// preview card. Unlike "My themes" — one person's own saves — this
					// grid renders documents written by STRANGERS, straight into
					// themeToCssVars, which reads theme.colors.*, colors.rainbow[0..4]
					// and general.* unguarded. Stored docs are not guaranteed
					// current-shaped (themeToCssVars already carries a
					// `theme.windows || THINGTIME_THEME.windows` fallback for exactly
					// that reason), and there is no ErrorBoundary anywhere in the app,
					// so ONE stale or partially-migrated public doc would white-screen
					// /themes/gallery for every visitor. resolveTheme is the same
					// sanitizer saveTheme applies on write, so a well-formed theme
					// round-trips byte-identically; a malformed one falls back per
					// token instead of throwing — and any pre-sanitizer legacy value
					// gets re-gated before it becomes a CSS custom property.
					setThemes(res.themes.map((entry: any) => ({ ...entry, theme: resolveTheme(THINGTIME_THEME, entry?.theme) })));
				} else {
					setError(res?.error || 'The gallery could not be loaded');
				}
			} catch {
				if (!cancelled) setError('The gallery could not be loaded');
			}
		})();
		return () => {
			cancelled = true;
		};
		// api.v1.themes.listShared is a stable useCallback([]) — run once on mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const applyShared = React.useCallback(
		(entry: GalleryTheme) => {
			applyThemeDoc(entry.theme, { shareId: entry.id });
			lopu({
				title: `Theme "${entry.name}" applied 🎨`,
				description: 'Head to /themes to tweak it or go back to your own look.',
				status: 'success'
			});
		},
		[applyThemeDoc, lopu]
	);

	const copyLink = React.useCallback(
		async (entry: GalleryTheme) => {
			// same share-link shape ThemeStudio's "My themes" copy uses
			const url = `${window.location.origin}/themes?apply=${entry.id}`;
			try {
				await navigator.clipboard.writeText(url);
				lopu({ title: 'Share link copied 🔗', description: 'Anyone with the link can apply this theme.', status: 'success', duration: 6000 });
			} catch {
				lopu({ title: 'Could not copy the link', description: url, status: 'error' });
			}
		},
		[lopu]
	);

	return (
		<Flex direction="column" alignItems="center" width="100%" paddingX="20px" paddingBottom={40}>
			<Box width="100%" maxWidth="760px" paddingTop={24}>
				<Flex alignItems="baseline" justifyContent="space-between" gap="12px" flexWrap="wrap">
					<Text as="h1" fontSize="3xl" fontWeight={700} letterSpacing="-0.02em" color="var(--tt-ink, #16161a)">
						Theme gallery ✨
					</Text>
					<Text as={Link} to="/themes" fontSize="13px" fontWeight={600} fontFamily={MONO} color="var(--tt-muted, #9a9aa6)" _hover={{ color: 'var(--tt-ink, #16161a)' }}>
						← Theme Studio
					</Text>
				</Flex>
				<Text marginTop="6px" fontSize="md" color="var(--tt-text, #5a5a66)">
					Every public theme, newest first. Apply one to try Thingtime through someone else&rsquo;s eyes — your own
					look is one click away in the Studio.
				</Text>

				{error ? (
					<Text marginTop={10} fontSize="sm" color="var(--tt-danger, #d6455a)">
						{error}
					</Text>
				) : themes === null ? (
					<Text marginTop={10} fontSize="sm" color="var(--tt-muted, #9a9aa6)">
						Gathering the rainbows…
					</Text>
				) : themes.length === 0 ? (
					<Box marginTop={10}>
						<Text fontSize="sm" color="var(--tt-text, #5a5a66)">
							No public themes yet — yours could be the first 🌈
						</Text>
						<Text marginTop="4px" fontSize="sm" color="var(--tt-muted, #9a9aa6)">
							Save a theme in the <Link to="/themes" style={{ textDecoration: 'underline' }}>Theme Studio</Link> and tick
							&ldquo;shareable&rdquo; to publish it here.
						</Text>
					</Box>
				) : (
					<Flex gap="16px" flexWrap="wrap" marginTop={10}>
						{themes.map((entry) => {
							const active = appliedThemeShareId === entry.id;
							return (
								<Flex key={entry.id} direction="column" gap="8px" width={['100%', '168px']}>
									<ThemePreviewCard theme={entry.theme} active={active} />
									<Text fontSize="13px" fontWeight={active ? 700 : 600} color={active ? 'var(--tt-ink, #16161a)' : 'var(--tt-text, #5a5a66)'} noOfLines={1}>
										{entry.name}
										{active ? ' ✓' : ''}
									</Text>
									<Flex gap="6px">
										<CardButton onClick={() => applyShared(entry)}>Apply</CardButton>
										<CardButton onClick={() => copyLink(entry)}>Copy link 🔗</CardButton>
									</Flex>
								</Flex>
							);
						})}
					</Flex>
				)}
			</Box>
		</Flex>
	);
};
