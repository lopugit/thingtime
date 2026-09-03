import React from 'react';

import { useThingtime } from '../Thingtime/useThingtime';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';

// 🦄 Lopu assistant preferences + the floating host's persisted geometry.
//
// Preferences are local-first thingtime settings under `settings.lopu.*`
// (namespace 'lopu', outside the undo/redo timeline — the same posture as the
// drawer's `settings.drawer.*`): they persist to localforage, restore on
// reload, and sync between tabs. The one exception is `open`, which describes
// THIS viewport (is the floating window showing here?) and is written
// tabLocal so opening Lopu in one tab never pops her open in every other tab.
//
// The launcher bubble position and the window frame are per-device chrome,
// not preferences worth syncing — they live in the synchronous localStorage
// tier (`tt-lopu-launcher`, `tt-lopu-window`) so the host paints its
// last-known geometry on the very first frame and never jumps.

export type LopuDock = 'free' | 'right' | 'left';
export type LopuSpeed = 'normal' | 'fast';

export interface LopuSettings {
	// show the floating 🦄 bubble on every page
	launcher: boolean;
	// where the chat window sits: free-floating or flush against an edge
	dock: LopuDock;
	// paint Lopu's builder patches into the open draft while she streams
	applyPatches: boolean;
	// ask before deleting a CONVERSATION from the list (the sidebar's delete
	// button). Lopu's own destructive tools (delete_thing, a whole-crystal
	// replace, a deleting action) always need the server-verified Confirm card
	// on the tool row — that is not a preference, so nothing here can turn it off
	confirmDeletes: boolean;
	// Enter sends, Shift+Enter adds a newline (false: Enter is a newline)
	enterSends: boolean;
	// model / effort / speed preference; null = follow the catalog defaults
	model: string | null;
	effort: string | null;
	speed: LopuSpeed | null;
	// voice: read Lopu's replies aloud (off = text only, the quiet default)
	spokenReplies: boolean;
	// voice: transcribe mode — every final utterance becomes a private
	// transcript page + a quote instead of an AI turn
	transcribe: boolean;
	// the brain a voice/chat turn thinks with: a Secure Vault provider id (or
	// a catalog model id); null = whatever the model picker says
	providerId: string | null;
	// voice: direct voice — stream the microphone straight to the chat's own
	// Secure Vault provider when its kind offers realtime speech (xAI Grok
	// Voice, design note §6.1); off = device transcription + a normal turn.
	// The switch only takes effect for a provider that supports it
	directVoice: boolean;
	// voice: the realtime model direct voice runs on; null = the provider's
	// first realtime model
	directVoiceModel: string | null;
	// the floating window is open in this viewport (tab-local)
	open: boolean;
}

export const LOPU_SETTINGS_NAMESPACE = 'lopu';
export const LOPU_SETTINGS_PATH = 'settings.lopu';

export const LOPU_SETTINGS_DEFAULTS: LopuSettings = {
	launcher: true,
	dock: 'free',
	applyPatches: true,
	confirmDeletes: true,
	enterSends: true,
	model: null,
	effort: null,
	speed: null,
	spokenReplies: false,
	transcribe: false,
	providerId: null,
	directVoice: false,
	directVoiceModel: null,
	open: false
};

export const LOPU_DOCKS: readonly LopuDock[] = ['free', 'right', 'left'];

const MAX_ID_LENGTH = 80;

export const normalizeLopuDock = (raw: unknown): LopuDock => {
	return raw === 'right' || raw === 'left' ? raw : 'free';
};

export const normalizeLopuSpeed = (raw: unknown): LopuSpeed | null => {
	return raw === 'fast' || raw === 'normal' ? raw : null;
};

const boolOr = (raw: unknown, fallback: boolean): boolean => {
	return typeof raw === 'boolean' ? raw : fallback;
};

const idOrNull = (raw: unknown): string | null => {
	if (typeof raw !== 'string') {
		return null;
	}
	const trimmed = raw.trim();
	return trimmed ? trimmed.slice(0, MAX_ID_LENGTH) : null;
};

