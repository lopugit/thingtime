// Lopu ⇄ builder live bridge (design note PRs/lopu-ai-assistant-design.md §2.5,
// client half). A module registry of the editable webpage drafts currently
// mounted (BuilderCanvas, SiteBlocksEditor's page + global drafts — never the
// /p/ viewer) so a streamed Lopu turn can paint straight into the page the
// user is looking at:
//
//   patch events      → applyLopuPatchEvent   (PageOp[] through applyPageOps)
//   thing events      → applyLopuThingEvent   (components render instantly,
//                                              persisted pages mark saved)
//   tool_input_delta  → applyLopuPartialPageOps / applyLopuPartialComponent
//                       (ops closed inside a partial array, token-by-token
//                        component rebuilds)
//
// Pure module state, no React: the hook side (useWebpageDraft) registers a
// LIVE handle whose getters read the draft's latest state, so the registry
// never holds stale block trees. The patch grammar itself is the isomorphic
// api/utils/lopu/pageOps (the server applies the same ops to the same tree).

import { applyPageOps as applyValidatedPageOps, validateBlockShape, validatePageOps, type PageOp, type PatchTarget } from '~/api/utils/lopu/pageOps';
import type { ComponentThingLike, ComponentsByRef } from '../Builder/WebpageBlocksRenderer';
import type { WebpageTarget } from '../Builder/useWebpage';
import type { WebpageBlock } from '../Builder/webpageBlocks';

export type { PageOp, PatchTarget };

// ——— patch-op grammar (§2.5) ————————————————————————————————————————————

export type ApplyPageOpsResult = {
  blocks: WebpageBlock[];
  applied: number;
  errors: string[];
  // the ops that actually landed, ids normalised (what the server broadcasts)
  ops: PageOp[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export const isPageBlockLike = (value: unknown): value is WebpageBlock => validateBlockShape(value) === null;

// Tolerant front door to the shared grammar: every op is validated and
// applied ON ITS OWN, so one malformed op (a truncated partial, a model slip)
// is reported and skipped while the rest still land — the server behaves the
// same way and feeds the strings back to the model. Never throws.
export const applyPageOps = (blocks: WebpageBlock[], ops: readonly unknown[]): ApplyPageOpsResult => {
  let current = Array.isArray(blocks) ? blocks : [];
  const errors: string[] = [];
  const landed: PageOp[] = [];
  if (!Array.isArray(ops)) return { blocks: current, applied: 0, errors: ['ops must be an array'], ops: [] };
  ops.forEach((raw, index) => {
    const label = `op ${index}${isRecord(raw) && typeof raw.op === 'string' ? ` (${raw.op})` : ''}`;
    const checked = validatePageOps([raw]);
    // (equality, not truthiness: the app's tsconfig narrows unions only on
    // an explicit discriminant check)
    if (checked.ok === false) {
      errors.push(`${label}: ${checked.error.replace(/^ops\[0\](\.|\s)?/, '').trim()}`);
      return;
    }
    const result = applyValidatedPageOps(current, checked.ops);
    current = result.blocks;
    landed.push(...result.ops);
    for (const error of result.errors) errors.push(`${label}: ${error.replace(/^[a-zA-Z]+ #1: /, '')}`);
  });
  return { blocks: current, applied: landed.length, errors, ops: landed };
};

// ——— draft handles ——————————————————————————————————————————————————————

export type LopuSavedThingLike = {
  id?: string;
  crystal?: Record<string, unknown>;
  updatedAt?: string;
  acl?: string[];
  author?: { id?: string } | null;
  [key: string]: unknown;
};

// A LIVE view of one mounted useWebpageDraft: every field is read fresh from
// the hook (getters over refs), the methods are the hook's own callbacks.
export type LopuDraftHandle = {
  readonly id: string | null;
  readonly source: 'user' | 'system' | null;
  readonly pageKey: string | null;
  readonly siteRoute: string | null;
  readonly updatedAt: string | null;
  readonly blocks: WebpageBlock[];
  readonly dirty: boolean;
  setBlocks: (next: WebpageBlock[]) => void;
  addComponent: (ref: string, component: ComponentThingLike | null) => void;
  markSaved: (thing: LopuSavedThingLike) => void;
  // additive (not in the note's minimal shape): page name for the context
  // chip, editability (default true; the /p/ viewer registers false), the
  // target the draft was asked to resolve (matches a page before it loads),
  // and the ref → component map used to find a component on the page
  readonly name?: string | null;
  readonly editable?: boolean;
  readonly target?: WebpageTarget | null;
  readonly componentsByRef?: ComponentsByRef;
};

// What the reply request's `context.page` carries (design note §2.5/§3.3).
export type LopuDraftContextPage = {
  id?: string;
  source?: 'user' | 'system';
  pageKey?: string;
  siteRoute?: string;
  updatedAt?: string;
  blocks: WebpageBlock[];
};

type Registration = { handle: LopuDraftHandle; registeredAt: number; touchedAt: number };

const registry: Registration[] = [];
const listeners = new Set<() => void>();
let tick = 0;
let version = 0;
const nextTick = () => ++tick;

const notify = () => {
  version += 1;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      // a broken subscriber must not break the draft the user is editing
    }
  }
};

