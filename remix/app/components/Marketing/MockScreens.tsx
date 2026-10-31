import React from 'react';

import { MK } from '~/components/Marketing/marketingTheme';
import type { MockScreenKey } from '~/marketing/types';
import { SCREEN_TARGETS } from '~/marketing/walkthroughs';

// Mock product screens the WalkthroughPlayer animates over. Every screen
// renders each of its SCREEN_TARGETS (marketing/walkthroughs.ts) exactly once
// as a `data-wt` attribute: the player resolves cursor positions from those
// attributes, so a target that went missing would leave the cursor parked.
// MockScreens.test.ts pins the two-way agreement. The screens are plain
// elements with inline styles (no Chakra) so they render identically inside
// the player and under react-dom/server in the tests, and every colour,
// radius and border comes from the --mk-* variables MarketingShell sets.

export type MockScreenProps = {
	screen: MockScreenKey;
	/** Target currently being clicked / held (walkthroughEngine.activeTargetFor). */
	active: string | null;
	/** Text typed so far per target (walkthroughEngine.typedTextFor). */
	typed: Record<string, string>;
};

type CSS = React.CSSProperties;
type ScreenState = { active: string | null; typed: Record<string, string> };

const ScreenContext = React.createContext<ScreenState>({ active: null, typed: {} });

export const MOCK_SCREEN_KEYS = Object.keys(SCREEN_TARGETS) as MockScreenKey[];

const hairline = `1px solid ${MK.hairline}`;

const S = {
	window: {
		fontFamily: MK.font,
		fontSize: 12,
		lineHeight: 1.35,
		color: MK.text,
		background: MK.bg,
		aspectRatio: '16 / 10',
		minHeight: 320,
		maxHeight: 540,
		width: '100%',
		display: 'flex',
		flexDirection: 'column',
		boxSizing: 'border-box',
		textAlign: 'left'
	} as CSS,
	chrome: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: hairline, background: MK.bg2, flex: '0 0 auto' } as CSS,
	nav: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: hairline, flex: '0 0 auto', minWidth: 0 } as CSS,
	body: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } as CSS,
	split: { flex: '1 1 auto', minHeight: 0, display: 'flex', overflow: 'hidden' } as CSS,
	sidebar: { flex: '0 0 124px', minWidth: 0, borderRight: hairline, padding: 8, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto' } as CSS,
	main: { flex: '1 1 auto', minWidth: 0, minHeight: 0, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } as CSS,
	card: { background: MK.cardSolid, border: MK.border, borderRadius: MK.radiusSm, padding: 8, minWidth: 0 } as CSS,
	panel: { background: MK.bg2, border: hairline, borderRadius: MK.radiusSm, padding: 8, minWidth: 0 } as CSS,
	row: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderRadius: MK.radiusSm, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as CSS,
	button: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: 4,
		padding: '5px 9px',
		borderRadius: MK.radiusSm,
		border: MK.border,
		background: MK.cardSolid,
		color: MK.ink,
		fontWeight: 600,
		whiteSpace: 'nowrap',
		flex: '0 0 auto'
	} as CSS,
	primary: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: 4,
		padding: '5px 10px',
		borderRadius: MK.radiusSm,
		border: '1px solid transparent',
		background: MK.accent,
		color: MK.accentContrast,
		fontWeight: 700,
		whiteSpace: 'nowrap',
		flex: '0 0 auto'
	} as CSS,
	chip: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: 4,
		padding: '2px 8px',
		borderRadius: 999,
		border: hairline,
		background: MK.tint,
		color: MK.ink,
		fontSize: 11,
		fontWeight: 600,
		whiteSpace: 'nowrap',
		flex: '0 0 auto'
	} as CSS,
	input: {
		display: 'flex',
		alignItems: 'center',
		gap: 2,
		minHeight: 28,
		padding: '5px 8px',
		borderRadius: MK.radiusSm,
		border: MK.border,
		background: MK.bg2,
		minWidth: 0,
		overflow: 'hidden',
		whiteSpace: 'nowrap'
	} as CSS,
	code: {
		fontFamily: MK.mono,
		fontSize: 11,
		lineHeight: 1.4,
		background: MK.ink,
		color: MK.bg,
		borderRadius: MK.radiusSm,
		padding: 8,
		whiteSpace: 'pre-wrap',
		wordBreak: 'break-word',
		minWidth: 0
	} as CSS,
	muted: { color: MK.muted } as CSS,
	strong: { color: MK.ink, fontWeight: 700 } as CSS,
	toolbar: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 } as CSS,
	grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 } as CSS
};

