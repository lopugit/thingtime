import React from 'react';
import { Badge, Box, Button, Center, Flex, Heading, Spinner, Stack, Switch, Text } from '@chakra-ui/react';
import { ArrowLeft, Copy, ExternalLink } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { ActionChip } from '~/components/Actions/ActionChip';
import { useActionRunConfirm } from '~/components/Actions/ActionRunConfirm';
import { ACTION_LIMIT_LABELS, actionEffectsOf, actionLimitsOf, displayRef, runInputDescriptorsOf, type ActionCrystal } from '~/components/Actions/actionInspect';
import { LiveTemplate, useComponentArgValues, useThingSource, type ThingSourceBinding } from '~/components/Builder/liveComponent';
import { useWebpageDraft } from '~/components/Builder/useWebpage';
import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { WebpageRuntimeProvider } from '~/components/Builder/webpageRuntime';
import { PostCard } from '~/components/Feed/PostCard';
import { mergeReactionOverlay } from '~/components/Feed/reactionOverlay';
import type { PostChange, PublicPost } from '~/components/Feed/feedTypes';
import { useViewTracking } from '~/components/Feed/useViewTracking';
import { useLopu } from '~/components/Lopu/useLopu';
import { ThingView } from '~/components/Thingtime/ThingView';
import {
	SensitiveThingReveal,
	type SensitiveThingRevealDescriptor
} from '~/components/Things/SensitiveThingReveal';
import { isSourceActionKey } from '~/components/ComponentsLibrary/componentBrowseTypes';
import { SchemaTemplateRender } from '~/components/Things/ThingsViews';
import { schemaIdOf, schemaRenderOf, thingDisplayName, thingLink, thingsCacheKey } from '~/components/Things/thingsCore';
import type { ThingsCache, ThingsReferrer } from '~/components/Things/thingsCore';
import { apiErrorMessage } from '~/hooks/apiFailure';
import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import type * as InstallSuite from '~/components/Builder/installSuite';
import type { BehaviourSuite } from '~/schemas/behaviourSuites';
import { CARD_STYLES } from '~/theme/card';
import { ThingAttachmentDetail } from '~/components/Things/ThingAttachmentDetail';
import { attachmentFromThing, directAttachmentReferences } from '~/components/Things/thingAttachmentDetailCore';

const DIAGNOSTIC_ID_PATTERN = /^migration-diagnostic-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MUTED = 'var(--tt-muted, #9a9aa6)';
const MONO = 'var(--tt-font-mono, ui-monospace, monospace)';

// Where the back link goes: the surface that sent the viewer here
// (?from=things|actions|feed — thingsCore.thingOpenHref stamps it), the feed
// when nothing did.
const REFERRERS: Record<ThingsReferrer, { to: string; label: string }> = {
	things: { to: '/things', label: 'Back to things' },
	actions: { to: '/actions', label: 'Back to actions' },
	feed: { to: '/feed', label: 'Back to feed' }
};

// The trust ladder for the live surfaces below (component + webpage):
// - the viewer's OWN thing → live, no confirm (they composed it);
// - a SEEDED platform thing → live for a signed-in viewer behind the confirm
//   gate, run-or-install on an unowned action. System-owned is a NULL author
//   (ownerId 'system' is never a real user, so the things projection resolves
//   no profile) AND a reserved id prefix, the same two-part test
//   componentBrowseTypes.componentTrustFor uses. The prefix alone is not
//   enough: the executor mints `action-run-<uuid>` run records under the
//   reserved `action-` prefix owned by the viewer who ran them, so the author
//   check is what keeps a user's thing from ever reading as platform-curated.
//   A part that looks like a suite part (`component-demo-<suite>-…`,
//   `action-app-<suite>-…`) must also resolve through the suite catalog, a
//   keyed page through its crystal (installSuite.suiteKeyOfPage);
// - anyone else's thing → inert, with a visible label saying why.
// Nothing in the thing's markup can widen this: the decision reads only the
// id, the author and the catalog.
const RESERVED_ID = /^(component|webpage|schema|action)-/;
const SUITE_PART_ID = /^(component|webpage|schema|action)-(demo|app)-/;

// `?source=<actionKey>` binds a component to a data source for this view.
// The key is validated with the SAME `isSourceActionKey` the /components/:key
// binding uses, which reads the registry's canonical ACTION_KEY_PATTERN /
// MAX_ACTION_KEY_CHARS — a second, looser pattern here would confirm and then
// run keys the executor always rejects.
const MAX_CACHED_THING_CHARS = 256 * 1024;