const isEditable = (handle: LopuDraftHandle): boolean => handle.editable !== false;
const isGlobalDraft = (handle: LopuDraftHandle): boolean => handle.target?.kind === 'global' || handle.pageKey === 'site-global';
const registrationOf = (handle: LopuDraftHandle): Registration | null => registry.find((entry) => entry.handle === handle) || null;

// Most recently EDITED draft first; before any edit, page drafts beat the
// site-global doc (SiteBlocksEditor mounts both and Lopu means the page),
// then the most recently registered.
const byRecency = (a: Registration, b: Registration): number => {
  if (a.touchedAt !== b.touchedAt) return b.touchedAt - a.touchedAt;
  const ga = isGlobalDraft(a.handle);
  const gb = isGlobalDraft(b.handle);
  if (ga !== gb) return ga ? 1 : -1;
  return b.registeredAt - a.registeredAt;
};

const draftMatchesPage = (handle: LopuDraftHandle, pageId: string): boolean =>
  handle.id === pageId || (handle.target?.kind === 'id' && handle.target.id === pageId);

// Registers a mounted draft; returns its unregister fn. Registering the same
// handle again only refreshes its recency.
export const registerWebpageDraft = (handle: LopuDraftHandle): (() => void) => {
  const existing = registrationOf(handle);
  if (existing) existing.registeredAt = nextTick();
  else registry.push({ handle, registeredAt: nextTick(), touchedAt: 0 });
  notify();
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    const at = registry.findIndex((entry) => entry.handle === handle);
    if (at !== -1) registry.splice(at, 1);
    for (const [key, entry] of partialOps) if (entry.draft === handle) partialOps.delete(key);
    for (const [ref, entry] of partialComponents) {
      entry.pushes = entry.pushes.filter((push) => push.draft !== handle);
      if (!entry.pushes.length) partialComponents.delete(ref);
    }
    notify();
  };
};

// The user edited this draft (or Lopu painted into it): it becomes the one
// Lopu targets with 'active'.
export const focusWebpageDraft = (handle: LopuDraftHandle): void => {
  const registration = registrationOf(handle);
  if (!registration) return;
  registration.touchedAt = nextTick();
  notify();
};

// The draft's resolved page / dirty flag changed — wake subscribers (the
// context chip) without touching recency.
export const notifyWebpageDraftChange = (): void => notify();

export const subscribeWebpageDrafts = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Monotonic counter bumped on every registry change — a cheap
// useSyncExternalStore snapshot alongside getActiveWebpageDraft().
export const getWebpageDraftsVersion = (): number => version;

export const listWebpageDrafts = (): LopuDraftHandle[] => [...registry].sort(byRecency).map((entry) => entry.handle);

export const getActiveWebpageDraft = (): LopuDraftHandle | null => {
  const candidates = registry.filter((entry) => isEditable(entry.handle));
  if (!candidates.length) return null;
  return candidates.sort(byRecency)[0].handle;
};