// Tolerant reader for whatever `settings.lopu` currently holds — a missing
// branch, a partial one from an older build, or junk — always yields a
// complete settings object with the documented defaults.
export const normalizeLopuSettings = (raw: unknown): LopuSettings => {
	const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

	return {
		launcher: boolOr(source.launcher, LOPU_SETTINGS_DEFAULTS.launcher),
		dock: normalizeLopuDock(source.dock),
		applyPatches: boolOr(source.applyPatches, LOPU_SETTINGS_DEFAULTS.applyPatches),
		confirmDeletes: boolOr(source.confirmDeletes, LOPU_SETTINGS_DEFAULTS.confirmDeletes),
		enterSends: boolOr(source.enterSends, LOPU_SETTINGS_DEFAULTS.enterSends),
		model: idOrNull(source.model),
		effort: idOrNull(source.effort),
		speed: normalizeLopuSpeed(source.speed),
		spokenReplies: boolOr(source.spokenReplies, LOPU_SETTINGS_DEFAULTS.spokenReplies),
		transcribe: boolOr(source.transcribe, LOPU_SETTINGS_DEFAULTS.transcribe),
		providerId: idOrNull(source.providerId),
		directVoice: boolOr(source.directVoice, LOPU_SETTINGS_DEFAULTS.directVoice),
		directVoiceModel: idOrNull(source.directVoiceModel),
		open: boolOr(source.open, LOPU_SETTINGS_DEFAULTS.open)
	};
};

export interface LopuModelChoice {
	model: string | null;
	effort?: string | null;
	speed?: LopuSpeed | null;
}

// ---------------------------------------------------------------------------
// Floating host geometry (pure, viewport-relative, unit tested)
// ---------------------------------------------------------------------------

export interface LopuViewport {
	width: number;
	height: number;
}

export interface LopuPoint {
	x: number;
	y: number;
}

export interface LopuWindowGeometry extends LopuPoint {
	width: number;
	height: number;
}

export const LOPU_LAUNCHER_SIZE = 48;
// matches DevKit's corner inset so the two bubbles share a right edge
export const LOPU_LAUNCHER_INSET = 20;
// the strip DevKit's corner bubble owns at the bottom-right (its 48px bubble
// plus its 20px inset, rounded up): the launcher stacks above it and a
// right-docked column stops short of it so the composer stays reachable
export const LOPU_DEVKIT_CLEARANCE = 72;
// stacked 72px above DevKit's bubble (DevKit sits 20px off the bottom)
export const LOPU_LAUNCHER_BOTTOM_INSET = LOPU_LAUNCHER_INSET + LOPU_DEVKIT_CLEARANCE;
// the launcher must never leave the viewport entirely; keep a full bubble reachable
export const LOPU_LAUNCHER_EDGE_GUTTER = 4;

export const LOPU_WINDOW_MARGIN = 24;
export const LOPU_WINDOW_DEFAULT_SIZE = { width: 400, height: 560 } as const;
export const LOPU_WINDOW_MIN_SIZE = { width: 320, height: 360 } as const;
// gap between the window's bottom edge and the launcher's top edge by default
export const LOPU_WINDOW_LAUNCHER_GAP = 12;

export const LOPU_LAUNCHER_CACHE_KEY = 'tt-lopu-launcher';
export const LOPU_WINDOW_CACHE_KEY = 'tt-lopu-window';

const finite = (value: unknown): number | null => {
	const numeric = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(numeric) ? numeric : null;
};

const clampNumber = (value: number, min: number, max: number): number => {
	return Math.min(Math.max(value, min), Math.max(min, max));
};

const safeViewport = (viewport: LopuViewport): LopuViewport => ({
	width: Math.max(1, finite(viewport?.width) ?? 1),
	height: Math.max(1, finite(viewport?.height) ?? 1)
});