const ACTIVE: CSS = { outline: `2px solid ${MK.accent}`, outlineOffset: 2, boxShadow: `0 0 0 5px ${MK.tint}`, position: 'relative', zIndex: 1 };

const KIND_STYLE: Record<string, CSS> = {
	plain: {},
	input: S.input,
	button: S.button,
	primary: S.primary,
	chip: S.chip,
	row: S.row,
	card: S.card,
	panel: S.panel,
	code: S.code
};

const Caret = () => <span style={{ display: 'inline-block', width: 1.5, height: '1.1em', background: MK.accent, marginLeft: 1, verticalAlign: 'text-bottom' }} />;

type TargetProps = {
	/** The data-wt name (must be listed in SCREEN_TARGETS for the screen). */
	name: string;
	kind?: keyof typeof KIND_STYLE;
	/** Shown inside an `input` target until the walkthrough types into it. */
	placeholder?: string;
	style?: CSS;
	children?: React.ReactNode;
};

/** A walkthrough target: renders `data-wt`, the active ring, and any typed text. */
const Target = ({ name, kind = 'plain', placeholder, style, children }: TargetProps) => {
	const { active, typed } = React.useContext(ScreenContext);
	const text = typed[name];
	const base: CSS = { ...KIND_STYLE[kind], ...style, ...(active === name ? ACTIVE : null) };
	let content: React.ReactNode = children;
	if (kind === 'input') {
		content = text ? (
			<>
				<span style={{ color: MK.ink, overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
				<Caret />
			</>
		) : (
			<span style={S.muted}>{placeholder}</span>
		);
	} else if (text !== undefined) {
		content = (
			<>
				<span>{text}</span>
				<Caret />
			</>
		);
	}
	return (
		<div data-wt={name} data-wt-active={active === name ? '' : undefined} style={base}>
			{content}
		</div>
	);
};

const Dot = ({ colour }: { colour: string }) => <span style={{ width: 8, height: 8, borderRadius: '50%', background: colour, display: 'inline-block' }} />;

const Avatar = ({ label, size = 22 }: { label: string; size?: number }) => (
	<span
		style={{
			width: size,
			height: size,
			borderRadius: '50%',
			background: MK.accent2,
			color: MK.accentContrast,
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			fontSize: Math.round(size * 0.45),
			fontWeight: 700,
			flex: '0 0 auto'
		}}
	>
		{label}
	</span>
);

const Logo = () => (
	<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 800, color: MK.ink, flex: '0 0 auto' }}>
		<span style={{ width: 12, height: 12, borderRadius: 3, background: `linear-gradient(135deg, ${MK.accent}, ${MK.accent2})`, display: 'inline-block' }} />
		thingtime
	</span>
);

const Chrome = ({ path }: { path: string }) => (
	<div style={S.chrome}>
		<Dot colour="#ff5f57" />
		<Dot colour="#febc2e" />
		<Dot colour="#28c840" />
		<span style={{ ...S.input, minHeight: 20, padding: '2px 8px', flex: '1 1 auto', fontSize: 11, color: MK.muted, marginLeft: 6 }}>thingtime.com{path}</span>
	</div>
);

const Nav = ({ children }: { children?: React.ReactNode }) => (
	<div style={S.nav}>
		<Logo />
		<span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</span>
		<Avatar label="N" />
	</div>
);

const Media = ({ label, height = 56 }: { label: string; height?: number }) => (
	<div
		style={{
			height,
			borderRadius: MK.radiusSm,
			background: `linear-gradient(135deg, ${MK.tint}, ${MK.accent2}55)`,
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			color: MK.muted,
			fontSize: 11
		}}
	>
		{label}
	</div>
);