// The `context.page` payload for a reply request (§2.6): exactly the fields
// the server reads, from the active editable draft.
export const describeActiveWebpageDraft = (): LopuDraftContextPage | null => {
  const draft = getActiveWebpageDraft();
  if (!draft) return null;
  return {
    ...(draft.id ? { id: draft.id } : {}),
    ...(draft.source ? { source: draft.source } : {}),
    ...(draft.pageKey ? { pageKey: draft.pageKey } : {}),
    ...(draft.siteRoute ? { siteRoute: draft.siteRoute } : {}),
    ...(draft.updatedAt ? { updatedAt: draft.updatedAt } : {}),
    blocks: draft.blocks
  };
};

export type LopuDraftResolution = { draft: LopuDraftHandle | null; reason?: 'no-draft' | 'page-mismatch' | 'unresolved' };

// Which mounted draft a patch is for. An explicit `{ id }` (or the server's
// pageId hint for 'active') must match a mounted editable draft — never fall
// back to a different page than the one the server applied to.
export const resolveLopuDraft = (target: PatchTarget | null | undefined, pageId?: string | null): LopuDraftResolution => {
  const wanted = target && target !== 'active' && typeof target === 'object' && typeof target.id === 'string' ? target.id : pageId || null;
  if (wanted) {
    const matches = registry.filter((entry) => isEditable(entry.handle) && draftMatchesPage(entry.handle, wanted)).sort(byRecency);
    if (!matches.length) return { draft: null, reason: registry.some((entry) => isEditable(entry.handle)) ? 'page-mismatch' : 'no-draft' };
    const draft = matches[0].handle;
    // matched by target id only: the page has not resolved yet, so its block
    // list is not the tree the server patched — the persisted `thing` event
    // (markSaved) converges it instead
    if (draft.id !== wanted) return { draft: null, reason: 'unresolved' };
    return { draft };
  }
  const active = getActiveWebpageDraft();
  return active ? { draft: active } : { draft: null, reason: 'no-draft' };
};

// ——— patch events ———————————————————————————————————————————————————————

export type LopuPatchEventLike = {
  type?: 'patch';
  id?: string;
  target?: PatchTarget;
  ops: unknown;
  pageId?: string | null;
  persisted?: boolean;
};

export type LopuPatchOutcome = {
  ok: boolean;
  reason?: LopuDraftResolution['reason'] | 'no-ops';
  applied: number;
  errors: string[];
  draft?: LopuDraftHandle;
  persisted?: boolean;
};

type PartialOpsEntry = { draft: LopuDraftHandle; baseline: WebpageBlock[]; applied: number };

const MAX_PARTIAL_ENTRIES = 32;
const partialOps = new Map<string, PartialOpsEntry>();
const partialKey = (id: unknown): string => (typeof id === 'string' && id ? id : '__lopu-anon__');

const isRegistered = (handle: LopuDraftHandle): boolean => !!registrationOf(handle);

// Apply a complete `patch` event. When ops already streamed in through
// applyLopuPartialPageOps for the same tool call, the full list is replayed
// on the baseline snapshot instead of on top of the partial paint — so
// nothing is ever applied twice and the server's (id-rewritten) ops win.
export const applyLopuPatchEvent = (event: LopuPatchEventLike): LopuPatchOutcome => {
  const ops = Array.isArray(event?.ops) ? event.ops : null;
  if (!ops) return { ok: false, reason: 'no-ops', applied: 0, errors: [] };
  const key = partialKey(event.id);
  const entry = partialOps.get(key) || null;
  partialOps.delete(key);
  let draft = entry && isRegistered(entry.draft) ? entry.draft : null;
  let reason: LopuDraftResolution['reason'];
  if (!draft) ({ draft, reason } = resolveLopuDraft(event.target ?? 'active', event.pageId));
  if (!draft) return { ok: false, reason, applied: 0, errors: [] };
  const base = entry && entry.draft === draft ? entry.baseline : draft.blocks;
  const result = applyPageOps(base, ops);
  draft.setBlocks(result.blocks);
  return { ok: true, applied: result.applied, errors: result.errors, draft, persisted: !!event.persisted };
};

