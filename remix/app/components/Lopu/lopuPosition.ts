import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

// Where Lopu's messages pop up. The preference itself lives at
// thingtime.settings.lopu.position (see useLopuPosition) and is mirrored into
// the synchronous localStorage tier under this key, so useLopu can read it at
// fire time without subscribing its 86 callers (PostCard included) to the
// Thingtime context — a keystroke in an editor must not re-render every toast
// caller. The cache is also what a toast fired during boot reads, before the
// localforage blob has restored.

export const LOPU_POSITIONS = ['top-left', 'top', 'top-right', 'bottom-left', 'bottom', 'bottom-right'] as const;

export type LopuPosition = (typeof LOPU_POSITIONS)[number];

export const DEFAULT_LOPU_POSITION: LopuPosition = 'bottom-left';

export const LOPU_POSITION_LABELS: Record<LopuPosition, string> = {
	'top-left': 'Top left',
	top: 'Top centre',
	'top-right': 'Top right',
	'bottom-left': 'Bottom left',
	bottom: 'Bottom centre',
	'bottom-right': 'Bottom right'
};

export const LOPU_POSITION_CACHE_KEY = 'tt-lopu-position';

export const isLopuPosition = (value: unknown): value is LopuPosition =>
	typeof value === 'string' && (LOPU_POSITIONS as readonly string[]).includes(value);

export const normalizeLopuPosition = (value: unknown): LopuPosition => (isLopuPosition(value) ? value : DEFAULT_LOPU_POSITION);

export const readLopuPositionCache = (): LopuPosition => normalizeLopuPosition(readLocalCache<string>(LOPU_POSITION_CACHE_KEY));

export const writeLopuPositionCache = (position: LopuPosition): void => writeLocalCache(LOPU_POSITION_CACHE_KEY, position);

// Visual-only nav clearance for the top row: translateY keeps Chakra's tight
// stacking + slide/fade animation intact (marginTop would compound into gaps).
const NAV_OFFSET = 'translateY(70px)';

export type LopuContainerStyle = {
	transform?: string;
	width?: string;
	maxWidth?: string;
	minWidth?: number;
	display: 'flex';
	justifyContent: 'flex-start' | 'center' | 'flex-end';
	pointerEvents: 'none';
};

// Chakra anchors one fixed list per position (its own safe-area insets) and
// wraps each toast in a flex container we style here. Centre positions get a
// full-viewport flex container so the card centres by flow (immune to the
// ancestor-transform quirk that broke translateX(-50%)); corners shrink to the
// card and lean on the list's own edge. pointerEvents none keeps the wide
// invisible container from eating clicks (the card re-enables them).
export const lopuContainerStyle = (position: LopuPosition): LopuContainerStyle => {
	const edge = position.endsWith('-left') ? 'left' : position.endsWith('-right') ? 'right' : 'centre';
	return {
		...(position.startsWith('top') ? { transform: NAV_OFFSET } : {}),
		...(edge === 'centre' ? { width: '100vw', maxWidth: '100vw' } : { minWidth: 0 }),
		display: 'flex',
		justifyContent: edge === 'left' ? 'flex-start' : edge === 'right' ? 'flex-end' : 'center',
		pointerEvents: 'none'
	};
};

// The two Chakra toast options that place a Lopu toast; read the cache at
// fire time so a change in Settings applies to the very next message.
export const lopuToastPlacement = (position: LopuPosition = readLopuPositionCache()) => ({
	position,
	containerStyle: lopuContainerStyle(position)
});