const Check = ({ on }: { on: boolean }) => (
	<span
		style={{
			width: 13,
			height: 13,
			borderRadius: 3,
			border: `1.5px solid ${on ? MK.accent : MK.muted}`,
			background: on ? MK.accent : 'transparent',
			color: MK.accentContrast,
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			fontSize: 9,
			flex: '0 0 auto'
		}}
	>
		{on ? '✓' : ''}
	</span>
);

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

const FeedScreen = () => (
	<>
		<Chrome path="/" />
		<Nav>
			<Target name="nav-search" kind="input" placeholder="Imagine…" style={{ flex: '1 1 auto', maxWidth: 220 }} />
			<Target name="drawer-trigger" kind="button" style={{ padding: '4px 7px' }}>
				☰
			</Target>
		</Nav>
		<div style={S.body}>
			<div style={S.toolbar}>
				<Target name="algorithm-picker" kind="chip">
					✨ For you ▾
				</Target>
				<span style={S.chip}>🔥 Trending</span>
				<span style={S.chip}>👥 Friends</span>
			</div>
			<div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 6 }}>
				<Target name="composer" kind="input" placeholder="What's on your mind?" style={{ minHeight: 40, alignItems: 'flex-start', whiteSpace: 'normal' }} />
				<div style={S.toolbar}>
					<Target name="composer-media" kind="button">
						🖼 Media
					</Target>
					<Target name="composer-poll" kind="button">
						📊 Poll
					</Target>
					<Target name="composer-audience" kind="chip">
						🌍 Everyone ▾
					</Target>
					<span style={{ flex: '1 1 auto' }} />
					<Target name="composer-post" kind="primary">
						Post
					</Target>
				</div>
			</div>
			<Target name="post-1" kind="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<Avatar label="A" size={20} />
					<span style={S.strong}>Ada</span>
					<span style={S.muted}>· 2m</span>
				</div>
				<div>Moved my car notes into a thing, finally. Repairs, km, insurance — one tree.</div>
				<div style={S.toolbar}>
					<Target name="post-1-react" kind="chip">
						👍 12
					</Target>
					<Target name="post-1-comment" kind="chip">
						💬 3
					</Target>
					<Target name="post-1-repost" kind="chip">
						🔁 1
					</Target>
					<span style={{ flex: '1 1 auto' }} />
					<Target name="post-1-menu" kind="button" style={{ padding: '2px 7px' }}>
						⋯
					</Target>
				</div>
			</Target>
			<Target name="post-2" kind="card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<Avatar label="L" size={20} />
					<span style={S.strong}>Lopu</span>
					<span style={S.muted}>· 1h</span>
				</div>
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
					<span>The theme gallery is live — wear anyone's look.</span>
					<Target name="hashtag" kind="chip" style={{ background: 'transparent', color: MK.accent, borderColor: 'transparent', padding: 0 }}>
						#themes
					</Target>
				</div>
				<Media label="🎨 gallery preview" height={44} />
			</Target>
		</div>
	</>
);

const TreeRow = ({ name, depth, children, chevron, kind = 'row', style }: { name: string; depth: number; children: React.ReactNode; chevron?: string; kind?: TargetProps['kind']; style?: CSS }) => (
	<Target name={name} kind={kind} style={{ paddingLeft: 7 + depth * 14, ...style }}>
		{chevron ? <span style={{ ...S.muted, width: 10, display: 'inline-block' }}>{chevron}</span> : null}
		{children}
	</Target>
);

