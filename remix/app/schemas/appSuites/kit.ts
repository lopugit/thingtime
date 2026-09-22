// The shared authoring kit for the APP SUITES (schemas/appSuites/*): one
// small vocabulary for the three layers every app is written in —
//
//   render   HtmlThingRenderer element templates (tags + inline styles +
//            the ttIf / ttEach / ttFormat / ttMap wrappers, `{token}` text,
//            ttAction controls, named fields, tt-upload)
//   steps    action-grammar step values ({ ttExpr } over the closed
//            catalogue, $refs, the search/get/create/update/delete ops)
//   pages    builder blocks (demoBlockKit) composing the components with a
//            data binding (`source`) onto /p/<pageKey> pages
//
// Nothing here widens what a hand-written component or action could do: the
// kit only writes the same JSON an author would type into the builder, so
// every app stays a faithful "you could have built this yourself" demo.

import type { BehaviourSuite, SuiteRefs } from '../behaviourSuites.ts';
import { demoBlockKit, type DemoBlock, type DemoBlockCtx } from '../webpageDemos.ts';

export type Node = Record<string, unknown>;
export type Style = Record<string, unknown>;

// ── theme ───────────────────────────────────────────────────────────────────
export type Theme = {
	font: string;
	bg: string;
	surface: string;
	ink: string;
	text: string;
	muted: string;
	accent: string;
	accentInk: string;
	border: string;
	soft: string;
	danger: string;
	ok: string;
	radius: string;
};

export const SYSTEM_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif";
export const MONO_FONT = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

export const makeTheme = (overrides: Partial<Theme> = {}): Theme => ({
	font: SYSTEM_FONT,
	bg: '#fafafb',
	surface: '#ffffff',
	ink: '#16161a',
	text: '#4a4a55',
	muted: '#8a8a96',
	accent: '#16161a',
	accentInk: '#ffffff',
	border: '#e6e6ec',
	soft: '#f1f1f4',
	danger: '#d24343',
	ok: '#1f9d61',
	radius: '14px',
	...overrides
});

// ── render helpers ──────────────────────────────────────────────────────────
export const el = (tag: string, style: Style = {}, children: unknown[] = [], props: Record<string, unknown> = {}): Node => ({
	tag,
	props: { ...props, ...(Object.keys(style).length ? { style } : {}) },
	children
});

export const whenState = (state: string, then: unknown, otherwise?: unknown): Node => ({ ttIf: { arg: 'state', equals: state, then, ...(otherwise !== undefined ? { else: otherwise } : {}) } });
export const ifTruthy = (arg: string, then: unknown, otherwise?: unknown): Node => ({ ttIf: { arg, then, ...(otherwise !== undefined ? { else: otherwise } : {}) } });
export const ifEquals = (arg: string, value: string | number | boolean, then: unknown, otherwise?: unknown): Node => ({ ttIf: { arg, equals: value, then, ...(otherwise !== undefined ? { else: otherwise } : {}) } });
export const ifOp = (arg: string, op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'includes' | 'empty' | 'notEmpty', value: unknown, then: unknown, otherwise?: unknown): Node => ({
	ttIf: { arg, op, value, then, ...(otherwise !== undefined ? { else: otherwise } : {}) }
});
export const each = (arg: string, node: unknown, options: { max?: number; empty?: unknown } = {}): Node => ({ ttEach: { arg, node, ...options } });
export const fmt = (arg: string, kind: 'upper' | 'lower' | 'capitalize' | 'number' | 'fixed' | 'percent' | 'ordinal' | 'date' | 'time' | 'datetime' | 'weekday' | 'json', digits?: number): Node => ({
	ttFormat: { arg, kind, ...(digits !== undefined ? { digits } : {}) }
});
export const pick = (arg: string, values: Record<string, unknown>, fallback: unknown): Node => ({ ttMap: { arg, values, default: fallback } });

