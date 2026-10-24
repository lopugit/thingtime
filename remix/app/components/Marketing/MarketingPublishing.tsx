import { Box, Flex, Text } from '@chakra-ui/react';
import type { BoxProps } from '@chakra-ui/react';
import React from 'react';
import { Link as RouterLink } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { MK } from '~/components/Marketing/marketingTheme';
import { useMarketingPublications, useMarketingVisibility, usePreviewAsVisitor } from '~/components/Marketing/useMarketingPublications';
import { apiErrorMessage } from '~/hooks/apiFailure';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { changesFor, type PageSection, type PublicationState } from '~/marketing/publishing';

// Admin publishing controls that live INSIDE the marketing pages: the bar
// under the sub-nav (publish this surface, bulk-publish its children, preview
// as a visitor), the small 🌐/🔒 toggles on cards and menu rows, and the frame
// around each page section with its hide/show switch. Everything renders only
// for admins; visitors never load a control. The state itself is the shared
// store in useMarketingPublications.tsx.

export type AdminSurface = {
	/** Publication key of the surface being viewed (hub, social, category:…, page:…). */
	key: string;
	label: string;
	/** Optional bulk action over the surface's children (a category's pages, the suite's feature sets). */
	bulk?: { noun: string; keys: string[] };
};

const MANAGE_PATH = '/admin/marketing';

const surfaceTitle = (label: string) => (label.length > 64 ? `${label.slice(0, 61)}…` : label);

/** Toast-wrapped publish/unpublish shared by every control. */
export const usePublishActions = () => {
	const lopu = useLopu();
	const { apply, pending } = useMarketingPublications();
	const [busy, setBusy] = React.useState(false);

	const setState = React.useCallback(
		async (keys: string[], state: PublicationState | null, label: string) => {
			if (!keys.length) return false;
			setBusy(true);
			try {
				await apply(changesFor(keys, state));
				const verb = state === 'published' ? 'Published' : state === 'hidden' ? 'Hidden' : keys.some((key) => key.startsWith('section:')) ? 'Showing' : 'Unpublished';
				lopu({ title: `${verb} ${surfaceTitle(label)}`, description: state === 'published' ? 'Visitors can see it now. 🌐' : undefined, status: 'success', duration: 3500 });
				return true;
			} catch (error) {
				lopu({ title: 'Publishing did not save', description: apiErrorMessage(error, 'Thingtime could not update the marketing publish state.'), status: 'error' });
				return false;
			} finally {
				setBusy(false);
			}
		},
		[apply, lopu]
	);

	return { setState, busy: busy || pending > 0 };
};

const AdminButton = ({
	primary = false,
	children,
	...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; children: React.ReactNode }) => (
	<Box
		as="button"
		type="button"
		display="inline-flex"
		alignItems="center"
		gap={1.5}
		minHeight="32px"
		px={3}
		border={MK.border}
		borderRadius={MK.radiusSm}
		background={primary ? MK.ink : MK.cardSolid}
		color={primary ? MK.bg : MK.ink}
		fontFamily={MK.font}
		fontWeight={700}
		fontSize="12px"
		lineHeight={1.2}
		cursor="pointer"
		whiteSpace="nowrap"
		_hover={{ filter: 'brightness(.96)' }}
		_disabled={{ opacity: 0.55, cursor: 'progress' }}
		_focusVisible={{ outline: `3px solid ${MK.accent2}`, outlineOffset: '2px' }}
		{...rest}
	>
		{children}
	</Box>
);

export const PublishStatePill = ({ published, compact = false }: { published: boolean; compact?: boolean }) => (
	<Text
		as="span"
		display="inline-flex"
		alignItems="center"
		gap={1}
		px={compact ? 1.5 : 2.5}
		py={compact ? 0.5 : 1}
		fontFamily={MK.mono}
		fontSize={compact ? '10px' : '11px'}
		fontWeight={700}
		letterSpacing="0.08em"
		textTransform="uppercase"
		borderRadius={MK.radiusSm}
		border={MK.border}
		background={published ? 'var(--tt-positive-soft, rgba(88, 202, 112, 0.18))' : MK.tint}
		color={MK.ink}
		whiteSpace="nowrap"
		data-published={published ? 'true' : 'false'}
	>
		<span aria-hidden="true">{published ? '🌐' : '🔒'}</span> {published ? 'Published' : compact ? 'Unpublished' : 'Not published'}
	</Text>
);