const ThingsScreen = () => (
	<>
		<Chrome path="/things" />
		<Nav>
			<Target name="search" kind="input" placeholder="Search things…" style={{ flex: '1 1 auto', maxWidth: 200 }} />
		</Nav>
		<div style={S.body}>
			<div style={S.toolbar}>
				<span style={{ display: 'inline-flex', border: hairline, borderRadius: MK.radiusSm, overflow: 'hidden' }}>
					<Target name="mode-view" kind="button" style={{ border: 'none', borderRadius: 0, background: MK.tint }}>
						View
					</Target>
					<Target name="mode-edit" kind="button" style={{ border: 'none', borderRadius: 0 }}>
						Edit
					</Target>
					<Target name="mode-editor" kind="button" style={{ border: 'none', borderRadius: 0 }}>
						Editor
					</Target>
				</span>
				<span style={{ flex: '1 1 auto' }} />
				<Target name="share" kind="button">
					🔗 Share
				</Target>
			</div>
			<div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}>
				<TreeRow name="tree-root" depth={0} chevron="▾">
					<span style={S.strong}>🌳 things</span>
					<span style={S.muted}>14 branches</span>
				</TreeRow>
				<TreeRow name="branch-car" depth={1} chevron="▾">
					🚗 car
				</TreeRow>
				<TreeRow name="branch-repairs" depth={2} chevron="▸">
					🔧 repairs <span style={S.muted}>3</span>
				</TreeRow>
				<TreeRow name="value-km" depth={2}>
					<span style={S.muted}>km:</span>
					<span style={{ ...S.strong, borderBottom: `1px dashed ${MK.accent}` }}>84,210</span>
				</TreeRow>
				<TreeRow name="folder-recipes" depth={1} chevron="▸">
					📁 recipes <span style={S.muted}>22</span>
				</TreeRow>
				<div style={{ ...S.row, paddingLeft: 21, color: MK.muted }}>📝 trip notes</div>
				<Target name="context-menu" kind="panel" style={{ position: 'absolute', right: 10, top: 34, width: 118, padding: 4, boxShadow: MK.shadow, display: 'flex', flexDirection: 'column', gap: 1 }}>
					<div style={S.row}>✏️ Rename</div>
					<div style={S.row}>📋 Duplicate</div>
					<div style={S.row}>🔗 Share</div>
					<div style={{ ...S.row, color: '#d33' }}>🗑 Delete</div>
				</Target>
			</div>
			<div style={S.toolbar}>
				<Target name="add-input" kind="input" placeholder="Add a thing…" style={{ flex: '1 1 160px' }} />
				<Target name="add-button" kind="primary">
					+ Add
				</Target>
			</div>
		</div>
	</>
);

const BuilderScreen = () => (
	<>
		<Chrome path="/builder" />
		<Nav>
			<Target name="add-block" kind="button">
				+ Block
			</Target>
			<Target name="preview" kind="button">
				👁 Preview
			</Target>
			<span style={{ flex: '1 1 auto' }} />
			<Target name="publish" kind="primary">
				Publish
			</Target>
		</Nav>
		<div style={S.split}>
			<Target name="canvas" kind="plain" style={{ ...S.main, gap: 6, position: 'relative' }}>
				<Target name="blocks-menu" kind="panel" style={{ position: 'absolute', left: 10, top: 8, width: 110, padding: 4, boxShadow: MK.shadow, display: 'flex', flexDirection: 'column', gap: 1, zIndex: 2 }}>
					<div style={S.row}>🦸 Hero</div>
					<div style={S.row}>📝 Text</div>
					<div style={S.row}>🖼 Media</div>
					<div style={S.row}>▦ Grid</div>
				</Target>
				<div style={{ height: 28 }} />
				<Target name="block-hero" kind="card" style={{ textAlign: 'center', padding: 14, fontSize: 16, fontWeight: 800, color: MK.ink }}>
					A GUI for the internet.
				</Target>
				<Target name="block-text" kind="card">
					Thingtime keeps anything you care about — notes, cars, tools, ideas — as living, shareable things.
				</Target>
				<Target name="block-media" kind="card" style={{ padding: 4 }}>
					<Media label="🖼 media block" height={40} />
				</Target>
				<Target name="media-drop" kind="panel" style={{ border: `1px dashed ${MK.accent}`, textAlign: 'center', color: MK.muted, padding: 10 }}>
					Drop media anywhere
				</Target>
			</Target>
			<Target name="inspector" kind="plain" style={{ ...S.sidebar, borderRight: 'none', borderLeft: hairline, flexBasis: 118 }}>
				<div style={S.strong}>Inspector</div>
				<div style={S.muted}>Hero</div>
				<Target name="inspector-padding" kind="input" style={{ minHeight: 24 }}>
					<span style={S.muted}>Padding</span>
					<span style={{ flex: '1 1 auto' }} />
					<span style={S.strong}>24</span>
				</Target>
				<div style={{ ...S.input, minHeight: 24 }}>
					<span style={S.muted}>Align</span>
					<span style={{ flex: '1 1 auto' }} />
					<span style={S.strong}>centre</span>
				</div>
				<div style={{ ...S.input, minHeight: 24 }}>
					<span style={S.muted}>Width</span>
					<span style={{ flex: '1 1 auto' }} />
					<span style={S.strong}>720</span>
				</div>
			</Target>
		</div>
	</>
);

