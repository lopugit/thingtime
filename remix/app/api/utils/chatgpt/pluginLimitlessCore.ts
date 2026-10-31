export const THINGTIME_MCP_UI_RESOURCE_URI = 'ui://thingtime/review.html';
export const THINGTIME_CAPABILITY_CONTRACT_URI = 'thingtime://capability-contract';
export const THINGTIME_MUTATION_RECEIPT_PURPOSE = 'thingtime-mcp-mutation-preview';

export const MAX_LIMITLESS_MUTATION_OPERATIONS = 25;
export const MAX_LIMITLESS_MUTATION_BYTES = 48 * 1024;
export const MAX_LIMITLESS_HISTORY = 50;
export const MAX_LIMITLESS_WORKFLOW_RUNS = 25;

export type LimitlessMutationAction = 'create' | 'update' | 'delete';

export type LimitlessMutationOperation = {
  action: LimitlessMutationAction;
  id: string;
  thing?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  replaceCrystal?: boolean;
  expectedUpdatedAt?: string;
};

export type LimitlessMutationPreviewItem = LimitlessMutationOperation & {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: string;
};

export type LimitlessMutationPreview = {
  version: 1;
  previewId: string;
  accountId: string;
  createdAt: string;
  operations: LimitlessMutationPreviewItem[];
  inverseOperations: LimitlessMutationOperation[];
  source?: { kind: 'undo'; historyId: string };
};

export type ThingtimeMcpHistoryEntry = {
  id: string;
  accountId: string;
  createdAt: string;
  action: 'apply' | 'undo';
  status: 'succeeded' | 'partial' | 'failed';
  summaries: string[];
  results: Array<{ action: string; id: string; ok: boolean; error?: string }>;
  inverseOperations?: LimitlessMutationOperation[];
};

export type ThingtimeMcpWorkflowRun = {
  id: string;
  accountId: string;
  capabilityThingId: string;
  capabilityName: string;
  createdAt: string;
  updatedAt: string;
  status: 'awaiting_confirmation' | 'applied' | 'cancelled' | 'failed';
  previewId?: string;
  historyId?: string;
  summaries: string[];
  error?: string;
};

type Failure = { ok: false; error: string };
type Success<T> = { ok: true; value: T };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 128 ? id : null;
};

const jsonSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const normalizeLimitlessMutationOperations = (
  raw: unknown,
  { assignCreateIds = true }: { assignCreateIds?: boolean } = {}
): Failure | Success<LimitlessMutationOperation[]> => {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: 'operations must be a non-empty list' };
  if (raw.length > MAX_LIMITLESS_MUTATION_OPERATIONS) {
    return { ok: false, error: `At most ${MAX_LIMITLESS_MUTATION_OPERATIONS} operations may be previewed together` };
  }

  const operations: LimitlessMutationOperation[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const candidate = raw[index];
    if (!isRecord(candidate)) return { ok: false, error: `operations[${index}] must be an object` };
    const action = candidate.action;
    if (action !== 'create' && action !== 'update' && action !== 'delete') {
      return { ok: false, error: `operations[${index}].action must be create, update, or delete` };
    }

    if (action === 'create') {
      if (!isRecord(candidate.thing)) return { ok: false, error: `operations[${index}].thing must be an object` };
      const thing = cloneJson(candidate.thing);
      const id = boundedId(thing.shareId ?? thing.id) || (assignCreateIds ? crypto.randomUUID() : null);
      if (!id) return { ok: false, error: `operations[${index}] create needs a stable id` };
      delete thing.id;
      thing.shareId = id;
      if (ids.has(id)) return { ok: false, error: `A mutation plan may touch Thing ${id} only once` };
      ids.add(id);
      operations.push({ action, id, thing });
      continue;
    }

    const id = boundedId(candidate.id);
    if (!id) return { ok: false, error: `operations[${index}].id is required` };
    if (ids.has(id)) return { ok: false, error: `A mutation plan may touch Thing ${id} only once` };
    ids.add(id);
    if (action === 'update') {
      if (!isRecord(candidate.patch)) return { ok: false, error: `operations[${index}].patch must be an object` };
      if (candidate.expectedUpdatedAt !== undefined && (typeof candidate.expectedUpdatedAt !== 'string' || Number.isNaN(new Date(candidate.expectedUpdatedAt).getTime()))) {
        return { ok: false, error: `operations[${index}].expectedUpdatedAt must be an ISO timestamp` };
      }
      operations.push({
        action,
        id,
        patch: cloneJson(candidate.patch),
        ...(candidate.replaceCrystal === true ? { replaceCrystal: true } : {}),
        ...(typeof candidate.expectedUpdatedAt === 'string' ? { expectedUpdatedAt: candidate.expectedUpdatedAt } : {})
      });
      continue;
    }
    if (candidate.expectedUpdatedAt !== undefined && (typeof candidate.expectedUpdatedAt !== 'string' || Number.isNaN(new Date(candidate.expectedUpdatedAt).getTime()))) {
      return { ok: false, error: `operations[${index}].expectedUpdatedAt must be an ISO timestamp` };
    }
    operations.push({
      action,
      id,
      ...(typeof candidate.expectedUpdatedAt === 'string' ? { expectedUpdatedAt: candidate.expectedUpdatedAt } : {})
    });
  }

  if (jsonSize(operations) > MAX_LIMITLESS_MUTATION_BYTES) {
    return { ok: false, error: `Mutation plans may contain at most ${MAX_LIMITLESS_MUTATION_BYTES} bytes` };
  }
  return { ok: true, value: operations };
};