export type Kit = ReturnType<typeof makeKit>;

// Everything theme-bound. Components call `makeKit(theme)` once at module
// scope and compose from the returned helpers.
export const makeKit = (t: Theme) => {
	const text = (content: unknown, style: Style = {}): Node => el('div', { fontFamily: t.font, color: t.text, fontSize: '14px', lineHeight: 1.5, ...style }, [content]);
	const strong = (content: unknown, style: Style = {}): Node => text(content, { color: t.ink, fontWeight: 700, ...style });
	const title = (content: unknown, style: Style = {}): Node => text(content, { color: t.ink, fontWeight: 800, fontSize: '22px', lineHeight: 1.2, letterSpacing: '-0.01em', ...style });
	const muted = (content: unknown, style: Style = {}): Node => text(content, { color: t.muted, fontSize: '13px', ...style });
	const label = (content: unknown, style: Style = {}): Node => text(content, { fontSize: '11px', color: t.muted, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, ...style });
	const card = (children: unknown[], style: Style = {}): Node =>
		el('div', { background: t.surface, border: `1px solid ${t.border}`, borderRadius: t.radius, padding: '16px 18px', display: 'grid', gap: '10px', boxSizing: 'border-box', ...style }, children);
	const soft = (children: unknown[], style: Style = {}): Node => el('div', { background: t.soft, borderRadius: t.radius, padding: '12px 14px', display: 'grid', gap: '8px', ...style }, children);
	const row = (children: unknown[], style: Style = {}): Node => el('div', { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', ...style }, children);
	const stack = (children: unknown[], style: Style = {}): Node => el('div', { display: 'grid', gap: '8px', ...style }, children);
	const grid = (children: unknown[], min = 160, style: Style = {}): Node => el('div', { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: '10px', ...style }, children);
	const divider = (): Node => el('hr', { border: 'none', borderTop: `1px solid ${t.border}`, margin: '4px 0' });
	const pill = (content: unknown, style: Style = {}): Node =>
		el('span', { display: 'inline-block', fontFamily: t.font, fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', background: t.soft, color: t.ink, whiteSpace: 'nowrap', ...style }, [content]);
	const buttonStyle = (tone: 'solid' | 'ghost' | 'danger' | 'ok' | 'soft', style: Style = {}): Style => ({
		fontFamily: t.font,
		fontSize: '13px',
		fontWeight: 700,
		padding: '9px 14px',
		borderRadius: '999px',
		cursor: 'pointer',
		whiteSpace: 'nowrap',
		lineHeight: 1.2,
		border: `1px solid ${tone === 'solid' ? t.accent : tone === 'danger' ? t.danger : tone === 'ok' ? t.ok : t.border}`,
		background: tone === 'solid' ? t.accent : tone === 'danger' ? t.danger : tone === 'ok' ? t.ok : tone === 'soft' ? t.soft : t.surface,
		color: tone === 'solid' || tone === 'danger' || tone === 'ok' ? '#ffffff' : t.ink,
		...style
	});
	// a control: ttAction names the action KEY (owner-scoped); ttActionInputs
	// are the static inputs, named fields in the closest fieldset win
	const button = (content: unknown, action: string, inputs: Record<string, unknown> = {}, tone: 'solid' | 'ghost' | 'danger' | 'ok' | 'soft' = 'solid', style: Style = {}): Node => ({
		tag: 'button',
		props: { type: 'button', style: buttonStyle(tone, style) },
		ttAction: action,
		ttActionInputs: inputs,
		children: [content]
	});
	const link = (content: unknown, href: string, tone: 'solid' | 'ghost' | 'soft' = 'ghost', style: Style = {}): Node =>
		el('a', { ...buttonStyle(tone, style), textDecoration: 'none', display: 'inline-block' }, [content], { href });
	const textLink = (content: unknown, href: string, style: Style = {}): Node => el('a', { fontFamily: t.font, color: t.ink, fontWeight: 600, fontSize: '13px', textDecoration: 'underline', textUnderlineOffset: '3px', ...style }, [content], { href });
	const inputStyle: Style = { fontFamily: t.font, fontSize: '14px', padding: '9px 11px', border: `1px solid ${t.border}`, borderRadius: '10px', background: t.surface, color: t.ink, width: '100%', boxSizing: 'border-box' };
	const input = (name: string, props: Record<string, unknown> = {}, style: Style = {}): Node => ({ tag: 'input', props: { name, style: { ...inputStyle, ...style }, ...props } });
	const textarea = (name: string, props: Record<string, unknown> = {}, style: Style = {}): Node => ({ tag: 'textarea', props: { name, rows: 3, style: { ...inputStyle, resize: 'vertical', ...style }, ...props } });
	const option = (value: string, content: unknown, selected?: unknown): Node => ({ tag: 'option', props: { value, ...(selected !== undefined ? { selected } : {}) }, children: [content] });
	const select = (name: string, options: Array<[string, string]>, props: Record<string, unknown> = {}): Node => ({
		tag: 'select',
		props: { name, style: inputStyle, ...props },
		children: options.map(([value, content]) => option(value, content))
	});
	const checkbox = (name: string, content: unknown, props: Record<string, unknown> = {}): Node =>
		el('label', { display: 'flex', gap: '8px', alignItems: 'center', fontFamily: t.font, fontSize: '14px', color: t.ink }, [{ tag: 'input', props: { type: 'checkbox', name, ...props } }, content]);
	const field = (heading: unknown, control: Node, hint?: unknown): Node => el('label', { display: 'grid', gap: '5px' }, [label(heading), control, ...(hint ? [muted(hint, { fontSize: '12px' })] : [])]);
	// a FORM GROUP — a control inside reads only this group's named fields
	const group = (children: unknown[], style: Style = {}): Node => el('fieldset', { border: 'none', margin: 0, padding: 0, minWidth: 0, display: 'grid', gap: '10px', ...style }, children);
	const upload = (name: string, props: Record<string, unknown> = {}): Node => ({ tag: 'tt-upload', props: { name, ...props } });
	// a NATIVE <dialog> (PR #870): the trigger button is rendered by the runtime
	// from `name`; the children stay inside the component DOM, so a ttAction
	// control in them delegates exactly like one on the page
	const dialog = (name: string, title: string, children: unknown[]): Node => ({ tag: 'tt-dialog', props: { name, title }, children });
	// a destructive control behind a confirmation dialog
	const confirmButton = (name: string, title: string, blurb: unknown, control: Node): Node => dialog(name, title, [el('div', { display: 'grid', gap: '12px', fontFamily: t.font, color: t.text, fontSize: '14px' }, [blurb, row([control])])]);
	// a NATIVE countdown (PR #870): seconds, start/pause/reset handled by the runtime
	const countdown = (seconds: number | string): Node => ({ tag: 'tt-countdown', props: { value: seconds } });
	// a LOCAL control ($ui, PR #870): changes bounded scalar state in this
	// component instance only — no run, no sign-in — and the template reads the
	// key back like an arg
	const localButton = (content: unknown, input: Record<string, unknown>, tone: 'solid' | 'ghost' | 'danger' | 'ok' | 'soft' = 'ghost', style: Style = {}): Node => ({ tag: 'button', props: { type: 'button', style: buttonStyle(tone, style) }, ttAction: '$ui', ttActionInputs: input, children: [content] });
	const img = (src: string, alt: string, style: Style = {}): Node => ({ tag: 'img', props: { src, alt, style: { display: 'block', maxWidth: '100%', ...style } } });
	const sprite = (src: string, alt: string, size = 64, style: Style = {}): Node => img(src, alt, { width: `${size}px`, height: `${size}px`, imageRendering: 'pixelated', ...style });
	const bar = (percentArg: string, color: unknown = t.ok, style: Style = {}): Node =>
		el('div', { background: t.soft, borderRadius: '999px', height: '8px', overflow: 'hidden', ...style }, [el('div', { height: '100%', width: `{${percentArg}}%`, background: color, borderRadius: '999px' }, [])]);
	const stat = (value: unknown, caption: unknown, style: Style = {}): Node =>
		el('div', { background: t.soft, borderRadius: t.radius, padding: '12px 14px', display: 'grid', gap: '2px', ...style }, [text(value, { fontSize: '24px', fontWeight: 800, color: t.ink, lineHeight: 1.1 }), muted(caption, { fontSize: '12px' })]);
	const notice = (content: unknown, tone: 'info' | 'danger' | 'ok' = 'info'): Node =>
		el('div', { fontFamily: t.font, fontSize: '13px', padding: '10px 12px', borderRadius: '10px', background: tone === 'danger' ? '#fdecec' : tone === 'ok' ? '#e6f6ee' : t.soft, color: tone === 'danger' ? t.danger : tone === 'ok' ? t.ok : t.text }, [content]);
	const signInCard = (appName: string, blurb: string): Node => card([strong(`Welcome to ${appName}`), text(blurb), row([link('Log in with Thingtime', '/login', 'solid'), link('Create an account', '/register')])]);
	// the state gates every source-bound component renders through: sign-in,
	// install, loading, error, and the gallery/builder's inert preview
	// a seeded app page answers anonymous visitors through the shared,
	// read-only runtime (state 'ok' with nothing of theirs in it), so the
	// sign-in card is keyed on the viewer, not only on the source state
	const gates = (appName: string, blurb: string, ready: unknown, options: { loading?: string; inert?: unknown } = {}): Node[] => [
		whenState('signed-out', signInCard(appName, blurb)),
		whenState('not-installed', card([strong(`Install ${appName}`), text('Installing copies the app’s programs into your own things — every control then runs as you, on your own data. Re-installing later updates them in place.'), row([button('Install the app ✨', '$install')])])),
		whenState('loading', card([muted(options.loading || 'Loading…')])),
		whenState('error', card([strong('Something went wrong', { color: t.danger }), muted('{error}'), row([button('Retry', '$refresh', {}, 'ghost')])])),
		whenState('inert', options.inert === undefined ? card([strong(appName), text(blurb), muted('Open the page to use it live — the builder canvas and the gallery show a static preview.')]) : options.inert),
		whenState('ok', ifTruthy('viewer.signedIn', ready, signInCard(appName, blurb)))
	];
	return { t, text, strong, title, muted, label, card, soft, row, stack, grid, divider, pill, button, link, textLink, input, textarea, select, option, checkbox, field, group, upload, dialog, confirmButton, countdown, localButton, img, sprite, bar, stat, notice, gates, inputStyle, buttonStyle };
};

// ── step helpers (theme-free) ───────────────────────────────────────────────
export const x = (...args: unknown[]): Node => ({ ttExpr: args });
export const get = (from: unknown, key: unknown, fallback: unknown = null): Node => x('get', from, key, fallback);
export const first = (list: unknown): Node => x('first', list);
export const firstCrystal = (list: unknown): Node => get(first(list), 'crystal', null);
export const firstId = (list: unknown): Node => get(first(list), 'id', null);
export const isEmpty = (value: unknown): Node => x('isEmpty', value);
export const notEmpty = (value: unknown): Node => x('not', x('isEmpty', value));
export const len = (list: unknown): Node => x('len', list);
export const iff = (cond: unknown, then: unknown, otherwise: unknown = null): Node => x('if', cond, then, otherwise);
export const eq = (a: unknown, b: unknown): Node => x('eq', a, b);
export const concat = (...parts: unknown[]): Node => x('concat', ...parts);
export const coalesce = (...parts: unknown[]): Node => x('coalesce', ...parts);
export const merge = (...parts: unknown[]): Node => x('merge', ...parts);
export const percent = (part: unknown, whole: unknown): Node => x('round', x('mul', 100, x('div', part, x('max', 1, whole))));
export const today = (): Node => x('isoDate', '$now');
// a search row → its crystal plus the thing id (what templates and controls
// need: `{item.title}` and ttActionInputs { id: '{item.id}' })
export const rows = (listStep: string, extra: Record<string, unknown> = {}): Node => x('map', listStep, merge('$item.crystal', { id: '$item.id', createdAt: '$item.createdAt' }, extra));
export const search = (schema: string, options: Record<string, unknown> = {}): Node => ({ op: 'things.search', schema, ...options });
export const returnValue = (value: Record<string, unknown>, when?: unknown): Node => ({ op: 'return', value, ...(when !== undefined ? { when } : {}) });
export const compute = (value: unknown, when?: unknown): Node => ({ op: 'compute', value, ...(when !== undefined ? { when } : {}) });
export const failWhen = (when: unknown, message: unknown): Node => ({ op: 'fail', when, message });

// ── page helpers ────────────────────────────────────────────────────────────
export const boundBlock = (ctx: DemoBlockCtx, refs: SuiteRefs, id: string, component: string, action: string, inputs?: Record<string, string | number | boolean>, extra: Partial<DemoBlock> = {}): DemoBlock =>
	({ id: ctx.id(id), type: 'component', component: refs.component(component), source: { action: refs.actionKey(action), ...(inputs ? { inputs } : {}) }, ...extra }) as DemoBlock;
export const componentBlock = (ctx: DemoBlockCtx, refs: SuiteRefs, id: string, component: string, args?: Record<string, string | number | boolean>, extra: Partial<DemoBlock> = {}): DemoBlock =>
	({ id: ctx.id(id), type: 'component', component: refs.component(component), ...(args ? { args } : {}), ...extra }) as DemoBlock;
// every app page: the nav component (an `active` arg) above the page body,
// centred in a readable column
export const appShell = (ctx: DemoBlockCtx, refs: SuiteRefs, navKey: string, active: string, body: DemoBlock[], options: { maxWidth?: number; gap?: number } = {}): DemoBlock[] => [
	demoBlockKit.container(ctx, 'shell', 'column', [componentBlock(ctx, refs, 'nav', navKey, { active }), ...body], { gap: options.gap ?? 3, maxWidth: options.maxWidth ?? 820, css: { padding: '8px 0 40px' } })
];

// the nav bar shared by every app: brand link + one pill per page
export const navComponent = (t: Theme, options: { key?: string; brand: string; emoji: string; home: string; links: Array<[string, string, string]> }) => {
	const kit = makeKit(t);
	return {
		key: options.key || 'nav',
		name: `${options.brand} nav`,
		description: `The top bar of ${options.brand}: the brand mark and a pill per page.`,
		args: [{ name: 'active', type: 'enum' as const, label: 'Active page', values: options.links.map(([key]) => key), default: options.links[0][0] }],
		render: () =>
			el('nav', { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '10px 0 6px', borderBottom: `1px solid ${t.border}`, marginBottom: '6px' }, [
				el('a', { fontFamily: t.font, fontWeight: 800, fontSize: '16px', color: t.ink, textDecoration: 'none', marginRight: 'auto', whiteSpace: 'nowrap' }, [`${options.emoji} ${options.brand}`], { href: options.home }),
				...options.links.map(([key, caption, href]) =>
					ifEquals('active', key, kit.link(caption, href, 'solid', { padding: '6px 12px', fontSize: '12px' }), kit.link(caption, href, 'ghost', { padding: '6px 12px', fontSize: '12px' }))
				)
			])
	};
};

export type { BehaviourSuite, SuiteRefs, DemoBlock, DemoBlockCtx };