const Bubble = ({ mine, children, style }: { mine?: boolean; children: React.ReactNode; style?: CSS }) => (
	<div
		style={{
			alignSelf: mine ? 'flex-end' : 'flex-start',
			maxWidth: '78%',
			padding: '6px 9px',
			borderRadius: MK.radiusSm,
			background: mine ? MK.accent : MK.cardSolid,
			color: mine ? MK.accentContrast : MK.text,
			border: mine ? '1px solid transparent' : MK.border,
			...style
		}}
	>
		{children}
	</div>
);

const MessagesScreen = () => (
	<>
		<Chrome path="/messages" />
		<Nav>
			<span style={{ ...S.strong, fontSize: 13 }}>Messages</span>
		</Nav>
		<div style={S.split}>
			<div style={S.sidebar}>
				<Target name="new-space" kind="button" style={{ justifyContent: 'center' }}>
					+ New space
				</Target>
				<div style={{ ...S.muted, fontSize: 10, letterSpacing: 0.6, marginTop: 4 }}>SPACES</div>
				<Target name="space-1" kind="row" style={{ background: MK.tint }}>
					🪐 design
				</Target>
				<div style={S.row}>🎧 music</div>
				<div style={{ ...S.muted, fontSize: 10, letterSpacing: 0.6, marginTop: 4 }}>CHATS</div>
				<Target name="chat-1" kind="row">
					<Avatar label="A" size={16} /> Ada
				</Target>
				<div style={S.row}>
					<Avatar label="K" size={16} /> Kai
				</div>
			</div>
			<div style={S.main}>
				<div style={S.toolbar}>
					<span style={{ ...S.chip, background: MK.accent, color: MK.accentContrast }}>Inbox</span>
					<Target name="requests-tab" kind="chip">
						Requests · 2
					</Target>
				</div>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 auto' }}>
					<Target name="message-1" kind="plain" style={{ alignSelf: 'flex-start', maxWidth: '78%' }}>
						<Bubble>Have you tried the new tree editor? 🌳</Bubble>
					</Target>
					<Bubble mine>Yes — every message is a thing now.</Bubble>
					<Bubble>Reactions on messages work too 🎉</Bubble>
				</div>
				<div style={S.toolbar}>
					<Target name="composer" kind="input" placeholder="Message #design…" style={{ flex: '1 1 140px' }} />
					<Target name="send" kind="primary">
						Send ➤
					</Target>
				</div>
			</div>
		</div>
	</>
);

const Swatch = ({ colour, active }: { colour: string; active?: boolean }) => (
	<span style={{ width: 16, height: 16, borderRadius: '50%', background: colour, border: active ? `2px solid ${MK.ink}` : hairline, display: 'inline-block' }} />
);