// Where the bubble rests before anyone drags it: bottom-right, above DevKit.
export const defaultLopuLauncherPosition = (viewport: LopuViewport): LopuPoint => {
	const view = safeViewport(viewport);
	return clampLopuLauncherPosition(
		{
			x: view.width - LOPU_LAUNCHER_INSET - LOPU_LAUNCHER_SIZE,
			y: view.height - LOPU_LAUNCHER_BOTTOM_INSET - LOPU_LAUNCHER_SIZE
		},
		view
	);
};

// Keep the whole bubble on screen (with a small gutter), whatever the
// persisted position or the current viewport.
export const clampLopuLauncherPosition = (position: LopuPoint, viewport: LopuViewport): LopuPoint => {
	const view = safeViewport(viewport);
	const maxX = view.width - LOPU_LAUNCHER_SIZE - LOPU_LAUNCHER_EDGE_GUTTER;
	const maxY = view.height - LOPU_LAUNCHER_SIZE - LOPU_LAUNCHER_EDGE_GUTTER;

	return {
		x: Math.round(clampNumber(finite(position?.x) ?? maxX, LOPU_LAUNCHER_EDGE_GUTTER, maxX)),
		y: Math.round(clampNumber(finite(position?.y) ?? maxY, LOPU_LAUNCHER_EDGE_GUTTER, maxY))
	};
};

// The window's size is bounded by the viewport minus a margin (min 320×360,
// max viewport−24); its origin keeps the whole frame visible.
export const clampLopuWindowSize = (size: { width?: unknown; height?: unknown }, viewport: LopuViewport): { width: number; height: number } => {
	const view = safeViewport(viewport);
	const maxWidth = Math.max(1, view.width - LOPU_WINDOW_MARGIN);
	const maxHeight = Math.max(1, view.height - LOPU_WINDOW_MARGIN);

	return {
		width: Math.round(clampNumber(finite(size?.width) ?? LOPU_WINDOW_DEFAULT_SIZE.width, Math.min(LOPU_WINDOW_MIN_SIZE.width, maxWidth), maxWidth)),
		height: Math.round(
			clampNumber(finite(size?.height) ?? LOPU_WINDOW_DEFAULT_SIZE.height, Math.min(LOPU_WINDOW_MIN_SIZE.height, maxHeight), maxHeight)
		)
	};
};

export const clampLopuWindowGeometry = (geometry: LopuWindowGeometry, viewport: LopuViewport): LopuWindowGeometry => {
	const view = safeViewport(viewport);
	const size = clampLopuWindowSize(geometry, view);

	return {
		...size,
		x: Math.round(clampNumber(finite(geometry?.x) ?? 0, 0, view.width - size.width)),
		y: Math.round(clampNumber(finite(geometry?.y) ?? 0, 0, view.height - size.height))
	};
};

// Default frame: 400×560 in the bottom-right corner, resting above the
// launcher so the bubble never covers the composer.
export const defaultLopuWindowGeometry = (viewport: LopuViewport, launcher?: LopuPoint | null): LopuWindowGeometry => {
	const view = safeViewport(viewport);
	const size = clampLopuWindowSize({}, view);
	const bubble = launcher ? clampLopuLauncherPosition(launcher, view) : defaultLopuLauncherPosition(view);
	const bottomLimit = bubble.y - LOPU_WINDOW_LAUNCHER_GAP;

	return clampLopuWindowGeometry(
		{
			...size,
			x: view.width - size.width - LOPU_WINDOW_MARGIN,
			y: Math.max(LOPU_WINDOW_MARGIN / 2, bottomLimit - size.height)
		},
		view
	);
};

// Resolve whatever was persisted (nothing, a partial frame from an older
// build, or a full one) into a complete on-screen frame.
export const resolveLopuWindowGeometry = (
	raw: Partial<LopuWindowGeometry> | null | undefined,
	viewport: LopuViewport,
	launcher?: LopuPoint | null
): LopuWindowGeometry => {
	const fallback = defaultLopuWindowGeometry(viewport, launcher);

	if (!raw || typeof raw !== 'object') {
		return fallback;
	}

	return clampLopuWindowGeometry(
		{
			x: finite(raw.x) ?? fallback.x,
			y: finite(raw.y) ?? fallback.y,
			width: finite(raw.width) ?? fallback.width,
			height: finite(raw.height) ?? fallback.height
		},
		viewport
	);
};