const restorableThing = (thing: Record<string, unknown>): Record<string, unknown> => ({
  shareId: thing.id,
  thingtime: thing.thingtime,
  crystal: thing.crystal,
  extended: thing.extended,
  acl: thing.acl,
  tags: thing.tags,
  folderId: thing.folderId,
  targetId: thing.targetId
});

const restoredPatch = (thing: Record<string, unknown>): Record<string, unknown> => ({
  thingtime: thing.thingtime,
  crystal: thing.crystal,
  extended: thing.extended,
  acl: thing.acl,
  tags: thing.tags,
  folderId: thing.folderId,
  targetId: thing.targetId
});

export const buildLimitlessMutationPreview = ({
  accountId,
  operations,
  beforeById,
  now = new Date()
}: {
  accountId: string;
  operations: LimitlessMutationOperation[];
  beforeById: Map<string, Record<string, unknown>>;
  now?: Date;
}): Failure | Success<LimitlessMutationPreview> => {
  const previewItems: LimitlessMutationPreviewItem[] = [];
  const inverseOperations: LimitlessMutationOperation[] = [];

  for (const operation of operations) {
    const before = beforeById.get(operation.id) || null;
    if (operation.action !== 'create' && !before) return { ok: false, error: `thing_not_found:${operation.id}` };
    if (operation.action === 'create' && before) return { ok: false, error: `thing_already_exists:${operation.id}` };

    if (operation.action === 'create') {
      previewItems.push({ ...operation, before: null, after: operation.thing || null, summary: `Create Thing ${operation.id}` });
      inverseOperations.unshift({ action: 'delete', id: operation.id });
      continue;
    }

    const beforeUpdatedAt = typeof before!.updatedAt === 'string' ? before!.updatedAt : null;
    if (!beforeUpdatedAt || Number.isNaN(new Date(beforeUpdatedAt).getTime())) {
      return { ok: false, error: `thing_missing_updated_at:${operation.id}` };
    }
    const expectedUpdatedAt = operation.expectedUpdatedAt || beforeUpdatedAt;
    if (new Date(expectedUpdatedAt).getTime() !== new Date(beforeUpdatedAt).getTime()) {
      return { ok: false, error: `thing_changed:${operation.id}` };
    }
    if (operation.action === 'delete') {
      previewItems.push({ ...operation, expectedUpdatedAt, before, after: null, summary: `Delete Thing ${operation.id}` });
      inverseOperations.unshift({ action: 'create', id: operation.id, thing: restorableThing(before!) });
      continue;
    }

    const patch = operation.patch || {};
    const beforeCrystal = isRecord(before!.crystal) ? before!.crystal : {};
    const patchCrystal = isRecord(patch.crystal) ? patch.crystal : {};
    const after = {
      ...before,
      ...patch,
      crystal: operation.replaceCrystal ? patchCrystal : { ...beforeCrystal, ...patchCrystal }
    };
    previewItems.push({
      ...operation,
      expectedUpdatedAt,
      before,
      after,
      summary: `Update Thing ${operation.id}: ${Object.keys(patch).sort().join(', ') || 'no fields'}`
    });
    inverseOperations.unshift({
      action: 'update',
      id: operation.id,
      patch: restoredPatch(before!),
      replaceCrystal: true
    });
  }

  const preview: LimitlessMutationPreview = {
    version: 1,
    previewId: crypto.randomUUID(),
    accountId,
    createdAt: now.toISOString(),
    operations: previewItems,
    inverseOperations
  };
  if (jsonSize(preview) > MAX_LIMITLESS_MUTATION_BYTES) {
    return { ok: false, error: 'The before/after preview is too large for a safe signed receipt; split it into smaller operations' };
  }
  return { ok: true, value: preview };
};