const ThemesScreen = () => (
	<>
		<Chrome path="/themes" />
		<Nav>
			<span style={{ ...S.strong, fontSize: 13 }}>Themes</span>
			<span style={{ flex: '1 1 auto' }} />
			<Target name="gallery" kind="button">
				🖼 Gallery
			</Target>
		</Nav>
		<div style={S.body}>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
				<Target name="preset-fable" kind="card" style={{ borderWidth: 2 }}>
					<div style={{ height: 34, borderRadius: 4, background: '#fff6d6', border: '2px solid #16161a', boxShadow: '3px 3px 0 #16161a', marginBottom: 6 }} />
					<div style={S.strong}>Fable</div>
					<div style={S.muted}>brutalist landing</div>
				</Target>
				<Target name="preset-prism" kind="card">
					<div style={{ height: 34, borderRadius: 8, background: 'linear-gradient(135deg, #e9f0ff, #f6e9ff)', marginBottom: 6 }} />
					<div style={S.strong}>Prism</div>
					<div style={S.muted}>refined product</div>
				</Target>
			</div>
			<div style={{ ...S.panel, display: 'flex', flexDirection: 'column', gap: 6 }}>
				<Target name="token-accent" kind="row" style={{ justifyContent: 'space-between' }}>
					<span>Accent</span>
					<span style={{ display: 'inline-flex', gap: 4 }}>
						<Swatch colour="#f34a4a" />
						<Swatch colour="#ffbc48" />
						<Swatch colour="#58ca70" active />
						<Swatch colour="#47b5e6" />
						<Swatch colour="#a555e8" />
					</span>
				</Target>
				<Target name="token-radius" kind="row" style={{ justifyContent: 'space-between' }}>
					<span>Radius</span>
					<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
						<span style={{ width: 70, height: 4, borderRadius: 2, background: MK.hairline, position: 'relative', display: 'inline-block' }}>
							<span style={{ position: 'absolute', left: 38, top: -4, width: 12, height: 12, borderRadius: '50%', background: MK.accent }} />
						</span>
						<span style={S.strong}>12</span>
					</span>
				</Target>
				<div style={{ ...S.row, justifyContent: 'space-between' }}>
					<span>Shadow</span>
					<span style={S.strong}>hard</span>
				</div>
			</div>
			<div style={S.toolbar}>
				<Target name="save" kind="primary">
					Save theme
				</Target>
				<Target name="try-on" kind="button">
					👗 Try on
				</Target>
				<span style={{ flex: '1 1 auto' }} />
				<Target name="share-id" kind="chip" style={{ fontFamily: MK.mono, fontWeight: 500 }}>
					id: fable-9x2
				</Target>
			</div>
		</div>
	</>
);

const ComponentsScreen = () => (
	<>
		<Chrome path="/components" />
		<Nav>
			<Target name="search" kind="input" placeholder="Search 1,000 components…" style={{ flex: '1 1 auto', maxWidth: 240 }} />
		</Nav>
		<div style={S.split}>
			<div style={{ ...S.sidebar, flexBasis: 132, gap: 6 }}>
				<Target name="card-1" kind="card" style={{ background: MK.tint }}>
					<Media label="🦸" height={28} />
					<div style={{ ...S.strong, marginTop: 4 }}>Hero · Centered</div>
					<div style={S.muted}>section</div>
				</Target>
				<Target name="card-2" kind="card">
					<Media label="💳" height={28} />
					<div style={{ ...S.strong, marginTop: 4 }}>Pricing table</div>
					<div style={S.muted}>section</div>
				</Target>
				<div style={S.card}>
					<Media label="📊" height={28} />
					<div style={{ ...S.strong, marginTop: 4 }}>Stats row</div>
					<div style={S.muted}>section</div>
				</div>
			</div>
			<div style={S.main}>
				<div style={S.toolbar}>
					<span style={{ ...S.chip, background: MK.accent, color: MK.accentContrast }}>Preview</span>
					<span style={S.chip}>Args</span>
					<Target name="docs-tab" kind="chip">
						Docs
					</Target>
					<span style={{ flex: '1 1 auto' }} />
					<Target name="install" kind="primary">
						Install
					</Target>
				</div>
				<Target name="demo" kind="card" style={{ textAlign: 'center', padding: 12 }}>
					<div style={{ fontSize: 15, fontWeight: 800, color: MK.ink }}>Everything is a thing.</div>
					<div style={S.muted}>Posts, pages, schemas and actions share one grammar.</div>
				</Target>
				<Target name="args" kind="panel" style={{ fontFamily: MK.mono, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3 }}>
					<div>
						<span style={S.strong}>title</span>
						<span style={S.muted}> string · max 80</span>
					</div>
					<div>
						<span style={S.strong}>align</span>
						<span style={S.muted}> enum · left | centre</span>
					</div>
					<div>
						<span style={S.strong}>cta</span>
						<span style={S.muted}> action · optional</span>
					</div>
				</Target>
			</div>
		</div>
	</>
);