export type LopuPartialPageOpsOptions = {
  // the tool_use id the fragments belong to (one baseline per tool call)
  id?: string;
  // true when the partial parser reports the whole input closed
  complete?: boolean;
  target?: PatchTarget;
  pageId?: string | null;
};

export type LopuPartialOutcome = {
  ok: boolean;
  reason?: LopuDraftResolution['reason'] | 'no-ops';
  // ops painted so far for this tool call
  applied: number;
  // ops still open (or not yet closed) in the partial array
  pending: number;
  changed: boolean;
  errors?: string[];
  draft?: LopuDraftHandle;
};

// Ops that have CLOSED inside a still-streaming `ops` array: every element
// before the last one is complete JSON (a new element began after it), the
// last one only when the parser says the document closed. Tracked by op
// index per tool call — each call re-paints baseline + closed prefix, so the
// page grows block by block while the model is still writing.
export const applyLopuPartialPageOps = (ops: unknown, options: LopuPartialPageOpsOptions = {}): LopuPartialOutcome => {
  const list = Array.isArray(ops) ? ops : null;
  if (!list) return { ok: false, reason: 'no-ops', applied: 0, pending: 0, changed: false };
  const closed = options.complete ? list.length : Math.max(0, list.length - 1);
  const key = partialKey(options.id);
  let entry = partialOps.get(key) || null;
  if (entry && !isRegistered(entry.draft)) {
    partialOps.delete(key);
    entry = null;
  }
  if (!entry) {
    if (!closed) return { ok: true, applied: 0, pending: list.length, changed: false };
    const { draft, reason } = resolveLopuDraft(options.target ?? 'active', options.pageId);
    if (!draft) return { ok: false, reason, applied: 0, pending: list.length, changed: false };
    // the baseline is pinned when the FIRST op closes, not on the first
    // fragment — edits typed before anything paints are kept
    entry = { draft, baseline: draft.blocks, applied: 0 };
    partialOps.set(key, entry);
    if (partialOps.size > MAX_PARTIAL_ENTRIES) partialOps.delete(partialOps.keys().next().value as string);
  }
  if (closed <= entry.applied) return { ok: true, applied: entry.applied, pending: list.length - entry.applied, changed: false, draft: entry.draft };
  const result = applyPageOps(entry.baseline, list.slice(0, closed));
  entry.applied = closed;
  entry.draft.setBlocks(result.blocks);
  return { ok: true, applied: closed, pending: list.length - closed, changed: true, errors: result.errors, draft: entry.draft };
};

// A patch_page call that never completed (tool error, aborted turn): forget
// its baseline and, by default, put the draft back the way it was.
export const discardLopuPartialPageOps = (id?: string, options: { revert?: boolean } = {}): boolean => {
  const key = partialKey(id);
  const entry = partialOps.get(key);
  if (!entry) return false;
  partialOps.delete(key);
  if (options.revert !== false && isRegistered(entry.draft)) entry.draft.setBlocks(entry.baseline);
  return true;
};

// ——— thing events ———————————————————————————————————————————————————————

export type LopuPublicThingLike = LopuSavedThingLike & {
  id: string;
  kind?: string;
  thingtime?: string[];
  shareId?: string;
};

export type LopuThingEventLike = { type?: 'thing'; id?: string; kind?: string; thing: LopuPublicThingLike };

export type LopuThingOutcome = {
  ok: boolean;
  kind: string | null;
  // component refs pushed into the mounted drafts
  refs: string[];
  // drafts whose page this thing IS (markSaved called)
  marked: number;
  reason?: 'no-thing';
};

const KNOWN_KINDS = ['component', 'webpage', 'action', 'schema', 'data'];

const kindOf = (event: LopuThingEventLike | LopuPublicThingLike, thing: LopuPublicThingLike | null): string | null => {
  if (typeof (event as LopuThingEventLike).kind === 'string') return (event as LopuThingEventLike).kind as string;
  if (typeof thing?.kind === 'string') return thing.kind;
  const list = Array.isArray(thing?.thingtime) ? thing!.thingtime!.filter((entry): entry is string => typeof entry === 'string') : [];
  return list.find((entry) => KNOWN_KINDS.includes(entry)) || list[0] || null;
};