// Docked: a full-height column flush with the chosen edge, keeping the free
// frame's width (bounded to the viewport).
export const dockedLopuWindowGeometry = (dock: Exclude<LopuDock, 'free'>, width: number, viewport: LopuViewport): LopuWindowGeometry => {
	const view = safeViewport(viewport);
	const size = clampLopuWindowSize({ width, height: view.height }, view);
	const dockedWidth = Math.min(size.width, view.width);
	// a right-hand column shares its corner with DevKit's bubble: stop above
	// it so the composer's send button is never covered (a left column is
	// full height — nothing sits in that corner)
	const height = dock === 'right' ? Math.max(LOPU_WINDOW_MIN_SIZE.height, view.height - LOPU_DEVKIT_CLEARANCE) : view.height;

	return {
		x: dock === 'right' ? Math.max(0, view.width - dockedWidth) : 0,
		y: 0,
		width: dockedWidth,
		height: Math.min(height, view.height)
	};
};

export const readLopuLauncherPosition = (): LopuPoint | null => {
	const raw = readLocalCache<Partial<LopuPoint>>(LOPU_LAUNCHER_CACHE_KEY);
	const x = finite(raw?.x);
	const y = finite(raw?.y);
	return x === null || y === null ? null : { x, y };
};

export const writeLopuLauncherPosition = (position: LopuPoint | null): void => {
	writeLocalCache(LOPU_LAUNCHER_CACHE_KEY, position ? { x: Math.round(position.x), y: Math.round(position.y) } : null);
};

export const readLopuWindowGeometry = (): Partial<LopuWindowGeometry> | null => {
	const raw = readLocalCache<Partial<LopuWindowGeometry>>(LOPU_WINDOW_CACHE_KEY);
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const picked: Partial<LopuWindowGeometry> = {};
	for (const key of ['x', 'y', 'width', 'height'] as const) {
		const value = finite(raw[key]);
		if (value !== null) {
			picked[key] = value;
		}
	}
	return Object.keys(picked).length ? picked : null;
};