const SettingsScreen = () => (
	<>
		<Chrome path="/settings" />
		<Nav>
			<span style={{ ...S.strong, fontSize: 13 }}>Settings</span>
			<span style={{ flex: '1 1 auto' }} />
			<Target name="switcher" kind="chip">
				<Avatar label="N" size={14} /> nikolaj ▾
			</Target>
		</Nav>
		<div style={S.split}>
			<div style={S.sidebar}>
				<div style={S.row}>👤 Profile</div>
				<Target name="tokens" kind="row" style={{ background: MK.tint }}>
					🔑 Tokens
				</Target>
				<Target name="passkeys" kind="row">
					🪪 Passkeys
				</Target>
				<Target name="notifications" kind="row">
					🔔 Notifications
				</Target>
				<Target name="devices" kind="row">
					📱 Devices
				</Target>
				<Target name="apps" kind="row">
					🧩 Apps
				</Target>
			</div>
			<div style={S.main}>
				<div style={S.toolbar}>
					<span style={{ ...S.strong, fontSize: 13 }}>Personal access tokens</span>
					<span style={{ flex: '1 1 auto' }} />
					<Target name="mint" kind="primary">
						Mint token
					</Target>
				</div>
				<div style={{ ...S.panel, display: 'flex', flexDirection: 'column', gap: 4 }}>
					<div style={S.muted}>Scopes</div>
					<Target name="scope-read" kind="row">
						<Check on /> things:read
					</Target>
					<Target name="scope-write" kind="row">
						<Check on={false} /> things:write
					</Target>
					<div style={S.row}>
						<Check on={false} /> profile:read
					</div>
				</div>
				<div style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 6 }}>
					<span style={S.strong}>Passkeys</span>
					<span style={S.muted}>MacBook · iPhone</span>
					<span style={{ flex: '1 1 auto' }} />
					<Target name="passkey-add" kind="button">
						+ Add passkey
					</Target>
				</div>
			</div>
		</div>
	</>
);

const DeveloperScreen = () => (
	<>
		<Chrome path="/docs/api" />
		<Nav>
			<span style={{ ...S.strong, fontSize: 13 }}>Developers</span>
			<span style={{ flex: '1 1 auto' }} />
			<Target name="status" kind="chip" style={{ color: '#1a8f3c' }}>
				● all systems go
			</Target>
		</Nav>
		<div style={S.body}>
			<div style={S.toolbar}>
				<Target name="endpoint" kind="chip" style={{ fontFamily: MK.mono, fontWeight: 600 }}>
					GET /api/v1/things
				</Target>
				<Target name="manifest" kind="chip">
					📜 manifest
				</Target>
				<Target name="mcp" kind="chip">
					🔌 MCP
				</Target>
				<Target name="tests" kind="chip">
					✅ 212 tests
				</Target>
			</div>
			<Target name="curl" kind="code">
				{"curl https://thingtime.com/api/v1/things?limit=2 \\\n  -H 'Authorization: Bearer tt_pat_…'"}
			</Target>
			<div style={S.toolbar}>
				<Target name="run" kind="primary">
					▶ Run
				</Target>
				<span style={S.muted}>200 · 84 ms</span>
			</div>
			<Target name="response" kind="code" style={{ background: MK.bg2, color: MK.ink, border: hairline }}>
				{'{ "ok": true, "things": [\n  { "id": "car", "km": 84210 },\n  { "id": "recipes", "count": 22 } ] }'}
			</Target>
		</div>
	</>
);