const inputAtPath = (inputs: Record<string, unknown>, rawPath: unknown): unknown => {
  if (typeof rawPath !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,4}$/.test(rawPath)) return undefined;
  let current: unknown = inputs;
  for (const segment of rawPath.split('.')) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
};

const resolveWorkflowValue = (
  value: unknown,
  inputs: Record<string, unknown>,
  depth: number,
  budget: { nodes: number }
): Failure | Success<unknown> => {
  budget.nodes += 1;
  if (depth > 8 || budget.nodes > 1000) return { ok: false, error: 'Capability input expansion is too deeply nested or large' };
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const resolved = resolveWorkflowValue(item, inputs, depth + 1, budget);
      if (!resolved.ok) return resolved;
      result.push(resolved.value);
    }
    return { ok: true, value: result };
  }
  if (!isRecord(value)) return { ok: true, value };
  if (Object.keys(value).length === 1 && '$input' in value) {
    const resolved = inputAtPath(inputs, value.$input);
    return resolved === undefined
      ? { ok: false, error: `Missing workflow input: ${String(value.$input)}` }
      : { ok: true, value: cloneJson(resolved) };
  }
  if (Object.keys(value).some((key) => key.startsWith('$'))) {
    return { ok: false, error: 'Capability objects may only use the exact {$input:"path"} placeholder form' };
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const resolved = resolveWorkflowValue(child, inputs, depth + 1, budget);
    if (!resolved.ok) return resolved;
    result[key] = resolved.value;
  }
  return { ok: true, value: result };
};

export const compileThingtimeCapability = ({
  thing,
  inputs
}: {
  thing: Record<string, unknown>;
  inputs: Record<string, unknown>;
}): Failure | Success<{ name: string; operations: LimitlessMutationOperation[] }> => {
  const thingtime = Array.isArray(thing.thingtime) ? thing.thingtime : [];
  const crystal = isRecord(thing.crystal) ? thing.crystal : {};
  if (!thingtime.includes('data') || crystal.schema !== 'Thingtime Capability' || crystal.capabilityVersion !== 1) {
    return { ok: false, error: 'Thing is not a Thingtime Capability v1 data Thing' };
  }
  const name = typeof crystal.name === 'string' && crystal.name.trim() ? crystal.name.trim().slice(0, 120) : String(thing.id || 'Capability');
  const resolved = resolveWorkflowValue(crystal.operations, inputs, 0, { nodes: 0 });
  if (resolved.ok === false) return { ok: false, error: resolved.error };
  const normalized = normalizeLimitlessMutationOperations(resolved.value);
  if (normalized.ok === false) return { ok: false, error: normalized.error };
  return { ok: true, value: { name, operations: normalized.value } };
};

export const THINGTIME_CAPABILITY_CONTRACT = {
  schema: 'Thingtime Capability',
  capabilityVersion: 1,
  description: 'A bounded workflow that composes create, update, and delete operations. It cannot call URLs, queries, code, or unregistered tools.',
  thing: {
    thingtime: ['data'],
    crystal: {
      schema: 'Thingtime Capability',
      capabilityVersion: 1,
      name: 'Archive completed item',
      operations: [
        {
          action: 'update',
          id: { $input: 'thingId' },
          patch: { crystal: { archived: true } }
        }
      ]
    }
  },
  placeholder: { $input: 'path.to.value' },
  limits: {
    operations: MAX_LIMITLESS_MUTATION_OPERATIONS,
    bytes: MAX_LIMITLESS_MUTATION_BYTES,
    expansionDepth: 8,
    expansionNodes: 1000
  }
} as const;

