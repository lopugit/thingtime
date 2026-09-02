import React from 'react';
import { Badge, Box, Button, Center, Flex, Heading, Spinner, Stack, Switch, Text } from '@chakra-ui/react';
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { PostCard } from '~/components/Feed/PostCard';
import { mergeReactionOverlay } from '~/components/Feed/reactionOverlay';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';
import { useViewTracking } from '~/components/Feed/useViewTracking';
import { useLopu } from '~/components/Lopu/useLopu';
import { RenderThing } from '~/components/Kinds';
import { ThingView } from '~/components/Thingtime/ThingView';
import {
	SensitiveThingReveal,
	type SensitiveThingRevealDescriptor
} from '~/components/Things/SensitiveThingReveal';
import { apiErrorMessage } from '~/hooks/apiFailure';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';
import { ThingAttachmentDetail } from '~/components/Things/ThingAttachmentDetail';
import { attachmentFromThing, directAttachmentReferences } from '~/components/Things/thingAttachmentDetailCore';
import { thingDetailSections } from '~/components/Things/thingDetailSectionsCore';

const DIAGNOSTIC_ID_PATTERN = /^migration-diagnostic-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTED = 'var(--tt-muted, #9a9aa6)';

type MigrationDiagnostic = {
	id: string;
	migrationId: string;
	status: number;
	outcome: 'rejected' | 'unknown';
	summary: string;
	capturedAt: string;
	expiresAt: string;
	detail: string;
	redactions: number;
	truncated: boolean;
	revealables: SensitiveThingRevealDescriptor[];
};

type ThingViewData =
	| { kind: 'diagnostic'; diagnostic: MigrationDiagnostic }
	| { kind: 'thing'; thing: Record<string, any>; post: PublicPost | null; parent: PublicPost | null };

type ThingLoadState = {
	key: string;
	loading: boolean;
	data: ThingViewData | null;
	error: string | null;
};

const diagnosticFromResponse = (response: any): MigrationDiagnostic => {
	const diagnostic = response?.diagnostic;
	const rawRevealables = diagnostic?.revealables == null ? [] : diagnostic.revealables;
	if (
		!diagnostic ||
		typeof diagnostic !== 'object' ||
		typeof diagnostic.id !== 'string' ||
		typeof diagnostic.detail !== 'string' ||
		!Array.isArray(rawRevealables) ||
		rawRevealables.length > 32
	) {
		throw new Error('The diagnostic response was incomplete.');
	}
	const references = new Set<string>();
	const revealables = rawRevealables.map((value: unknown) => {
		if (!value || typeof value !== 'object') throw new Error('The diagnostic response was incomplete.');
		const descriptor = value as Record<string, unknown>;
		const reference = typeof descriptor.reference === 'string' ? descriptor.reference : '';
		const referenceMatch = reference.match(/^mongodb-object-id-([1-9]|[12][0-9]|3[0-2])$/);
		const index = referenceMatch ? Number(referenceMatch[1]) : 0;
		if (
			!referenceMatch ||
			descriptor.kind !== 'mongodb-object-id' ||
			descriptor.label !== `MongoDB ObjectId #${index}` ||
			descriptor.placeholder !== `[redacted MongoDB ObjectId #${index}]` ||
			references.has(reference)
		) {
			throw new Error('The diagnostic response was incomplete.');
		}
		references.add(reference);
		return {
			reference,
			kind: descriptor.kind,
			label: descriptor.label,
			placeholder: descriptor.placeholder
		} as SensitiveThingRevealDescriptor;
	});
	return { ...diagnostic, revealables } as MigrationDiagnostic;
};

const thingFromResponse = (response: any): Record<string, any> => {
	const thing = response?.thing;
	if (!thing || typeof thing !== 'object' || typeof thing.id !== 'string') {
		throw new Error('The Thing response was incomplete.');
	}
	return thing as Record<string, any>;
};

const readableDate = (value: string) => {
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
};

