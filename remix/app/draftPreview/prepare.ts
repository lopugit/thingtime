import { BUILDER_THING_KIND } from '../schemas/builderThing';
import { validateThingtimeCrystal } from '../schemas/registry';
import { collectTransfer } from '../utils/thingTransfer/collect';
import { parseTransfer, serializeTransfer, validateTransfer, type TransferThing } from '../utils/thingTransfer/format';
import { createTemplateResolver, defaultsFromArgs, sanitizeArgSpecs } from '../components/ComponentsLibrary/componentTemplate';
import { HTML_ALLOWED_TAGS } from '../components/Kinds/htmlRenderPolicy';
import { isSafeCssText } from '../components/Kinds/safeUrl';

export const DRAFT_LIMITS = { bytes: 256 * 1024, things: 32, values: 12000, depth: 32, nodes: 550, blocks: 40 } as const;
const fail = (message: string): never => { throw new Error(message); };
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const styles = new Set(('color background backgroundColor backgroundImage border borderColor borderWidth borderStyle borderRadius padding paddingTop paddingBottom paddingLeft paddingRight margin marginTop marginBottom marginLeft marginRight width maxWidth minWidth height minHeight maxHeight aspectRatio display flexDirection alignItems justifyContent gap rowGap columnGap flexWrap flexGrow flexShrink flexBasis gridTemplateColumns fontFamily fontSize fontWeight fontStyle lineHeight letterSpacing textAlign whiteSpace overflowWrap wordBreak boxSizing opacity textDecoration').split(' '));
export function checkStyle(style: unknown) {
  if (!record(style)) fail('Style must be a CSS property object');
  for (const [key, value] of Object.entries(style)) {
    const camel = key.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (!styles.has(camel) || !['string', 'number'].includes(typeof value) || String(value).length > 200 || !isSafeCssText(String(value)) || [...String(value)].some(char => char.charCodeAt(0) < 32) || /url|image-set|cross-fade|paint\(|element\(|var\(|env\(|[\\@<>]|\/\*/i.test(String(value))) fail(`Unsupported draft CSS: ${key}`);
  }
}
// Inspect all branches before normalization/resolution, including inactive DSL branches.
function inspect(value: unknown, depth = 0, budget = { left: DRAFT_LIMITS.values as number }) {
  if (--budget.left < 0 || depth > DRAFT_LIMITS.depth) fail('Draft complexity limit exceeded');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['source','ttAction','ttActionRefs','ttActionInputs','ttMediaRefs','href','src','poster','html','rawChildren','chakra','forkOf','schemaId','targetId','folderId','extended','acl','author','ownerId','secure','userId'].includes(key) || /^on[A-Z]|^data-tt-action/i.test(key)) fail(`Unsupported draft field: ${key}; drafts cannot access accounts, Actions or assets`);
    if (key === 'tag' && (typeof child !== 'string' || !HTML_ALLOWED_TAGS.has(child) || child.startsWith('tt-') || ['a','img','video','audio','input','select','textarea','button','form','details','summary'].includes(child))) fail(`Unsupported draft tag: ${String(child)}`);
    if ((key === 'style' && record(child)) || key === 'css') checkStyle(child);
    inspect(child, depth + 1, budget);
  }
}
function checkTree(tree: any, depth = 0, budget = { left: DRAFT_LIMITS.nodes as number }) {
  if (--budget.left < 0 || depth > 20) fail('Resolved render tree exceeds the draft limit');
  if (typeof tree === 'string' || typeof tree === 'number') return;
  if (!record(tree) || typeof tree.tag !== 'string') fail('Draft render nodes need an explicit HTML tag');
  for (const key of Object.keys(tree)) if (!['tag','props','children'].includes(key)) fail(`Unsupported resolved render field: ${key}`);
  if (tree.props) for (const key of Object.keys(tree.props)) if (!['style','title','role','aria-label','aria-hidden'].includes(key)) fail(`Unsupported draft prop: ${key}`);
  const children = tree.children === undefined ? [] : Array.isArray(tree.children) ? tree.children : [tree.children];
  for (const child of children) checkTree(child, depth + 1, budget);
}
export const resolveDraftComponent = (thing: TransferThing, args = {}) => {
  const resolve = createTemplateResolver({ onExhausted: () => fail('Component expansion limit exceeded; no partial render exported') });
  const tree = resolve(thing.crystal.render, { ...defaultsFromArgs(sanitizeArgSpecs(thing.crystal.args)), ...(thing.crystal.savedArgs as object || {}), ...args });
  inspect(tree); checkTree(tree);
  return tree;
};

export async function prepareDraft(content: unknown, root?: string) {
  // String size is checked before JSON.parse. Object transport is already decoded by the host.
  const inputText = typeof content === 'string' ? content : JSON.stringify(content);
  if (!inputText || new TextEncoder().encode(inputText).length > DRAFT_LIMITS.bytes) fail('Draft input exceeds 256 KiB');
  let input: any;
  try { input = JSON.parse(inputText); } catch { fail('Draft input is not valid JSON'); }
  const supplied = input?.format ? parseTransfer(inputText) : validateTransfer({ format: 'thingtime.transfer', version: 1, roots: [input?.id], things: [input], files: [] });
  if (supplied.things.length > DRAFT_LIMITS.things || supplied.files.length || supplied.links?.length) fail('Drafts allow at most 32 supplied Things and no external assets');
  inspect(supplied);
  const normalized = supplied.things.map((thing) => {
    const contentKinds = thing.thingtime.filter(kind => kind !== BUILDER_THING_KIND);
    if (contentKinds.length !== 1 || !['component','webpage'].includes(contentKinds[0])) fail('Drafts support component and webpage Things only');
    const checked = validateThingtimeCrystal(thing.thingtime, thing.crystal);
    if (checked.ok === false) return fail(checked.error);
    return { ...thing, thingtime: checked.thingtime, crystal: checked.crystal } as TransferThing;
  });
  const byId = new Map(normalized.map(thing => [thing.id, thing]));
  const components: Record<string, TransferThing> = Object.create(null);
  for (const thing of normalized.filter(t => t.thingtime[0] === 'component')) {
    for (const ref of [thing.id, thing.crystal.componentKey].filter(Boolean) as string[]) {
      if ((components[ref] && components[ref] !== thing) || (byId.has(ref) && byId.get(ref) !== thing)) fail(`Ambiguous component reference: ${ref}`);
      components[ref] = thing;
    }
    resolveDraftComponent(thing);
  }
  const dependencies = new Map<string, string[]>();
  const blockBudget = { count: 0 };
  for (const thing of normalized.filter(t => t.thingtime[0] === 'webpage')) {
    const refs: string[] = [];
    const visit = (blocks: any[]) => {
      for (const block of blocks) {
        if (++blockBudget.count > DRAFT_LIMITS.blocks) fail('Draft block limit exceeded');
        if (!['component','container','text'].includes(block.type)) fail(`Unsupported draft block: ${block.type}`);
        if (block.type === 'component') {
          const component = components[block.component];
          if (!component) fail(`Missing in-bundle component: ${block.component}`);
          resolveDraftComponent(component, block.args);
          refs.push(component.id);
        }
        if (block.children) visit(block.children);
      }
    };
    visit(thing.crystal.blocks as any[]);
    dependencies.set(thing.id, refs);
  }
  const rootId = root || (supplied.roots.length === 1 ? supplied.roots[0] : fail('Choose a root reference'));
  if (!byId.has(rootId)) fail('Root reference is not in the supplied bundle');
  const { manifest } = await collectTransfer([rootId], {
    read: async id => byId.get(id) || fail(`Missing dependency: ${id}`),
    dependencies: async thing => dependencies.get(thing.id) || [],
    children: async () => ({ ids: [] }),
    files: async function* () {}
  });
  const normalizedIds = normalized.filter((thing, index) => JSON.stringify(thing.crystal) !== JSON.stringify(supplied.things[index].crystal)).map(thing => thing.id);
  const json = serializeTransfer(manifest);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return { manifest, json, hash, root: byId.get(rootId)!, components, diagnostics: [...(normalizedIds.length ? [{ level: 'info', code: 'SCHEMA_NORMALIZED', message: `Canonical schema normalization applied to: ${normalizedIds.join(', ')}` }] : []), { level: 'info', code: 'VALIDATED', message: 'Canonical schema validated; dependencies supplied in bundle; no persistence or network assets.' }] };
}