/**
 * The admin bar under the marketing sub-nav. Shows the current surface's
 * state with a publish switch, the optional bulk action over its children,
 * the visitor preview toggle and a link to the full panel. In preview mode it
 * collapses to a single "exit preview" strip so the admin sees the visitor's
 * page underneath.
 */
export const MarketingAdminBar = ({ surface }: { surface?: AdminSurface }) => {
	const user = useCurrentUser();
	const visibility = useMarketingVisibility();
	const { publications, status } = useMarketingPublications();
	const [preview, setPreview] = usePreviewAsVisitor();
	const { setState, busy } = usePublishActions();

	if (!user?.isAdmin) return null;

	const published = surface ? visibility.isPublished(surface.key) : false;
	const bulk = surface?.bulk;
	const bulkPublished = bulk ? bulk.keys.filter((key) => visibility.isPublished(key)).length : 0;
	const bulkRemaining = bulk ? bulk.keys.length - bulkPublished : 0;

	if (preview) {
		return (
			<Flex
				role="region"
				aria-label="Admin preview"
				alignItems="center"
				justifyContent="space-between"
				gap={3}
				flexWrap="wrap"
				marginTop={4}
				px={3}
				py={2}
				border={`1px dashed ${MK.ink}`}
				borderRadius={MK.radiusSm}
				background={MK.card}
				data-testid="marketing-admin-bar"
				data-mode="preview"
			>
				<Text fontSize="13px" fontWeight={700} color={MK.ink} margin={0}>
					<span aria-hidden="true">👁️</span> Previewing as a visitor — unpublished pages, categories, image sets and hidden sections are gone.
				</Text>
				<AdminButton onClick={() => setPreview(false)}>Exit preview</AdminButton>
			</Flex>
		);
	}

	return (
		<Box
			role="region"
			aria-label="Admin publishing"
			marginTop={4}
			px={3}
			py={2.5}
			border={MK.border}
			borderRadius={MK.radius}
			background={MK.cardSolid}
			boxShadow={MK.shadow}
			data-testid="marketing-admin-bar"
			data-mode="admin"
			data-published={surface ? (published ? 'true' : 'false') : undefined}
		>
			<Flex alignItems="center" gap={3} flexWrap="wrap">
				<Flex alignItems="center" gap={2} flex="1 1 240px" minWidth={0}>
					<Text as="span" fontFamily={MK.mono} fontSize="10px" fontWeight={700} letterSpacing="0.14em" textTransform="uppercase" color={MK.muted} flex="none">
						🛠️ Admin
					</Text>
					{surface ? (
						<>
							<PublishStatePill published={published} />
							<Text as="span" fontSize="13px" fontWeight={700} color={MK.ink} noOfLines={1} minWidth={0} title={surface.label}>
								{surfaceTitle(surface.label)}
							</Text>
						</>
					) : (
						<Text as="span" fontSize="13px" color={MK.text}>
							Marketing is admin-only until you publish it, one piece at a time.
						</Text>
					)}
				</Flex>
				<Flex alignItems="center" gap={2} flexWrap="wrap">
					{surface ? (
						<AdminButton
							primary={!published}
							disabled={busy || status === 'cold'}
							onClick={() => void setState([surface.key], published ? null : 'published', surface.label)}
							data-testid="marketing-publish-toggle"
						>
							{published ? '🔒 Unpublish' : '🌐 Publish'}
						</AdminButton>
					) : null}
					{bulk && bulk.keys.length ? (
						bulkRemaining > 0 ? (
							<AdminButton
								disabled={busy}
								onClick={() => void setState(bulk.keys.filter((key) => !visibility.isPublished(key)), 'published', `${bulkRemaining} ${bulk.noun}`)}
								data-testid="marketing-publish-all"
								title={`${bulkPublished} of ${bulk.keys.length} ${bulk.noun} published`}
							>
								🌐 Publish all {bulkRemaining} {bulk.noun}
							</AdminButton>
						) : (
							<AdminButton
								disabled={busy}
								onClick={() => void setState(bulk.keys, null, `${bulk.keys.length} ${bulk.noun}`)}
								data-testid="marketing-unpublish-all"
							>
								🔒 Unpublish all {bulk.keys.length} {bulk.noun}
							</AdminButton>
						)
					) : null}
					<AdminButton onClick={() => setPreview(true)} data-testid="marketing-preview-toggle" title="See exactly what a visitor sees">
						👁️ View as visitor
					</AdminButton>
					<Box
						as={RouterLink}
						to={MANAGE_PATH}
						fontSize="12px"
						fontWeight={800}
						color={MK.accent}
						whiteSpace="nowrap"
						_hover={{ textDecoration: 'underline' }}
						data-testid="marketing-manage-link"
					>
						Manage all →
					</Box>
				</Flex>
			</Flex>
			{bulk && bulk.keys.length ? (
				<Text fontFamily={MK.mono} fontSize="11px" color={MK.muted} marginTop={1.5} data-testid="marketing-bulk-count">
					{bulkPublished} of {bulk.keys.length} {bulk.noun} published{publications?.updatedAt ? ` · last change ${new Date(publications.updatedAt).toLocaleString()}` : ''}
				</Text>
			) : null}
		</Box>
	);
};