// One cache entry per viewed thing, so this namespace is bounded and stamped.
// Past the cap the oldest entries go: otherwise a long browsing session fills
// localStorage and every OTHER tt-* optimistic cache starts losing its write
// silently, because writeLocalCache swallows the quota error by design.
const THING_CACHE_PREFIX = 'tt-thing-';
const MAX_CACHED_THINGS = 40;

const pruneThingCache = (keep: string): void => {
	if (typeof window === 'undefined') return;
	try {
		const cached: { key: string; at: number }[] = [];
		for (let index = 0; index < window.localStorage.length; index += 1) {
			const key = window.localStorage.key(index);
			if (!key || !key.startsWith(THING_CACHE_PREFIX) || key === keep) continue;
			const at = Number(readLocalCache<{ at?: unknown }>(key)?.at);
			cached.push({ key, at: Number.isFinite(at) ? at : 0 });
		}
		cached.sort((a, b) => a.at - b.at);
		for (const entry of cached.slice(0, Math.max(0, cached.length - (MAX_CACHED_THINGS - 1)))) clearLocalCache(entry.key);
	} catch {
		// storage disabled — nothing to prune
	}
};

// The suite catalog + installer are the whole demo/app library (behaviourSuites
// pulls the 300-page demo catalog with it). This route ships in the eager
// bundle (routes.tsx: permalinks), so both load on demand — and ONLY through
// the registry module: importing it registers the app suites, so the lookups
// see Pokeworld/StarsAlign parts, never just the demo suites. Until it lands a
// reserved-prefix thing renders inert (fail closed), then flips live.
type LiveKit = { suites: BehaviourSuite[]; install: typeof InstallSuite };
const loadLiveKit = (): Promise<LiveKit> =>
	Promise.all([import('~/schemas/appSuites/index'), import('~/components/Builder/installSuite')]).then(([registry, install]) => ({
		suites: registry.ALL_SUITES,
		install
	}));

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

const kindsOf = (thing: Record<string, any> | null): string[] => (Array.isArray(thing?.thingtime) ? thing!.thingtime.filter((kind: unknown) => typeof kind === 'string') : []);

// A component thing, live: the ONE live-component path (liveComponent.tsx) —
// useThingSource binds the optional data source, LiveTemplate resolves and,
// only when `interactive`, arms the ttAction click wrapper. Every trust input
// (interactive / confirm / onUnowned) is decided by the page, never here.
const ComponentLive = ({
	thing,
	source,
	interactive,
	confirm,
	onUnowned
}: {
	thing: Record<string, any>;
	source: ThingSourceBinding | null;
	interactive: boolean;
	confirm: React.ComponentProps<typeof LiveTemplate>['confirm'];
	onUnowned: React.ComponentProps<typeof LiveTemplate>['onUnowned'];
}) => {
	const crystal = (thing.crystal || {}) as Record<string, unknown>;
	const { argValues } = useComponentArgValues(crystal, null);
	const { scope } = useThingSource({ source, cacheId: thing.id, argValues, interactive });
	const templateScope = React.useMemo(() => ({ ...argValues, ...scope }), [argValues, scope]);
	if (!crystal.render) return <ThingView thing={crystal} />;
	return (
		<Box data-testid="thing-component-live" minW={0}>
			<LiveTemplate render={crystal.render} scope={templateScope} interactive={interactive} confirm={confirm} onUnowned={onUnowned} />
			{source && scope.state === 'not-installed' ? (
				<Text color={MUTED} fontSize="xs" mt={2}>
					No action you own matches <Box as="code" fontFamily={MONO}>{source.action}</Box> — install the suite it belongs to, or pick one of yours.
				</Text>
			) : null}
			{source && scope.state === 'error' && scope.error ? (
				<Text color="var(--tt-danger, #e5484d)" fontSize="xs" mt={2}>
					Source failed: {scope.error}
				</Text>
			) : null}
		</Box>
	);
};

// Why the controls are off: a stranger's thing (ownership is the only thing
// that arms it), or a platform thing whose programs aren't installable — a
// reserved-prefix demo page/component that resolves to no suite.
const InertLabel = ({ kind, author, platform }: { kind: string; author: string | null; platform: boolean }) => (
	<Text color={MUTED} fontSize="xs" mt={3} data-testid="thing-inert-label">
		🔒 Controls are off here —{' '}
		{platform
			? `this ${kind} is a Thingtime demo with no installable program behind it.`
			: `this ${kind} belongs to ${author ? `@${author}` : 'someone else'}. Only your own things and Thingtime’s seeded demos run live;`}{' '}
		open it in the builder to compose your own copy.
	</Text>
);