// /thing/:id — canonical authenticated permalink for any persisted Thing.
// Migration diagnostics use their stricter home-plane/current-admin reader;
// every other id rides the normal ACL-aware Things API.
export default function ThingPage() {
	const { id = '' } = useParams();
	const navigate = useNavigate();
	const { v1 } = useApi();
	const currentUser = useCurrentUser();
	const lopu = useLopu();
	const loadDiagnostic = v1.admin.migrationDiagnostic;
	const loadThing = v1.things.get;
	const { observeView } = useViewTracking();
	const diagnosticRoute = DIAGNOSTIC_ID_PATTERN.test(id);
	const requestKey = `${id}\u0000${currentUser?.id || 'anonymous'}\u0000${currentUser?.isAdmin ? 'admin' : 'user'}`;
	const [loadState, setLoadState] = React.useState<ThingLoadState>({
		key: '',
		loading: true,
		data: null,
		error: null
	});
	// Both representations are useful on a permalink: the preview is the
	// human-facing surface, while the full JSON remains available for people
	// inspecting a Thing's exact shape. They are independent so either one (or
	// both) can stay visible without another route or mode switch.
	const [showPreview, setShowPreview] = React.useState(true);
	const [showData, setShowData] = React.useState(true);

	// Hide prior-account data synchronously during the render that observes an
	// identity change; the effect below then aborts the old request and refetches.
	const visibleState: ThingLoadState = loadState.key === requestKey ? loadState : { key: requestKey, loading: true, data: null, error: null };

	React.useLayoutEffect(() => {
		window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
	}, [requestKey, visibleState.loading]);

	React.useEffect(() => {
		const controller = new AbortController();
		setLoadState({ key: requestKey, loading: true, data: null, error: null });

		if (diagnosticRoute && !currentUser?.isAdmin) {
			setLoadState({
				key: requestKey,
				loading: false,
				data: null,
				error: 'This private diagnostic is available only to the admin account that created it.'
			});
			return () => controller.abort();
		}

		const startedAt = Date.now();
		const request = diagnosticRoute
			? loadDiagnostic({ id }, { signal: controller.signal }).then((response: any) => ({
					kind: 'diagnostic' as const,
					diagnostic: diagnosticFromResponse(response)
			  }))
			: loadThing({ id }, { signal: controller.signal }).then((response: any) => ({
					kind: 'thing' as const,
					thing: thingFromResponse(response),
					post: response?.post ? mergeReactionOverlay(startedAt, response.post as PublicPost) : null,
					parent: response?.parent ? mergeReactionOverlay(startedAt, response.parent as PublicPost) : null
			  }));

		request
			.then((next) => {
				if (!controller.signal.aborted) {
					setLoadState({ key: requestKey, loading: false, data: next, error: null });
				}
			})
			.catch((cause) => {
				if (controller.signal.aborted || (cause instanceof Error && cause.name === 'AbortError')) return;
				setLoadState({
					key: requestKey,
					loading: false,
					data: null,
					error: apiErrorMessage(cause, 'This Thing is missing, private, or no longer available.')
				});
			});

		return () => controller.abort();
	}, [currentUser?.isAdmin, diagnosticRoute, id, loadDiagnostic, loadThing, requestKey]);

	const diagnostic = visibleState.data?.kind === 'diagnostic' ? visibleState.data.diagnostic : null;
	const thing = visibleState.data?.kind === 'thing' ? visibleState.data.thing : null;
	const attachment = attachmentFromThing(thing);
	// The API's attachment post projection exists for the interaction-focused
	// `/media/:id` route. It is the attachment coerced into a post-shaped
	// projection, not the attachment's parent post, so it must never become a
	// blank "Post view" on this generic Thing permalink.
	const post = visibleState.data?.kind === 'thing' && !attachment ? visibleState.data.post : null;
	const references = attachment && visibleState.data?.kind === 'thing' ? directAttachmentReferences(visibleState.data.parent) : [];
	const { error, loading } = visibleState;
	const genericDetail = thing
		? JSON.stringify(
				{
					id: thing.id,
					thingtime: thing.thingtime,
					visibility: thing.visibility,
					acl: thing.acl,
					targetId: thing.targetId,
					crystal: thing.crystal,
					extended: thing.extended,
					tags: thing.tags,
					createdAt: thing.createdAt,
					updatedAt: thing.updatedAt
				},
				null,
				2
		  )
		: '';
	const detail = diagnostic?.detail || genericDetail;
	const sections = thingDetailSections({ hasThing: !!thing, showPreview, showData });
	const isThingOwner = !!thing && !!currentUser?.id && thing.author?.id === currentUser.id;
	const thingPreview = thing ? (
		thing.thingtime?.includes('component') ? (
			<RenderThing
				context={{ size: 'full', untrusted: !isThingOwner }}
				fallback={<ThingView thing={thing.crystal} />}
				thing={thing}
			/>
		) : (
			<ThingView thing={thing.crystal} />
		)
	) : null;

	const copyDetail = async () => {
		try {
			await navigator.clipboard.writeText(detail);
			lopu({ title: diagnostic ? 'Error copied' : 'Thing copied', status: 'success' });
		} catch {
			lopu({ title: 'Could not copy this Thing', description: 'Select the text and copy it manually.', status: 'error' });
		}
	};

	const handlePostChanged = React.useCallback(
		(id: string, change: PostChange) => {
			setLoadState((current) => {
				if (current.key !== requestKey || current.data?.kind !== 'thing' || !current.data.post) return current;
				if (current.data.post.id !== id) return current;
				const next = typeof change === 'function' ? change(current.data.post) : change;
				if (!next) {
					navigate('/feed');
					return current;
				}
				return { ...current, data: { ...current.data, post: next } };
			});
		},
		[navigate, requestKey]
	);

	return (
		<Flex
			justify="center"
			width="100%"
			minHeight="100vh"
			background="var(--tt-surface, #fafafb)"
			paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
			paddingBottom={16}
		>
			<Stack spacing={5} width="100%" maxW="920px" px={{ base: 4, md: 6 }} pt={{ base: 4, md: 7 }} minW={0}>
				<Flex align="center" justify="space-between" gap={3} wrap="wrap">
					<Box>
						<Text color={MUTED} fontFamily="mono" fontSize="10px" fontWeight="700" letterSpacing="0.12em" textTransform="uppercase">
							Thingtime · {diagnosticRoute ? 'Private admin diagnostic' : 'Thing'}
						</Text>
						<Heading as="h1" mt={1} fontSize={{ base: '2xl', md: '3xl' }}>
							{diagnostic ? `Migration error · ${diagnostic.migrationId}` : diagnosticRoute ? 'Migration error' : 'Thing'}
						</Heading>
					</Box>
					<Button
						as={Link}
						to={diagnosticRoute ? '/migrations' : '/feed'}
						size="sm"
						variant="outline"
						leftIcon={<ArrowLeft size={15} />}
						borderRadius="999px"
					>
						{diagnosticRoute ? 'Back to migrations' : 'Back to feed'}
					</Button>
				</Flex>

				{loading ? (
					<Center py={16}>
						<Spinner color={MUTED} />
					</Center>
				) : null}

				{!loading && error ? (
					<Box {...CARD_STYLES} p={{ base: 5, md: 6 }}>
						<Heading as="h2" fontSize="lg">
							This Thing cannot be opened
						</Heading>
						<Text mt={2} color={MUTED} fontSize="sm">
							{error}
						</Text>
					</Box>
				) : null}

				{!loading && (diagnostic || thing) ? (
					<>
						<Box {...CARD_STYLES} p={{ base: 5, md: 6 }}>
							<Flex align="flex-start" justify="space-between" gap={4} wrap="wrap">
								<Box minW={0}>
									<Flex gap={2} wrap="wrap" mb={3}>
										{diagnostic ? <Badge colorScheme="purple">admin only</Badge> : null}
										{diagnostic ? <Badge colorScheme="orange">HTTP {diagnostic.status}</Badge> : null}
										{diagnostic ? <Badge>{diagnostic.outcome}</Badge> : null}
										{thing?.visibility ? <Badge>{thing.visibility}</Badge> : null}
									</Flex>
									<Text fontWeight="700" overflowWrap="anywhere">
										{diagnostic?.summary || thing?.id}
									</Text>
									<Text mt={2} color={MUTED} fontFamily="mono" fontSize="xs" overflowWrap="anywhere">
										{diagnostic?.id || thing?.id}
									</Text>
									{diagnostic ? (
										<Stack spacing={1} mt={3} color={MUTED} fontSize="xs">
											<Text>Captured {readableDate(diagnostic.capturedAt)}</Text>
											<Text>Expires {readableDate(diagnostic.expiresAt)}</Text>
											<Text>
												{diagnostic.redactions} sensitive pattern{diagnostic.redactions === 1 ? '' : 's'} redacted
												{diagnostic.truncated ? ' · output truncated to its safety limit' : ''}
											</Text>
										</Stack>
									) : null}
								</Box>
								<Button size="sm" leftIcon={<Copy size={15} />} onClick={copyDetail} isDisabled={!detail}>
									Copy {diagnostic ? 'error' : 'Thing'}
								</Button>
							</Flex>
						</Box>

						{sections.viewToggles ? (
							<Flex
								{...CARD_STYLES}
								align={{ base: 'flex-start', sm: 'center' }}
								gap={4}
								justify="space-between"
								p={{ base: 4, md: 5 }}
								wrap="wrap"
							>
								<Box>
									<Heading as="h2" fontSize="md">
										Views
									</Heading>
									<Text color={MUTED} fontSize="sm" mt={1}>
										Choose the human-friendly preview, the raw Thing data, or both.
									</Text>
								</Box>
								<Flex align="center" gap={4} role="group" aria-label="Thing page views" wrap="wrap">
									<Flex align="center" gap={2}>
										<Switch aria-label="Show rendered preview" isChecked={showPreview} onChange={(event) => setShowPreview(event.target.checked)} />
										<Text fontSize="sm">Rendered preview</Text>
									</Flex>
									<Flex align="center" gap={2}>
										<Switch aria-label="Show Thing data" isChecked={showData} onChange={(event) => setShowData(event.target.checked)} />
										<Text fontSize="sm">Thing data</Text>
									</Flex>
								</Flex>
							</Flex>
						) : null}

						{sections.preview && attachment ? <ThingAttachmentDetail attachment={attachment} references={references} /> : null}

						{sections.preview && post ? (
							<Stack spacing={3} minW={0}>
								<Flex align="center" justify="space-between" gap={3} wrap="wrap" px={1}>
									<Heading as="h2" fontSize="md">
										Rendered preview
									</Heading>
									<Button
										as={Link}
										to={`/post/${encodeURIComponent(post.id)}`}
										size="xs"
										variant="ghost"
										rightIcon={<ExternalLink size={13} />}
									>
										Open post page
									</Button>
								</Flex>
								<Box ref={(element: HTMLDivElement | null) => observeView(element, post.id)}>
									<PostCard post={post} onChanged={handlePostChanged} />
								</Box>
							</Stack>
						) : null}

						{sections.preview && thing && !post ? (
							<Box {...CARD_STYLES} p={{ base: 4, md: 6 }} minW={0}>
								<Heading as="h2" fontSize="md" mb={3}>
									Rendered preview
								</Heading>
								<Box minW={0}>{thingPreview}</Box>
							</Box>
						) : null}

						{/* `thingDetailSectionsCore` owns why a diagnostic ignores the
						    `Thing data` switch: it renders no Views card, so a remembered
						    `false` would hide the redacted error with no control left to
						    bring it back. */}
						{sections.detail ? (
							<Box {...CARD_STYLES} p={{ base: 4, md: 6 }} minW={0}>
								<Flex align="center" justify="space-between" gap={3} mb={3}>
									<Heading as="h2" fontSize="md">
										{diagnostic ? 'Full redacted error' : 'Thing data'}
									</Heading>
								</Flex>
								<Box
									as="pre"
									m={0}
									p={{ base: 3, md: 4 }}
									borderRadius="var(--tt-radius-lg, 14px)"
									bg="var(--tt-surface-alt, #f5f5f7)"
									color="var(--tt-ink, #16161a)"
									fontFamily="mono"
									fontSize={{ base: '11px', md: '12px' }}
									lineHeight="1.65"
									overflowX="auto"
									overflowWrap="anywhere"
									whiteSpace="pre-wrap"
								>
									{detail}
								</Box>
							</Box>
						) : null}

						{diagnostic?.revealables.length ? (
							<SensitiveThingReveal
								key={requestKey}
								thingId={diagnostic.id}
								identityKey={currentUser?.id || 'anonymous'}
								revealables={diagnostic.revealables}
							/>
						) : null}
					</>
				) : null}
			</Stack>
		</Flex>
	);
}