export const thingtimePromptDefinitions = [
  {
    name: 'thingtime_inbox_triage',
    title: 'Triage my Thingtime inbox',
    description: 'Review visible Things, group priorities, and propose changes without applying them.',
    arguments: [{ name: 'accountId', description: 'Optional connected account id.', required: false }]
  },
  {
    name: 'thingtime_design_schema',
    title: 'Design a Thingtime schema',
    description: 'Turn a concept into a user-authored schema Thing and validate an example.',
    arguments: [{ name: 'concept', description: 'The concept or object to model.', required: true }]
  },
  {
    name: 'thingtime_safe_change',
    title: 'Preview a safe Thingtime change',
    description: 'Build a bounded mutation plan, inspect its diff, and wait for confirmation before apply.',
    arguments: [{ name: 'goal', description: 'The change the user wants.', required: true }]
  },
  {
    name: 'thingtime_restore_history',
    title: 'Restore from Thingtime MCP history',
    description: 'Inspect prior MCP mutation receipts and preview an undo.',
    arguments: [{ name: 'historyId', description: 'Optional history entry id.', required: false }]
  },
  {
    name: 'thingtime_build_capability',
    title: 'Build a reusable Thingtime Capability',
    description: 'Create a bounded workflow Thing using registered mutation primitives and explicit inputs.',
    arguments: [{ name: 'goal', description: 'The reusable workflow to model.', required: true }]
  }
] as const;