const componentRefsOf = (thing: LopuPublicThingLike): string[] => {
  const key = typeof thing.crystal?.componentKey === 'string' ? thing.crystal.componentKey : null;
  const refs = [key, thing.id, typeof thing.shareId === 'string' ? thing.shareId : null];
  return Array.from(new Set(refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)));
};

const announceWebpageSaved = (thing: LopuPublicThingLike): void => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
  const crystal = isRecord(thing.crystal) ? thing.crystal : {};
  try {
    window.dispatchEvent(
      new CustomEvent('thingtime:webpage-saved', {
        detail: {
          pageKey: typeof crystal.pageKey === 'string' ? crystal.pageKey : null,
          siteRoute: typeof crystal.siteRoute === 'string' ? crystal.siteRoute : null,
          id: thing.id,
          source: 'lopu'
        }
      })
    );
  } catch {
    // non-browser runtimes
  }
};

// A created/updated public thing streamed by a tool. Components are pushed
// into EVERY mounted draft under both their componentKey and id (component
// blocks reference either), so they render the instant the tool completes;
// a webpage thing is a persisted save of that page — matching drafts adopt it
// (markSaved) and the site caches are told, exactly like a manual save.
export const applyLopuThingEvent = (input: LopuThingEventLike | LopuPublicThingLike): LopuThingOutcome => {
  const asEvent = (input || null) as LopuThingEventLike | null;
  // an event envelope without its thing is malformed — never mistake the
  // envelope itself for the thing
  const thing: LopuPublicThingLike | null = isRecord(asEvent?.thing)
    ? (asEvent!.thing as LopuPublicThingLike)
    : asEvent && (asEvent.type === 'thing' || 'thing' in asEvent)
      ? null
      : ((input as LopuPublicThingLike) ?? null);
  const kind = kindOf(input, thing);
  if (!thing || typeof thing.id !== 'string' || !thing.id) return { ok: false, kind, refs: [], marked: 0, reason: 'no-thing' };
  if (kind === 'component') {
    // the renderers read crystal.render — a component without a crystal is
    // nothing the page can draw
    if (!isRecord(thing.crystal)) return { ok: false, kind, refs: [], marked: 0, reason: 'no-thing' };
    const refs = componentRefsOf(thing);
    for (const entry of registry) for (const ref of refs) entry.handle.addComponent(ref, thing as ComponentThingLike);
    for (const ref of refs) {
      partialComponents.delete(ref);
      pendingComponentFrames.delete(ref);
    }
    return { ok: true, kind, refs, marked: 0 };
  }
  if (kind === 'webpage') {
    let marked = 0;
    for (const entry of registry) {
      if (!draftMatchesPage(entry.handle, thing.id)) continue;
      entry.handle.markSaved(thing);
      marked += 1;
    }
    announceWebpageSaved(thing);
    return { ok: true, kind, refs: [], marked };
  }
  return { ok: true, kind, refs: [], marked: 0 };
};

// ——— partial components ————————————————————————————————————————————————

type ComponentPush = { draft: LopuDraftHandle; pageRef: string; base: ComponentThingLike | null };
type PartialComponentEntry = { pushes: ComponentPush[] };

const partialComponents = new Map<string, PartialComponentEntry>();
const pendingComponentFrames = new Map<string, { render: unknown; crystal?: Record<string, unknown> }>();

const collectComponentRefs = (blocks: WebpageBlock[], into: Set<string> = new Set()): Set<string> => {
  for (const block of blocks) {
    if (block.type === 'component' && typeof block.component === 'string' && block.component) into.add(block.component);
    if (block.children) collectComponentRefs(block.children, into);
  }
  return into;
};

// A page ref points at `ref` when it IS the ref, resolves to that thing id /
// componentKey, or is the seeded-doc spelling (`component-<slug>`).
const pageRefMatches = (pageRef: string, ref: string, byRef: ComponentsByRef | undefined): boolean => {
  if (pageRef === ref || `component-${pageRef}` === ref || pageRef === `component-${ref}`) return true;
  const known = byRef?.[pageRef];
  if (!known) return false;
  return known.id === ref || known.crystal?.componentKey === ref;
};