/**
 * Compact 🌐/🔒 switch for one publishable key, used on category cards, hub
 * chips and the social menu rows. Stops the event so a toggle inside a linked
 * card never navigates.
 */
export const PublishToggle = ({
	publicationKey,
	label,
	iconOnly = false,
	...rest
}: { publicationKey: string; label: string; iconOnly?: boolean } & BoxProps) => {
	const visibility = useMarketingVisibility();
	const { setState, busy } = usePublishActions();
	if (!visibility.everything) return null;
	const published = visibility.isPublished(publicationKey);
	return (
		<Box
			as="button"
			type="button"
			aria-label={`${published ? 'Unpublish' : 'Publish'} ${label}`}
			aria-pressed={published}
			title={`${published ? 'Published — click to unpublish' : 'Not published — click to publish'}: ${label}`}
			disabled={busy}
			onClick={(event: React.MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				void setState([publicationKey], published ? null : 'published', label);
			}}
			display="inline-flex"
			alignItems="center"
			justifyContent="center"
			gap={1}
			minWidth="28px"
			height="28px"
			px={iconOnly ? 0 : 2}
			fontFamily={MK.mono}
			fontSize="11px"
			fontWeight={700}
			lineHeight={1}
			border={MK.border}
			borderRadius={MK.radiusSm}
			background={published ? 'var(--tt-positive-soft, rgba(88, 202, 112, 0.18))' : MK.cardSolid}
			color={MK.ink}
			cursor="pointer"
			_hover={{ filter: 'brightness(.95)' }}
			_disabled={{ opacity: 0.55, cursor: 'progress' }}
			_focusVisible={{ outline: `3px solid ${MK.accent2}`, outlineOffset: '1px' }}
			data-testid="marketing-publish-chip"
			data-published={published ? 'true' : 'false'}
			{...rest}
		>
			<span aria-hidden="true">{published ? '🌐' : '🔒'}</span>
			{iconOnly ? null : <span>{published ? 'Published' : 'Publish'}</span>}
		</Box>
	);
};

/**
 * Frames one page section for admins: a label + hide/show switch in the top
 * right corner; hidden sections stay visible to the admin but dimmed and
 * dashed, so they can be restored.
 */
export const SectionAdminFrame = ({ section, hidden, children }: { section: PageSection; hidden: boolean; children: React.ReactNode }) => {
	const { setState, busy } = usePublishActions();
	return (
		<Box position="relative" data-testid="marketing-section-frame" data-section-id={section.id} data-hidden={hidden ? 'true' : 'false'}>
			<Flex
				position="absolute"
				top="10px"
				right="0"
				zIndex={3}
				alignItems="center"
				gap={1.5}
				px={1.5}
				py={1}
				border={MK.border}
				borderRadius={MK.radiusSm}
				background={MK.cardSolid}
				boxShadow={MK.shadow}
				maxWidth="calc(100% - 8px)"
			>
				<Text as="span" fontFamily={MK.mono} fontSize="10px" fontWeight={700} letterSpacing="0.1em" textTransform="uppercase" color={MK.muted} noOfLines={1}>
					{section.label}
					{hidden ? ' · hidden' : ''}
				</Text>
				<AdminButton
					disabled={busy}
					onClick={() => void setState([section.key], hidden ? null : 'hidden', `${section.label} section`)}
					aria-pressed={hidden}
					data-testid="marketing-section-toggle"
					style={{ minHeight: 26, paddingLeft: 8, paddingRight: 8 }}
				>
					{hidden ? '👁️ Show' : '🙈 Hide'}
				</AdminButton>
			</Flex>
			<Box opacity={hidden ? 0.45 : 1} outline={hidden ? `2px dashed ${MK.muted}` : undefined} outlineOffset="-2px" borderRadius={hidden ? MK.radiusSm : undefined} transition="opacity 140ms ease">
				{children}
			</Box>
		</Box>
	);
};