export const renderThingtimeMcpUi = (): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:transparent;color:CanvasText}.shell{border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:18px;overflow:hidden;background:Canvas}.head,.toolbar,.actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.head{padding:15px 17px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent)}h1{font-size:15px;margin:0}.badge,.count{font-size:11px;padding:4px 8px;border-radius:999px;background:color-mix(in srgb,CanvasText 8%,transparent)}main{padding:16px}.toolbar{margin-bottom:12px;align-items:flex-end}.tabs{display:flex;gap:5px}.empty{opacity:.68;font-size:13px}.grid{display:grid;gap:10px}.card{border:1px solid color-mix(in srgb,CanvasText 13%,transparent);border-radius:13px;padding:12px}.cardhead{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start}.title{font-weight:650;font-size:13px;overflow-wrap:anywhere}.meta{font-size:11px;opacity:.65;margin-top:3px}.summary{font-size:12px;margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere}.diff{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.pane{min-width:0}.label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;opacity:.62;margin-bottom:4px}pre{margin:0;padding:9px;border-radius:9px;background:color-mix(in srgb,CanvasText 6%,transparent);font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:250px;overflow:auto}.ok{color:#16803a}.bad{color:#b42318}.confirm{font-size:12px;display:flex;align-items:flex-start;gap:7px;margin-top:13px}.actions{justify-content:flex-start;flex-wrap:wrap;margin-top:9px}button{appearance:none;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);background:Canvas;color:CanvasText;border-radius:9px;padding:7px 10px;font:inherit;font-size:12px;cursor:pointer}button[aria-pressed="true"]{background:CanvasText;color:Canvas}button:disabled{opacity:.45;cursor:not-allowed}.primary{background:CanvasText;color:Canvas}.status{font-size:11px;opacity:.7}details summary{cursor:pointer;font-size:11px;margin-top:8px}.raw{max-height:440px}@media(max-width:520px){.shell{border-radius:14px}.head,main{padding:13px}.toolbar{align-items:flex-start;flex-direction:column}.diff{grid-template-columns:1fr}.tabs{width:100%}.tabs button{flex:1}}
</style></head><body><section class="shell"><header class="head"><h1>Thingtime ✨</h1><span class="badge">Limitless, bounded</span></header><main id="root"><div class="empty">Thingtime results will appear here.</div></main></section>
<script type="module">
const root=document.getElementById('root');
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current={},tab='result',selected=new Set(),busy=false;
const json=(v)=>esc(JSON.stringify(v,null,2));
const rowsOf=(data)=>data.things||data.schemas||data.history||data.runs||data.results||data.operations||data.preview?.operations||data.result?.things||data.result?.schemas||[];
const card=(item,i)=>{const title=item?.crystal?.name||item?.title||item?.summary||item?.id||item?.name||('Item '+(i+1));const meta=[item?.action,item?.thingtime?.join?.(' + '),item?.status,item?.updatedAt||item?.createdAt].filter(Boolean).join(' · ');const diff=(item?.before!==undefined||item?.after!==undefined)?'<div class="diff"><div class="pane"><div class="label">Before</div><pre>'+json(item.before)+'</pre></div><div class="pane"><div class="label">After</div><pre>'+json(item.after)+'</pre></div></div>':'';return '<article class="card"><div class="cardhead"><input class="pick" type="checkbox" data-index="'+i+'" '+(selected.has(i)?'checked':'')+' aria-label="Select '+esc(title)+'"><div><div class="title">'+esc(title)+'</div><div class="meta">'+esc(meta)+'</div></div></div><div class="summary '+(item?.ok===false?'bad':item?.ok===true?'ok':'')+'">'+esc(item?.error||item?.description||'')+'</div>'+diff+'<details><summary>Full details</summary><pre>'+json(item)+'</pre></details></article>'};
const render=(payload)=>{if(payload!==undefined)current=payload?.structuredContent??payload?.toolOutput??payload??{};const data=current;const rawRows=rowsOf(data);const list=Array.isArray(rawRows)?rawRows:(rawRows?[rawRows]:[]);const canApply=Boolean(data.receipt&&data.confirmationRequired);const body=tab==='raw'?'<pre class="raw">'+json(data)+'</pre>':tab==='diff'?((data.preview?.operations||data.operations||[]).map(card).join('')||'<div class="empty">No before/after diff in this result.</div>'):(list.slice(0,50).map(card).join('')||'<div class="card"><div class="title">'+esc(data.message||data.error||'Ready')+'</div><div class="summary">'+json(data)+'</div></div>');root.innerHTML='<div class="toolbar"><div class="tabs"><button data-tab="result" aria-pressed="'+(tab==='result')+'">Result</button><button data-tab="diff" aria-pressed="'+(tab==='diff')+'">Diff</button><button data-tab="raw" aria-pressed="'+(tab==='raw')+'">Raw</button></div><span class="count">'+selected.size+' selected</span></div><div class="grid">'+body+'</div>'+(canApply?'<label class="confirm"><input id="confirm" type="checkbox"> I reviewed the full plan and want to apply it to '+esc(data.account?.label||data.account?.id||'this account')+'.</label><div class="actions"><button id="apply" class="primary" disabled>Apply signed plan</button><span id="status" class="status"></span></div>':'');bind()};
const bind=()=>{root.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>{tab=el.dataset.tab;render()}));root.querySelectorAll('.pick').forEach(el=>el.addEventListener('change',()=>{const i=Number(el.dataset.index);el.checked?selected.add(i):selected.delete(i);render()}));const confirm=root.querySelector('#confirm'),apply=root.querySelector('#apply');if(confirm&&apply)confirm.addEventListener('change',()=>apply.disabled=!confirm.checked||busy);if(apply)apply.addEventListener('click',async()=>{if(busy||!confirm?.checked)return;busy=true;apply.disabled=true;const status=root.querySelector('#status');if(status)status.textContent='Applying…';try{if(!window.openai?.callTool)throw new Error('Apply this confirmed plan from the chat to continue.');const args={receipt:current.receipt,accountId:current.account?.id,confirmed:true,...(current.run?.id?{runId:current.run.id}:{})};const result=await window.openai.callTool('apply_thingtime_mutation',args);busy=false;selected.clear();tab='result';render(result)}catch(error){busy=false;if(status)status.textContent=error?.message||'Could not apply.'}})};
window.addEventListener('message',event=>{if(event.source!==window.parent)return;const message=event.data;if(message?.jsonrpc==='2.0'&&message.method==='ui/notifications/tool-result')render(message.params)});
if(window.openai?.toolOutput)render(window.openai.toolOutput);
</script></body></html>`;