export const writeLopuWindowGeometry = (geometry: LopuWindowGeometry): void => {
	writeLocalCache(LOPU_WINDOW_CACHE_KEY, {
		x: Math.round(geometry.x),
		y: Math.round(geometry.y),
		width: Math.round(geometry.width),
		height: Math.round(geometry.height)
	});
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useLopuSettings = () => {
	const { thingtime, setThingtime, loading } = useThingtime();

	const rawSettings = thingtime?.settings?.lopu;
	const settings = React.useMemo(() => normalizeLopuSettings(rawSettings), [rawSettings]);

	// Lopu preferences are UI chrome, not content — keep them out of the
	// undo/redo timeline (mirrors useDrawer.setDrawerSetting).
	const setLopuSetting = React.useCallback(
		(key: Exclude<keyof LopuSettings, 'open'>, value: unknown) => {
			setThingtime?.(`${LOPU_SETTINGS_PATH}.${key}`, value, {
				ignoreUndoRedo: true,
				namespace: LOPU_SETTINGS_NAMESPACE
			});
		},
		[setThingtime]
	);

	// Whether the floating window is showing describes THIS viewport, not a
	// preference: a second tab sliding Lopu open because you opened her here
	// would be wrong. Persisted as before, so a reload still restores it.
	const setOpen = React.useCallback(
		(value: boolean) => {
			setThingtime?.('settings.lopu.open', !!value, { ignoreUndoRedo: true, namespace: 'lopu', tabLocal: true });
		},
		[setThingtime]
	);

	const open = settings.open;
	const toggleOpen = React.useCallback(() => {
		setOpen(!open);
	}, [open, setOpen]);

	const setLauncher = React.useCallback(
		(value: boolean) => {
			setLopuSetting('launcher', !!value);
		},
		[setLopuSetting]
	);

	const setDock = React.useCallback(
		(value: LopuDock) => {
			setLopuSetting('dock', normalizeLopuDock(value));
		},
		[setLopuSetting]
	);

	const setApplyPatches = React.useCallback(
		(value: boolean) => {
			setLopuSetting('applyPatches', !!value);
		},
		[setLopuSetting]
	);

	const setConfirmDeletes = React.useCallback(
		(value: boolean) => {
			setLopuSetting('confirmDeletes', !!value);
		},
		[setLopuSetting]
	);

	const setEnterSends = React.useCallback(
		(value: boolean) => {
			setLopuSetting('enterSends', !!value);
		},
		[setLopuSetting]
	);

	// Effort tiers and fast mode are per-model, so a model change carries its
	// own effort/speed (or clears them back to the catalog default).
	const setModelChoice = React.useCallback(
		(choice: LopuModelChoice) => {
			setLopuSetting('model', idOrNull(choice?.model));
			setLopuSetting('effort', idOrNull(choice?.effort));
			setLopuSetting('speed', normalizeLopuSpeed(choice?.speed));
		},
		[setLopuSetting]
	);

	const setEffort = React.useCallback(
		(value: string | null) => {
			setLopuSetting('effort', idOrNull(value));
		},
		[setLopuSetting]
	);

	const setSpeed = React.useCallback(
		(value: LopuSpeed | null) => {
			setLopuSetting('speed', normalizeLopuSpeed(value));
		},
		[setLopuSetting]
	);

	const setSpokenReplies = React.useCallback(
		(value: boolean) => {
			setLopuSetting('spokenReplies', !!value);
		},
		[setLopuSetting]
	);

	const setTranscribe = React.useCallback(
		(value: boolean) => {
			setLopuSetting('transcribe', !!value);
		},
		[setLopuSetting]
	);

	const setProviderId = React.useCallback(
		(value: string | null) => {
			setLopuSetting('providerId', idOrNull(value));
		},
		[setLopuSetting]
	);

	const setDirectVoice = React.useCallback(
		(value: boolean) => {
			setLopuSetting('directVoice', !!value);
		},
		[setLopuSetting]
	);

	const setDirectVoiceModel = React.useCallback(
		(value: string | null) => {
			setLopuSetting('directVoiceModel', idOrNull(value));
		},
		[setLopuSetting]
	);

	return {
		loading,
		settings,
		open,
		setOpen,
		toggleOpen,
		setLauncher,
		setDock,
		setApplyPatches,
		setConfirmDeletes,
		setEnterSends,
		setModelChoice,
		setEffort,
		setSpeed,
		setSpokenReplies,
		setTranscribe,
		setProviderId,
		setDirectVoice,
		setDirectVoiceModel
	};
};

export type UseLopuSettings = ReturnType<typeof useLopuSettings>;

// ---------------------------------------------------------------------------
// Model catalog (GET /api/v1/ai/models) — optimistic, cached per device
// ---------------------------------------------------------------------------

// Public projection of an `ai-model` thing (design note §1.1).
export interface LopuCatalogModel {
	id: string;
	label: string;
	provider: string;
	efforts: string[];
	speeds: string[];
	family: string | null;
	enabled: boolean;
	available: boolean;
	// the provider key's probe verdict (true verified, false rejected, null unknown)
	verified: boolean | null;
	isDefault: boolean;
}

// providers.<p> — the server key behind a provider: presence + the bounded
// probe's verdict (never a value)
export interface LopuCatalogProvider {
	configured: boolean;
	verified: boolean | null;
	checkedAt: string | null;
	reason: string | null;
}

export interface LopuCatalogDefaults {
	model: string | null;
	effort: string | null;
	speed: LopuSpeed | null;
}

export interface LopuCatalog {
	models: LopuCatalogModel[];
	defaults: LopuCatalogDefaults;
	providers: Record<string, LopuCatalogProvider>;
}

// Own key so the host, the settings rows and the admin editor never depend on
// the chat store's cache shape; the chat store's `tt-lopu-models` line is
// read as a fallback seed (its { models, defaults, providers } payload
// normalises the same way). The `tt-lopu-` prefix keeps both inside the
// logout sweep.
export const LOPU_CATALOG_CACHE_KEY = 'tt-lopu-catalog';
export const LOPU_CHAT_STORE_MODELS_CACHE_KEY = 'tt-lopu-models';

export const EMPTY_LOPU_CATALOG: LopuCatalog = {
	models: [],
	defaults: { model: null, effort: null, speed: null },
	providers: {}
};

const stringList = (raw: unknown): string[] => {
	return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string' && !!entry) : [];
};

export const normalizeLopuCatalogModel = (raw: unknown): LopuCatalogModel | null => {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const source = raw as Record<string, unknown>;
	const id = idOrNull(source.id);
	if (!id) {
		return null;
	}
	const enabled = source.enabled !== false;
	return {
		id,
		label: typeof source.label === 'string' && source.label.trim() ? source.label.trim() : id,
		provider: typeof source.provider === 'string' ? source.provider : 'unknown',
		efforts: stringList(source.efforts),
		speeds: stringList(source.speeds),
		family: typeof source.family === 'string' ? source.family : null,
		enabled,
		available: typeof source.available === 'boolean' ? source.available : enabled,
		verified: source.verified === true ? true : source.verified === false ? false : null,
		isDefault: source.isDefault === true
	};
};

export const normalizeLopuCatalogProvider = (raw: unknown): LopuCatalogProvider => {
	const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	return {
		configured: source.configured === true,
		verified: source.verified === true ? true : source.verified === false ? false : null,
		checkedAt: typeof source.checkedAt === 'string' && source.checkedAt ? source.checkedAt : null,
		reason: typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim().slice(0, 200) : null
	};
};

export const normalizeLopuCatalog = (raw: unknown): LopuCatalog => {
	const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const models = (Array.isArray(source.models) ? source.models : []).map(normalizeLopuCatalogModel).filter((model): model is LopuCatalogModel => !!model);
	const defaults = source.defaults && typeof source.defaults === 'object' ? (source.defaults as Record<string, unknown>) : {};
	const providersRaw = source.providers && typeof source.providers === 'object' ? (source.providers as Record<string, unknown>) : {};
	const providers: LopuCatalog['providers'] = {};
	for (const [name, value] of Object.entries(providersRaw)) {
		providers[name] = normalizeLopuCatalogProvider(value);
	}

	return {
		models,
		defaults: {
			model: idOrNull(defaults.model),
			effort: idOrNull(defaults.effort),
			speed: normalizeLopuSpeed(defaults.speed)
		},
		providers
	};
};

// The effort a freshly picked model should start on: the catalog default's
// effort when that model offers it, else 'high', else its deepest tier.
export const preferredLopuEffort = (model: LopuCatalogModel | null | undefined, preferred?: string | null): string | null => {
	if (!model?.efforts.length) {
		return null;
	}
	if (preferred && model.efforts.includes(preferred)) {
		return preferred;
	}
	if (model.efforts.includes('high')) {
		return 'high';
	}
	return model.efforts[model.efforts.length - 1] ?? null;
};

export const findLopuCatalogModel = (catalog: LopuCatalog, id: string | null | undefined): LopuCatalogModel | null => {
	if (!id) {
		return null;
	}
	return catalog.models.find((model) => model.id === id) ?? null;
};

// The effective { model, effort, speed } for a viewer: their preference when
// the catalog still offers it, otherwise the catalog defaults.
export const resolveLopuModelChoice = (catalog: LopuCatalog, settings: Pick<LopuSettings, 'model' | 'effort' | 'speed'>): LopuCatalogDefaults => {
	const preferred = findLopuCatalogModel(catalog, settings.model);
	const model = preferred?.available ? preferred : findLopuCatalogModel(catalog, catalog.defaults.model);

	if (!model) {
		return { model: settings.model ?? catalog.defaults.model, effort: settings.effort ?? catalog.defaults.effort, speed: settings.speed ?? catalog.defaults.speed };
	}

	const effort = preferred?.available && settings.effort && model.efforts.includes(settings.effort) ? settings.effort : preferredLopuEffort(model, catalog.defaults.effort);
	const speed = preferred?.available && settings.speed && model.speeds.includes(settings.speed) ? settings.speed : model.speeds.includes(catalog.defaults.speed || '') ? catalog.defaults.speed : null;

	return { model: model.id, effort, speed };
};

const EFFORT_LABELS: Record<string, string> = {
	none: 'None',
	minimal: 'Minimal',
	low: 'Low',
	medium: 'Medium',
	high: 'High',
	xhigh: 'Extra high',
	max: 'Max',
	ultra: 'Ultra'
};

export const describeLopuEffort = (effort: string | null | undefined): string | null => {
	if (!effort) {
		return null;
	}
	return EFFORT_LABELS[effort] ?? effort;
};

// Short human label for the window's model chip: "Claude Opus 5 · High ⚡".
export const describeLopuModelChoice = (catalog: LopuCatalog, settings: Pick<LopuSettings, 'model' | 'effort' | 'speed'>): string => {
	const choice = resolveLopuModelChoice(catalog, settings);
	const model = findLopuCatalogModel(catalog, choice.model);

	if (!choice.model) {
		return catalog.models.length ? 'No model' : 'Auto';
	}

	const bits = [model?.label ?? choice.model];
	const effort = describeLopuEffort(choice.effort);
	if (effort) {
		bits.push(effort);
	}
	return `${bits.join(' · ')}${choice.speed === 'fast' ? ' ⚡' : ''}`;
};

export const readLopuCatalogCache = (): LopuCatalog | null => {
	const raw = readLocalCache<unknown>(LOPU_CATALOG_CACHE_KEY) ?? readLocalCache<unknown>(LOPU_CHAT_STORE_MODELS_CACHE_KEY);
	return raw && typeof raw === 'object' ? normalizeLopuCatalog(raw) : null;
};

// Last-known catalog first (never a spinner over a known list), a background
// refetch while `active`, and the fresh copy cached for the next mount.
export const useLopuModelCatalog = (active = true) => {
	const api = useApi();
	const apiRef = React.useRef(api);
	apiRef.current = api;

	const [catalog, setCatalog] = React.useState<LopuCatalog | null>(readLopuCatalogCache);
	const [loading, setLoading] = React.useState(false);
	const [failed, setFailed] = React.useState(false);

	const refresh = React.useCallback(async () => {
		setLoading(true);
		try {
			const resp = await apiRef.current.v1.ai.models();
			if (!resp?.ok) {
				setFailed(true);
				return null;
			}
			const next = normalizeLopuCatalog(resp);
			setCatalog(next);
			setFailed(false);
			writeLocalCache(LOPU_CATALOG_CACHE_KEY, next);
			return next;
		} catch {
			setFailed(true);
			return null;
		} finally {
			setLoading(false);
		}
	}, []);

	React.useEffect(() => {
		if (!active) {
			return;
		}
		refresh();
	}, [active, refresh]);

	return {
		catalog: catalog ?? EMPTY_LOPU_CATALOG,
		hasCatalog: !!catalog,
		loading,
		failed,
		refresh,
		setCatalog
	};
};

// The /lopu page IS the chat — the floating host (and the navbar opener)
// stay out of its way. /lopu/voice is the same page in voice mode.
export const LOPU_PAGE_PATH = '/lopu';
export const LOPU_VOICE_PATH = '/lopu/voice';

export const isLopuHostHiddenOnPath = (pathname: string | null | undefined): boolean => {
	if (typeof pathname !== 'string') {
		return false;
	}
	return pathname === LOPU_PAGE_PATH || pathname.startsWith(`${LOPU_PAGE_PATH}/`);
};

export const isLopuVoicePath = (pathname: string | null | undefined): boolean => {
	return typeof pathname === 'string' && (pathname === LOPU_VOICE_PATH || pathname.startsWith(`${LOPU_VOICE_PATH}/`));
};