const SearchScreen = () => (
	<>
		<Chrome path="/search" />
		<Nav>
			<span style={S.muted}>⌘K anywhere</span>
		</Nav>
		<div style={{ ...S.body, alignItems: 'stretch' }}>
			<div style={{ ...S.card, padding: 6, boxShadow: MK.shadow, display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420, width: '100%', alignSelf: 'center' }}>
				<Target name="palette" kind="input" placeholder="Search or run a command…" style={{ minHeight: 32, fontSize: 13 }} />
				<div style={{ ...S.muted, fontSize: 10, letterSpacing: 0.6, padding: '4px 7px 0' }}>RESULTS</div>
				<Target name="result-1" kind="row" style={{ background: MK.tint, justifyContent: 'space-between' }}>
					<span>🚗 car</span>
					<span style={S.muted}>things / car</span>
				</Target>
				<Target name="result-2" kind="row" style={{ justifyContent: 'space-between' }}>
					<span>📝 Trip notes</span>
					<span style={S.muted}>post · 2d</span>
				</Target>
				<div style={{ ...S.muted, fontSize: 10, letterSpacing: 0.6, padding: '4px 7px 0' }}>COMMANDS</div>
				<Target name="command" kind="row" style={{ justifyContent: 'space-between' }}>
					<span>🎨 Switch theme → Prism</span>
					<span style={S.chip}>⌘⇧T</span>
				</Target>
				<div style={{ ...S.toolbar, padding: '4px 7px', borderTop: hairline, marginTop: 2 }}>
					<Target name="open" kind="chip">
						↵ Open
					</Target>
					<span style={S.muted}>↑↓ move · esc close</span>
				</div>
			</div>
		</div>
	</>
);

const ProfileScreen = () => (
	<>
		<Chrome path="/nikolaj" />
		<Nav>
			<span style={S.muted}>@nikolaj</span>
		</Nav>
		<div style={S.body}>
			<Target name="header" kind="card" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
				<Avatar label="N" size={32} />
				<span style={{ minWidth: 0, flex: '1 1 120px' }}>
					<div style={{ ...S.strong, fontSize: 13 }}>Nikolaj</div>
					<div style={S.muted}>Building a GUI for the internet 🌈</div>
				</span>
				<Target name="follow" kind="primary">
					Follow
				</Target>
				<Target name="try-on" kind="button">
					👗 Try on theme
				</Target>
			</Target>
			<Target name="heatmap" kind="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(26, 1fr)', gap: 2 }}>
				{Array.from({ length: 78 }, (_, index) => (
					<span key={index} style={{ aspectRatio: '1 / 1', borderRadius: 2, background: (index * 7) % 5 === 0 ? MK.accent : (index * 3) % 4 === 0 ? MK.accent2 : MK.tint, display: 'block' }} />
				))}
			</Target>
			<Target name="gallery" kind="panel" style={{ ...S.grid, gridTemplateColumns: 'repeat(4, 1fr)' }}>
				<Target name="media-1" kind="plain">
					<Media label="🖼" height={44} />
				</Target>
				<Media label="🎥" height={44} />
				<Media label="🖼" height={44} />
				<Media label="🎨" height={44} />
			</Target>
			<Target name="post-1" kind="card">
				<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
					<Avatar label="N" size={18} />
					<span style={S.strong}>Nikolaj</span>
					<span style={S.muted}>· 3h</span>
				</div>
				Shipped the components library — 1,000 blocks, one grammar.
			</Target>
		</div>
	</>
);

export const MOCK_SCREENS: Record<MockScreenKey, () => React.ReactElement> = {
	feed: FeedScreen,
	things: ThingsScreen,
	builder: BuilderScreen,
	messages: MessagesScreen,
	themes: ThemesScreen,
	components: ComponentsScreen,
	settings: SettingsScreen,
	developer: DeveloperScreen,
	search: SearchScreen,
	profile: ProfileScreen
};

/** A mock product screen with its walkthrough targets; decorative for assistive tech (the player narrates). */
export const MockScreen = ({ screen, active, typed }: MockScreenProps) => {
	const Screen = MOCK_SCREENS[screen] ?? FeedScreen;
	const state = React.useMemo<ScreenState>(() => ({ active, typed }), [active, typed]);
	return (
		<ScreenContext.Provider value={state}>
			<div aria-hidden="true" data-mock-screen={screen} style={S.window}>
				<Screen />
			</div>
		</ScreenContext.Provider>
	);
};