// /thing/:id — the universal live page for any persisted Thing. Kinds with
// a page of their own (post/action/webpage/schema) still open here from a
// pasted id and link out prominently; components render live through the
// shared live-component path, data draws through its schema's template,
// everything keeps the raw JSON view. Migration diagnostics use their
// stricter home-plane/current-admin reader; every other id rides the normal
// ACL-aware Things API.
export default function ThingPage() {
	const { id = '' } = useParams();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;
	const { v1 } = api;
	const currentUser = useCurrentUser();
	const lopu = useLopu();
	const lopuRef = React.useRef(lopu);
	lopuRef.current = lopu;
	const loadDiagnostic = v1.admin.migrationDiagnostic;
	const loadThing = v1.things.get;
	const { observeView } = useViewTracking();
	const diagnosticRoute = DIAGNOSTIC_ID_PATTERN.test(id);
	const requestKey = `${id}\u0000${currentUser?.id || 'anonymous'}\u0000${currentUser?.isAdmin ? 'admin' : 'user'}`;
	const fromParam = searchParams.get('from');
	const back = REFERRERS[(fromParam as ThingsReferrer) || 'feed'] || REFERRERS.feed;

	// Optimistic-render house rule: the last-known projection of this thing
	// paints on the very first render (per viewer, per id — never another
	// account's read), the fetch reconciles behind it. Diagnostics are never
	// cached: they are admin-only and short-lived.
	const cacheKey = `${THING_CACHE_PREFIX}${currentUser?.id || 'anon'}-${id}`;
	const seedState = React.useCallback(
		(key: string): ThingLoadState => {
			if (diagnosticRoute) return { key, loading: true, data: null, error: null };
			const cached = readLocalCache<{ data?: ThingViewData }>(cacheKey);
			const data = cached?.data?.kind === 'thing' && cached.data.thing?.id === id ? cached.data : null;
			return { key, loading: true, data, error: null };
		},
		[cacheKey, diagnosticRoute, id]
	);
	const [loadState, setLoadState] = React.useState<ThingLoadState>(() => seedState(requestKey));
	// Both representations are useful on a permalink: the preview is the
	// human-facing surface, while the full JSON remains available for people
	// inspecting a Thing's exact shape. They are independent so either one (or
	// both) can stay visible without another route or mode switch.
	const [showPreview, setShowPreview] = React.useState(true);
	const [showData, setShowData] = React.useState(true);

	// Hide prior-account data synchronously during the render that observes an
	// identity change; the effect below then aborts the old request and refetches.
	const visibleState: ThingLoadState = loadState.key === requestKey ? loadState : seedState(requestKey);

	React.useLayoutEffect(() => {
		window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
	}, [requestKey]);

	React.useEffect(() => {
		const controller = new AbortController();
		setLoadState(seedState(requestKey));

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
				if (controller.signal.aborted) return;
				setLoadState({ key: requestKey, loading: false, data: next, error: null });
				if (next.kind === 'thing') {
					try {
						if (JSON.stringify(next).length <= MAX_CACHED_THING_CHARS) {
							pruneThingCache(cacheKey);
							writeLocalCache(cacheKey, { at: Date.now(), data: next });
						}
					} catch {
						// unserialisable — the live fetch still painted
					}
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
	}, [cacheKey, currentUser?.isAdmin, diagnosticRoute, id, loadDiagnostic, loadThing, requestKey, seedState]);

	const diagnostic = visibleState.data?.kind === 'diagnostic' ? visibleState.data.diagnostic : null;
	const thing = visibleState.data?.kind === 'thing' ? visibleState.data.thing : null;
	const kinds = kindsOf(thing);
	const isComponent = kinds.includes('component');
	const isWebpage = kinds.includes('webpage');
	const isAction = kinds.includes('action');
	const isSchema = kinds.includes('schema');
	const isData = kinds.includes('data');
	const attachment = attachmentFromThing(thing);
	// The API's attachment post projection exists for the interaction-focused
	// `/media/:id` route. It is the attachment coerced into a post-shaped
	// projection, not the attachment's parent post, so it must never become a
	// blank "Post view" on this generic Thing permalink.
	const post = visibleState.data?.kind === 'thing' && !attachment ? visibleState.data.post : null;
	const references = attachment && visibleState.data?.kind === 'thing' ? directAttachmentReferences(visibleState.data.parent) : [];
	const { error, loading } = visibleState;
	const isThingOwner = !!thing && !!currentUser?.id && thing.author?.id === currentUser.id;
	const authorName: string | null = typeof thing?.author?.username === 'string' ? thing.author.username : null;

	// ---------------------------------------------------------------- trust

	const [kit, setKit] = React.useState<LiveKit | null>(null);
	const isPlatform = !!thing && RESERVED_ID.test(thing.id);
	const needsKit = !!thing && !isThingOwner && isPlatform && (isComponent || isWebpage);
	// fail closed while the catalog loads — inert, but not yet labelled as
	// someone else's: the label would be wrong for the seeded thing it usually is
	const trustPending = needsKit && !kit;
	React.useEffect(() => {
		if (!needsKit || kit) return;
		let cancelled = false;
		loadLiveKit()
			.then((loaded) => {
				if (!cancelled) setKit(loaded);
			})
			.catch(() => {
				// the catalog failed to load — the thing simply stays inert
			});
		return () => {
			cancelled = true;
		};
	}, [needsKit, kit]);

	// the page's suite, when it is a suite part: pages carry it in the
	// crystal, every other part encodes it in its id
	const suiteKey = React.useMemo<string | null>(() => {
		if (!thing || !kit) return null;
		if (isWebpage) return kit.install.suiteKeyOfPage(thing.crystal as { suiteKey?: unknown; pageKey?: unknown } | null);
		if (!RESERVED_ID.test(thing.id)) return null;
		return kit.install.suiteKeyFromActionKey(thing.id.replace(RESERVED_ID, ''), kit.suites);
	}, [thing, kit, isWebpage]);
	const suiteResolves = !!suiteKey && !!kit && kit.suites.some((suite) => suite.key === suiteKey);

	// the inline page render (webpage kind) — the same resolve /p/ uses, so
	// the viewer's own twin of a keyed page wins over the seeded copy
	const webpageTarget = React.useMemo(() => (isWebpage && thing ? { kind: 'id' as const, id: thing.id } : null), [isWebpage, thing]);
	const webpage = useWebpageDraft(webpageTarget);
	const page = webpage.resolved?.page || null;

	const seeded =
		!!thing &&
		!isThingOwner &&
		!thing.author?.id &&
		RESERVED_ID.test(thing.id) &&
		(isWebpage ? suiteResolves && webpage.resolved?.source !== 'user' : !SUITE_PART_ID.test(thing.id) || suiteResolves);
	const interactive = isThingOwner || seeded;

	// The catalog-side confirm: a seeded thing's controls name what will run
	// before anything executes. The viewer's own thing skips it — except for
	// a URL-supplied source (below), which is nobody's authored markup.
	const { confirm, dialog } = useActionRunConfirm({ enabled: true });
	const confirmRef = React.useRef(confirm);
	confirmRef.current = confirm;

	// ?source=<actionKey>: bind the component to a data source for this view.
	// It runs AS THE VIEWER on load, so it is gated behind the same confirm as
	// a control — a pasted link must never run a program by surprise — and
	// only on a surface that is live for this viewer at all.
	const sourceParam = searchParams.get('source');
	const requestedSource = React.useMemo<ThingSourceBinding | null>(
		() => (sourceParam && isSourceActionKey(sourceParam) ? { action: sourceParam, refresh: 'load' } : null),
		[sourceParam]
	);
	const [approvedSource, setApprovedSource] = React.useState<ThingSourceBinding | null>(null);
	const requestedAction = requestedSource?.action || null;
	React.useEffect(() => {
		if (!requestedAction || !isComponent || !interactive || !thing) {
			setApprovedSource(null);
			return;
		}
		let cancelled = false;
		Promise.resolve(confirmRef.current({ action: requestedAction, inputs: {} })).then((approved) => {
			if (!cancelled) setApprovedSource(approved ? { action: requestedAction, refresh: 'load' } : null);
		});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- re-ask only when the source, the thing or its trust changes
	}, [requestedAction, isComponent, interactive, thing?.id]);

	// ---------------------------------------------------------------- install

	// The post-install hand-off is deferred so the "installed ✨" toast is
	// readable before the page moves. Held in a ref so unmount — and a second
	// install — cancels the pending hand-off (p.tsx).
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

	// Install a suite for the viewer — app suites through the one-request
	// idempotent server install, demo suites part by part on the client — the
	// same two paths /p/ takes, so both surfaces create exactly the same things.
	const installForViewer = React.useCallback(
		async (key: string): Promise<{ href: string | null } | null> => {
			if (!kit) return null;
			const suite = kit.suites.find((entry) => entry.key === key) || null;
			if (!suite) return null;
			if (!currentUser?.id) {
				lopuRef.current({ title: 'Sign in to install this 🗝️', description: 'Installing it makes the programs — and the data — yours.', status: 'info' });
				navigate('/login');
				return null;
			}
			lopuRef.current({ title: `Installing ${suite.emoji} ${suite.title}…`, description: 'Your own schemas, controls, actions, and pages.', status: 'info', duration: 4000 });
			if (suite.app) {
				const installed = await kit.install.installSuiteOnServer(suite.key);
				const href = `/p/${encodeURIComponent(installed.entryPageKey)}`;
				lopuRef.current({
					title: `${suite.emoji} ${suite.title} installed ✨`,
					description: `${installed.created} things created · ${installed.updated} refreshed — its controls run as you now.`,
					status: 'success',
					duration: 6000,
					link: { label: 'Open my app', href }
				});
				return { href };
			}
			const installed = await kit.install.installSuite((payload) => apiRef.current.v1.things.create(payload), suite, { seeded: true });
			const href = `/p/${encodeURIComponent(installed.pageId)}`;
			lopuRef.current({
				title: `${suite.emoji} ${suite.title} installed ✨`,
				description: 'Your own copy of its page, controls and programs.',
				status: 'success',
				duration: 6000,
				link: { label: 'Open my page', href }
			});
			return { href };
		},
		[currentUser?.id, kit, navigate]
	);

	// a seeded control the viewer has no program for: install the suite, let
	// the same click run again. A seeded PAGE then hands off to the viewer's
	// own twin (p.tsx); a component page stays put — the viewer now owns the
	// programs its controls name, so this very page keeps working.
	const onUnowned = React.useCallback(
		async (action: string): Promise<boolean> => {
			if (!kit) return false;
			const key = kit.install.suiteKeyFromActionKey(action, kit.suites) || suiteKey;
			if (!key) return false;
			try {
				const outcome = await installForViewer(key);
				if (!outcome) return false;
				if (outcome.href && isWebpage) {
					const target = outcome.href;
					scheduleHandoff(() => navigate(target), 1200);
				}
				return true;
			} catch (err: any) {
				lopuRef.current({ title: err?.error || 'Couldn’t install — try again 🌈', status: 'error' });
				return false;
			}
		},
		[installForViewer, isWebpage, kit, navigate, scheduleHandoff, suiteKey]
	);

	// the `$install` pseudo-action a seeded page's own button names
	const onInstall = React.useCallback(async (): Promise<boolean> => {
		if (!suiteKey) return false;
		try {
			const outcome = await installForViewer(suiteKey);
			if (!outcome) return false;
			if (outcome.href && isWebpage) navigate(outcome.href);
			return true;
		} catch (err: any) {
			lopuRef.current({ title: err?.error || 'Couldn’t install — try again 🌈', status: 'error' });
			return false;
		}
	}, [installForViewer, isWebpage, navigate, suiteKey]);

	// ---------------------------------------------------------------- data kind

	// a data thing's schema render template: the /things Previews cache paints
	// it instantly, the schema fetch reconciles (null = fetched, has none)
	const schemaId = thing && isData ? schemaIdOf({ thingtime: kinds, crystal: thing.crystal || {} }) : null;
	const [schemaRender, setSchemaRender] = React.useState<{ schemaId: string; template: Record<string, unknown> | null } | null>(null);
	React.useEffect(() => {
		if (!schemaId) return;
		const cached = readLocalCache<ThingsCache>(thingsCacheKey(currentUser?.id))?.schemaRenders?.[schemaId];
		if (cached !== undefined) setSchemaRender({ schemaId, template: cached });
		let cancelled = false;
		apiRef.current.v1.things
			.get({ id: schemaId })
			.then((response: any) => {
				if (!cancelled) setSchemaRender({ schemaId, template: schemaRenderOf(response?.thing) });
			})
			.catch(() => {
				if (!cancelled) setSchemaRender((current) => current?.schemaId === schemaId ? current : { schemaId, template: null });
			});
		return () => {
			cancelled = true;
		};
	}, [schemaId, currentUser?.id]);
	const dataTemplate = schemaId && schemaRender?.schemaId === schemaId ? schemaRender.template : null;

	// ---------------------------------------------------------------- view

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
	const primaryKind = kinds[0] || 'thing';
	const displayName = thing ? thingDisplayName({ thingtime: kinds, crystal: thing.crystal || {} }) : '';
	const ownPage = thing ? thingLink({ id: thing.id, thingtime: kinds }) : null;
	const actionCrystal = isAction ? ((thing?.crystal || {}) as ActionCrystal) : null;
	const actionEffects = actionCrystal ? actionEffectsOf(actionCrystal) : null;
	const actionLimits = actionCrystal ? actionLimitsOf(actionCrystal) : null;
	const actionInputs = actionCrystal ? runInputDescriptorsOf(actionCrystal) : [];
	const schemaFields: Record<string, unknown>[] = isSchema && Array.isArray(thing?.crystal?.fields) ? thing!.crystal.fields.filter((field: unknown) => field && typeof field === 'object') : [];

	const copyDetail = async () => {
		try {
			await navigator.clipboard.writeText(detail);
			lopu({ title: diagnostic ? 'Error copied' : 'Thing copied', status: 'success' });
		} catch {
			lopu({ title: 'Could not copy this Thing', description: 'Select the text and copy it manually.', status: 'error' });
		}
	};

	const handlePostChanged = React.useCallback(
		(postId: string, change: PostChange) => {
			setLoadState((current) => {
				if (current.key !== requestKey || current.data?.kind !== 'thing' || !current.data.post) return current;
				if (current.data.post.id !== postId) return current;
				const next = typeof change === 'function' ? change(current.data.post) : change;
				if (!next) {
					navigate(back.to);
					return current;
				}
				return { ...current, data: { ...current.data, post: next } };
			});
		},
		[back.to, navigate, requestKey]
	);

	const previewBody = thing ? (
		isComponent ? (
			<>
				<ComponentLive
					thing={thing}
					source={approvedSource}
					interactive={interactive}
					confirm={isThingOwner ? undefined : confirm}
					onUnowned={seeded ? onUnowned : undefined}
				/>
				{!interactive && !trustPending ? <InertLabel kind="component" author={authorName} platform={isPlatform} /> : null}
			</>
		) : isWebpage ? (
			<Stack spacing={3} minW={0}>
				<Flex align="center" gap={2} wrap="wrap">
					<Button as={Link} to={ownPage || '/'} size="sm" rightIcon={<ExternalLink size={13} />} data-testid="thing-open-page">
						Open {ownPage}
					</Button>
					{isThingOwner ? (
						<Button as={Link} to={`/builder?page=${encodeURIComponent(thing.id)}`} size="sm" variant="outline">
							✏️ Edit in builder
						</Button>
					) : null}
				</Flex>
				{page ? (
					<Box data-testid="thing-webpage-live" minW={0}>
						<WebpageBlocksRenderer
							blocks={(page.crystal?.blocks as WebpageBlock[]) || []}
							componentsByRef={webpage.componentsByRef}
							interactive={interactive}
							onTtActionUnowned={seeded ? onUnowned : undefined}
						/>
					</Box>
				) : webpage.loading ? null : (
					<Text color={MUTED} fontSize="sm">
						This page can’t be resolved for you here — open it on its own page.
					</Text>
				)}
				{!interactive && !trustPending ? <InertLabel kind="page" author={authorName} platform={isPlatform} /> : null}
			</Stack>
		) : isAction && actionCrystal ? (
			<Stack spacing={3} minW={0}>
				<Flex align="center" gap={2} minW={0} wrap="wrap">
					<Text fontSize="17px">⚡</Text>
					<Text color="var(--tt-ink, #16161a)" fontSize="17px" fontWeight="600" overflowWrap="anywhere">
						{typeof actionCrystal.name === 'string' && actionCrystal.name ? actionCrystal.name : 'Action'}
					</Text>
					{typeof actionCrystal.actionKey === 'string' && actionCrystal.actionKey ? (
						<Text color={MUTED} fontFamily={MONO} fontSize="11px" letterSpacing="0.08em" overflowWrap="anywhere">
							{actionCrystal.actionKey}
						</Text>
					) : null}
				</Flex>
				{typeof actionCrystal.description === 'string' && actionCrystal.description ? (
					<Text color="var(--tt-text, #33333c)" fontSize="sm">
						{actionCrystal.description}
					</Text>
				) : null}
				{actionInputs.length ? (
					<Flex gap={1.5} wrap="wrap">
						{actionInputs.map((input, index) => (
							<ActionChip dot={false} key={`${String(input.name)}-${index}`} size="md">
								{String(input.name)}: {String(input.type || 'string')}
								{input.required ? ' *' : ''}
							</ActionChip>
						))}
					</Flex>
				) : null}
				<Flex gap={1.5} wrap="wrap">
					{actionEffects?.creates.map((schema) => (
						<ActionChip key={`c-${schema}`} size="md" tone="create">
							creates {displayRef(schema)}
						</ActionChip>
					))}
					{actionEffects?.reads.map((schema) => (
						<ActionChip key={`r-${schema}`} size="md" tone="read">
							reads {schema === '*' ? 'things' : displayRef(schema)}
						</ActionChip>
					))}
					{actionEffects?.updates ? (
						<ActionChip size="md" tone="write">
							updates things
						</ActionChip>
					) : null}
					{actionEffects?.invokes.map((key) => (
						<ActionChip key={`i-${key}`} size="md" tone="invoke">
							⚡ {key}
						</ActionChip>
					))}
					{actionLimits ? (
						<ActionChip dot={false} size="md">
							{ACTION_LIMIT_LABELS.timeoutMs(actionLimits.timeoutMs)} · {ACTION_LIMIT_LABELS.maxOperations(actionLimits.maxOperations)}
						</ActionChip>
					) : null}
				</Flex>
				<Box>
					<Button as={Link} to={ownPage || '/actions'} size="sm" rightIcon={<ExternalLink size={13} />} data-testid="thing-open-page">
						Run it on {ownPage}
					</Button>
				</Box>
				<Text color={MUTED} fontSize="xs">
					The inspector shows every step, capability and run record, and is the only place a program runs by hand.
				</Text>
			</Stack>
		) : isSchema ? (
			<Stack spacing={3} minW={0}>
				<Flex align="center" gap={2} minW={0} wrap="wrap">
					<Text fontSize="17px">💎</Text>
					<Text color="var(--tt-ink, #16161a)" fontSize="17px" fontWeight="600" overflowWrap="anywhere">
						{displayName}
					</Text>
				</Flex>
				{typeof thing.crystal?.description === 'string' && thing.crystal.description ? (
					<Text color="var(--tt-text, #33333c)" fontSize="sm">
						{thing.crystal.description}
					</Text>
				) : null}
				{schemaFields.length ? (
					<Flex gap={1.5} wrap="wrap" data-testid="thing-schema-fields">
						{schemaFields.map((field, index) => (
							<ActionChip dot={false} key={`${String(field.name)}-${index}`} size="md">
								{String(field.name)} · {String(field.type || 'string')}
								{field.required ? ' *' : ''}
							</ActionChip>
						))}
					</Flex>
				) : (
					<Text color={MUTED} fontSize="xs">
						No crystal fields — this schema’s presence in thingtime is the whole payload.
					</Text>
				)}
				<Box>
					<Button as={Link} to={ownPage || '/schemas'} size="sm" rightIcon={<ExternalLink size={13} />} data-testid="thing-open-page">
						Open {ownPage}
					</Button>
				</Box>
			</Stack>
		) : isData && dataTemplate ? (
			<Box data-testid="thing-data-template" minW={0}>
				<SchemaTemplateRender template={dataTemplate} crystal={(thing.crystal || {}) as Record<string, unknown>} />
			</Box>
		) : (
			<ThingView thing={thing.crystal} />
		)
	) : null;

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
					<Box minW={0}>
						<Text color={MUTED} fontFamily="mono" fontSize="10px" fontWeight="700" letterSpacing="0.12em" textTransform="uppercase">
							Thingtime · {diagnosticRoute ? 'Private admin diagnostic' : thing ? primaryKind : 'Thing'}
						</Text>
						<Heading as="h1" mt={1} fontSize={{ base: '2xl', md: '3xl' }} overflowWrap="anywhere">
							{diagnostic ? `Migration error · ${diagnostic.migrationId}` : diagnosticRoute ? 'Migration error' : displayName || 'Thing'}
						</Heading>
					</Box>
					<Button
						as={Link}
						to={diagnosticRoute ? '/migrations' : back.to}
						size="sm"
						variant="outline"
						leftIcon={<ArrowLeft size={15} />}
						borderRadius="999px"
						data-testid="thing-back-link"
					>
						{diagnosticRoute ? 'Back to migrations' : back.label}
					</Button>
				</Flex>

				{loading && !diagnostic && !thing ? (
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

				{diagnostic || thing ? (
					<>
						<Box {...CARD_STYLES} p={{ base: 5, md: 6 }}>
							<Flex align="flex-start" justify="space-between" gap={4} wrap="wrap">
								<Box minW={0}>
									<Flex gap={2} wrap="wrap" mb={3}>
										{diagnostic ? <Badge colorScheme="purple">admin only</Badge> : null}
										{diagnostic ? <Badge colorScheme="orange">HTTP {diagnostic.status}</Badge> : null}
										{diagnostic ? <Badge>{diagnostic.outcome}</Badge> : null}
										{kinds.map((kind) => (
											<Badge key={kind} variant="subtle">
												{kind}
											</Badge>
										))}
										{thing?.visibility ? <Badge>{thing.visibility}</Badge> : null}
										{isThingOwner ? <Badge colorScheme="green">yours</Badge> : seeded ? <Badge colorScheme="purple">seeded by Thingtime</Badge> : null}
									</Flex>
									<Text fontWeight="700" overflowWrap="anywhere">
										{diagnostic?.summary || displayName || thing?.id}
									</Text>
									<Text mt={2} color={MUTED} fontFamily="mono" fontSize="xs" overflowWrap="anywhere">
										{diagnostic?.id || thing?.id}
										{authorName ? ` · by @${authorName}` : ''}
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
								<Flex gap={2} wrap="wrap">
									{ownPage && !ownPage.startsWith('/thing/') ? (
										<Button as={Link} to={ownPage} size="sm" variant="outline" rightIcon={<ExternalLink size={13} />}>
											{isAction ? 'Run on /actions' : 'Open page'}
										</Button>
									) : null}
									<Button size="sm" leftIcon={<Copy size={15} />} onClick={copyDetail} isDisabled={!detail}>
										Copy {diagnostic ? 'error' : 'Thing'}
									</Button>
								</Flex>
							</Flex>
						</Box>

						{thing ? (
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
										Choose the {interactive && (isComponent || isWebpage) ? 'live' : 'human-friendly'} preview, the raw Thing data, or both.
									</Text>
								</Box>
								<Flex align="center" gap={4} role="group" aria-label="Thing page views" wrap="wrap">
									<Flex align="center" gap={2}>
										<Switch aria-label="Show rendered preview" isChecked={showPreview} onChange={(event) => setShowPreview(event.target.checked)} />
										<Text fontSize="sm">{interactive && (isComponent || isWebpage) ? 'Live preview' : 'Rendered preview'}</Text>
									</Flex>
									<Flex align="center" gap={2}>
										<Switch aria-label="Show Thing data" isChecked={showData} onChange={(event) => setShowData(event.target.checked)} />
										<Text fontSize="sm">Thing data</Text>
									</Flex>
								</Flex>
							</Flex>
						) : null}

						{showPreview && attachment ? <ThingAttachmentDetail attachment={attachment} references={references} /> : null}

						{showPreview && post ? (
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

						{showPreview && thing && !post ? (
							// The page runtime is what makes a live surface live: sources
							// load and refetch after every run, `$refresh`/`$install` work.
							// Its source is the viewer's ownership; its installer exists only
							// for a seeded suite thing.
							<WebpageRuntimeProvider
								pageId={thing.id}
								pageKey={isWebpage && typeof thing.crystal?.pageKey === 'string' ? thing.crystal.pageKey : null}
								suiteKey={suiteKey ?? null}
								source={isThingOwner ? 'user' : 'system'}
								onInstall={seeded && suiteKey ? onInstall : undefined}
							>
								<Box {...CARD_STYLES} p={{ base: 4, md: 6 }} minW={0} data-live={interactive ? 'true' : 'false'}>
									<Flex align="center" justify="space-between" gap={3} mb={3} wrap="wrap">
										<Heading as="h2" fontSize="md">
											{interactive && (isComponent || isWebpage) ? 'Live preview' : 'Rendered preview'}
										</Heading>
										{seeded && (isComponent || isWebpage) ? (
											<Text color={MUTED} fontSize="xs">
												Controls run as you — each one asks first{suiteKey ? ', and installs the suite if you don’t own its program yet' : ''}.
											</Text>
										) : null}
									</Flex>
									<Box minW={0}>{previewBody}</Box>
								</Box>
							</WebpageRuntimeProvider>
						) : null}

						{showData ? (
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
			{dialog}
		</Flex>
	);
}