const targetsFor = (ref: string): ComponentPush[] => {
  const out: ComponentPush[] = [];
  for (const entry of registry) {
    const byRef = entry.handle.componentsByRef;
    for (const pageRef of collectComponentRefs(entry.handle.blocks)) {
      if (pageRefMatches(pageRef, ref, byRef)) out.push({ draft: entry.handle, pageRef, base: byRef?.[pageRef] ?? null });
    }
  }
  return out;
};

const pushPartialComponent = (ref: string, render: unknown, crystal: Record<string, unknown> | undefined, targets: ComponentPush[]): void => {
  let entry = partialComponents.get(ref);
  if (!entry) {
    entry = { pushes: [] };
    partialComponents.set(ref, entry);
  }
  for (const target of targets) {
    // remember the pre-stream component ONCE so a discard can restore it
    let push = entry.pushes.find((known) => known.draft === target.draft && known.pageRef === target.pageRef);
    if (!push) {
      push = target;
      entry.pushes.push(push);
    }
    const base = push.base;
    const next: ComponentThingLike = {
      ...(base || { id: ref, crystal: {} }),
      crystal: { ...(base?.crystal || {}), ...(crystal || {}), render }
    };
    target.draft.addComponent(target.pageRef, next);
  }
};

export type LopuPartialComponentOutcome = {
  ok: boolean;
  reason?: 'no-ref' | 'no-render' | 'not-on-page';
  // (draft, page ref) pairs that receive the partial render
  pushed: number;
  refs: string[];
  // true when the paint was coalesced into the next animation frame
  deferred: boolean;
};

// Token-by-token rebuild of a component that is on a mounted page: the
// partial `render` tree replaces the component's render in place (rest of the
// crystal kept) so the on-page component visibly rebuilds while the model
// writes; the final `thing` event swaps in the saved version. Paints are
// coalesced to one per animation frame where frames exist.
export const applyLopuPartialComponent = (
  ref: string,
  partialRender: unknown,
  options: { crystal?: Record<string, unknown> } = {}
): LopuPartialComponentOutcome => {
  if (typeof ref !== 'string' || !ref) return { ok: false, reason: 'no-ref', pushed: 0, refs: [], deferred: false };
  if (partialRender === undefined || partialRender === null) return { ok: false, reason: 'no-render', pushed: 0, refs: [], deferred: false };
  const targets = targetsFor(ref);
  if (!targets.length) return { ok: false, reason: 'not-on-page', pushed: 0, refs: [], deferred: false };
  const refs = Array.from(new Set(targets.map((target) => target.pageRef)));
  const canDefer = typeof requestAnimationFrame === 'function';
  if (!canDefer) {
    pushPartialComponent(ref, partialRender, options.crystal, targets);
    return { ok: true, pushed: targets.length, refs, deferred: false };
  }
  const scheduled = pendingComponentFrames.has(ref);
  pendingComponentFrames.set(ref, { render: partialRender, crystal: options.crystal });
  if (!scheduled) {
    requestAnimationFrame(() => {
      const latest = pendingComponentFrames.get(ref);
      pendingComponentFrames.delete(ref);
      if (!latest) return;
      pushPartialComponent(ref, latest.render, latest.crystal, targetsFor(ref));
    });
  }
  return { ok: true, pushed: targets.length, refs, deferred: true };
};

// An update_component that never completed: restore what the page showed
// before the stream started.
export const discardLopuPartialComponent = (ref: string): boolean => {
  pendingComponentFrames.delete(ref);
  const entry = partialComponents.get(ref);
  if (!entry) return false;
  partialComponents.delete(ref);
  for (const push of entry.pushes) if (isRegistered(push.draft)) push.draft.addComponent(push.pageRef, push.base);
  return true;
};

// Test/teardown helper: forget every draft and every in-flight partial.
export const resetLopuBuildBridge = (): void => {
  registry.splice(0, registry.length);
  partialOps.clear();
  partialComponents.clear();
  pendingComponentFrames.clear();
  notify();
};
