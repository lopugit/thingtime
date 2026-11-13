export const THINGTIME_MCP_UI_RESOURCE_URI = 'ui://thingtime/review-v1.1.1.html';
// Historical tool results may still reference the previous host cache key.
export const THINGTIME_MCP_UI_LEGACY_RESOURCE_URI = 'ui://thingtime/review.html';
export const THINGTIME_CAPABILITY_CONTRACT_URI = 'thingtime://capability-contract';
export const THINGTIME_MUTATION_RECEIPT_PURPOSE = 'thingtime-mcp-mutation-preview';

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
  source?: { kind: 'undo'; historyId: string } | { kind: 'workflow'; runId: string };
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
  status: 'awaiting_confirmation' | 'previewed' | 'applied' | 'cancelled' | 'failed';
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

export const normalizeLimitlessMutationOperations = (
  raw: unknown,
  { assignCreateIds = true }: { assignCreateIds?: boolean } = {}
): Failure | Success<LimitlessMutationOperation[]> => {
  if (!Array.isArray(raw) || !raw.length) return { ok: false, error: 'operations must be a non-empty list' };
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
      const thing = { ...candidate.thing };
      const proposedId = thing.shareId ?? thing.id;
      const id = proposedId === undefined && assignCreateIds ? crypto.randomUUID() : boundedId(proposedId);
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
      if (['id', 'shareId', 'replaceCrystal', 'expectedUpdatedAt'].some((key) => Object.prototype.hasOwnProperty.call(candidate.patch, key))) {
        return { ok: false, error: `operations[${index}].patch cannot contain mutation control fields` };
      }
      operations.push({
        action,
        id,
        patch: candidate.patch,
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
      inverseOperations.push({ action: 'delete', id: operation.id });
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
      inverseOperations.push({ action: 'create', id: operation.id, thing: restorableThing(before!) });
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
    inverseOperations.push({
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
    inverseOperations: inverseOperations.reverse()
  };
  return { ok: true, value: preview };
};

const inputAtPath = (inputs: Record<string, unknown>, rawPath: unknown): unknown => {
  if (typeof rawPath !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(rawPath)) return undefined;
  let current: unknown = inputs;
  for (const segment of rawPath.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
};

const resolveWorkflowValue = (value: unknown, inputs: Record<string, unknown>): Failure | Success<unknown> => {
  const root: { value?: unknown } = {};
  // Traverse iteratively so nesting is limited by the underlying data format,
  // rather than the workflow compiler's call stack or a small product cap.
  const stack: Array<{ value: unknown; set: (resolved: unknown) => void }> = [{ value, set: (resolved) => { root.value = resolved; } }];
  while (stack.length) {
    const item = stack.pop()!;
    if (Array.isArray(item.value)) {
      const result: unknown[] = new Array(item.value.length);
      item.set(result);
      for (let index = item.value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: item.value[index], set: (resolved) => { result[index] = resolved; } });
      }
    } else if (isRecord(item.value)) {
      const keys = Object.keys(item.value);
      if (keys.length === 1 && keys[0] === '$input') {
        const path = item.value.$input;
        const resolved = inputAtPath(inputs, path);
        if (resolved === undefined) return { ok: false, error: `Missing workflow input: ${String(path)}` };
        item.set(resolved);
        continue;
      }
      if (keys.some((key) => key.startsWith('$'))) {
        return { ok: false, error: 'Capability objects may only use the exact {$input:"path"} placeholder form' };
      }
      const result: Record<string, unknown> = {};
      item.set(result);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        stack.push({ value: item.value[key], set: (resolved) => { Object.defineProperty(result, key, { value: resolved, enumerable: true, writable: true, configurable: true }); } });
      }
    } else {
      item.set(item.value);
    }
  }
  return { ok: true, value: root.value };
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
  const resolved = resolveWorkflowValue(crystal.operations, inputs);
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
  transport: {
    stagedPlans: 'stage_thingtime_mutation_plan',
    pagedReview: 'get_thingtime_mutation_preview'
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
    description: 'Build a mutation plan, inspect its full diff, and follow the selected account’s confirmation requirements before apply.',
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
:root{color-scheme:light dark;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:transparent;color:CanvasText}.shell{border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:18px;overflow:hidden;background:Canvas}.head,.toolbar,.actions{display:flex;align-items:center;justify-content:space-between;gap:10px}.head{padding:15px 17px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent)}h1{font-size:15px;margin:0}.badge,.count{font-size:11px;padding:4px 8px;border-radius:999px;background:color-mix(in srgb,CanvasText 8%,transparent)}main{padding:16px}.toolbar{margin-bottom:12px;align-items:flex-end}.tabs{display:flex;gap:5px}.empty{opacity:.68;font-size:13px}.grid{display:grid;gap:10px}.card{border:1px solid color-mix(in srgb,CanvasText 13%,transparent);border-radius:13px;padding:12px}.cardhead{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start}.title{font-weight:650;font-size:13px;overflow-wrap:anywhere}.meta{font-size:11px;opacity:.65;margin-top:3px}.summary{font-size:12px;margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere}.diff{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.pane{min-width:0}.label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;opacity:.62;margin-bottom:4px}pre{margin:0;padding:9px;border-radius:9px;background:color-mix(in srgb,CanvasText 6%,transparent);font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:250px;overflow:auto}.ok{color:#16803a}.bad{color:#b42318}.confirm{font-size:12px;display:flex;align-items:flex-start;gap:7px;margin-top:13px}.actions{justify-content:flex-start;flex-wrap:wrap;margin-top:9px}button{appearance:none;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);background:Canvas;color:CanvasText;border-radius:9px;padding:7px 10px;font:inherit;font-size:12px;cursor:pointer}button[aria-pressed="true"]{background:CanvasText;color:Canvas}button:disabled{opacity:.45;cursor:not-allowed}.primary{background:CanvasText;color:Canvas}.status{font-size:12px;opacity:.8}.actions button{min-height:44px}.actions button:focus-visible,.tabs button:focus-visible{outline:2px solid currentColor;outline-offset:2px}details summary{cursor:pointer;font-size:11px;margin-top:8px}.raw{max-height:440px}@media(max-width:520px){.shell{border-radius:14px}.head,main{padding:13px}.toolbar{align-items:flex-start;flex-direction:column}.diff{grid-template-columns:1fr}.tabs{width:100%}.tabs button{flex:1}}
</style></head><body><section class="shell"><header class="head"><h1>Thingtime ✨</h1><span class="badge">Limitless, bounded</span></header><main id="root"><div class="empty">Thingtime results will appear here.</div></main></section>
<script type="module">
const root=document.getElementById('root');
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current={},tab='result',selected=new Set(),busy=false,reviewPages=new Map(),bridgeError='',operationError='',generation=0;
const applyStates=new Map();
const pending=new Map();
let nextRequest=0,bridgeState='initializing';
const statusError=(message)=>{bridgeError=message;const status=root.querySelector('#status');if(status)status.textContent=message;else{const el=document.createElement('div');el.id='status';el.className='status';el.setAttribute('role','status');el.textContent=message;root.append(el);}};
const request=(method,params,timeout)=>new Promise((resolve,reject)=>{if(pending.size>=8){reject(new Error('Thingtime is busy. Try again after the current request.'));return;}const id='thingtime-ui-'+(++nextRequest);const timer=setTimeout(()=>{pending.delete(id);const error=new Error(method==='tools/call'?'Thingtime did not confirm the result. Check the plan history in chat before applying again.':'Thingtime could not connect to this result card.');error.uncertain=method==='tools/call';error.timeout=true;reject(error);},timeout);pending.set(id,{resolve,reject,timer,method});try{window.parent.postMessage({jsonrpc:'2.0',id,method,params},'*');}catch(error){clearTimeout(timer);pending.delete(id);reject(new Error('Thingtime could not contact the host.'));}});
// A legacy host is selected only during harmless initialization, never after a tool dispatch.
const initialize=()=>request('ui/initialize',{appInfo:{name:'Thingtime',version:'1.1.1'},appCapabilities:{},protocolVersion:'2026-01-26'},15000);
const callTool=async(name,args)=>{await connected;if(bridgeState==='ready')return request('tools/call',{name,arguments:args},60000);if(bridgeState==='legacy')return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{const error=new Error('Thingtime did not confirm the result. Check the plan history in chat before applying again.');error.uncertain=true;reject(error);},60000);Promise.resolve().then(()=>window.openai.callTool(name,args)).then(result=>{clearTimeout(timer);resolve(result);},()=>{clearTimeout(timer);const error=new Error('Thingtime did not confirm the result. Check the plan history in chat before applying again.');error.uncertain=true;reject(error);});});throw new Error(bridgeError||'Continue this operation in chat.');};

const json=(v)=>esc(JSON.stringify(v,null,2));
const rowsOf=(data)=>data.things||data.schemas||data.history||data.runs||data.results||data.operations||data.preview?.operations||data.result?.things||data.result?.schemas||[];
const card=(item,i)=>{const title=item?.crystal?.name||item?.title||item?.summary||item?.id||item?.name||('Item '+(i+1));const meta=[item?.action,item?.thingtime?.join?.(' + '),item?.status,item?.updatedAt||item?.createdAt].filter(Boolean).join(' · ');const diff=(item?.before!==undefined||item?.after!==undefined)?'<div class="diff"><div class="pane"><div class="label">Before</div><pre>'+json(item.before)+'</pre></div><div class="pane"><div class="label">After</div><pre>'+json(item.after)+'</pre></div></div>':'';return '<article class="card"><div class="cardhead"><input class="pick" type="checkbox" data-index="'+i+'" '+(selected.has(i)?'checked':'')+' aria-label="Select '+esc(title)+'"><div><div class="title">'+esc(title)+'</div><div class="meta">'+esc(meta)+'</div></div></div><div class="summary '+(item?.ok===false?'bad':item?.ok===true?'ok':'')+'">'+esc(item?.error||item?.description||'')+'</div>'+diff+'<details><summary>Full details</summary><pre>'+json(item)+'</pre></details></article>'};
const render=(payload)=>{if(payload!==undefined){generation++;busy=false;const incoming=payload?.structuredContent??payload?.toolOutput??payload??{};if(incoming.preview?.previewId===current.preview?.previewId&&incoming.preview&&current.receipt){current={...current,...incoming};}else{current=incoming;reviewPages=new Map();}operationError='';if(current.preview)reviewPages.set(current.preview.cursor??0,current.preview);}const data=current;const rawRows=rowsOf(data);const list=Array.isArray(rawRows)?rawRows:(rawRows?[rawRows]:[]);const page=data.preview;const canApply=Boolean(data.receipt&&page?.nextCursor===null);const previous=page?[...reviewPages.keys()].filter(v=>v<page.cursor).sort((a,b)=>b-a)[0]:undefined;const paging=page&&((page.cursor??0)>0||page.nextCursor!==null)?'<div class="actions">'+(previous!==undefined?'<button id="prev">Previous page</button>':'')+'<span id="page-range" class="status" tabindex="-1">Operations '+(page.cursor+1)+'–'+(page.cursor+page.operations.length)+' of '+page.total+'</span>'+(page.nextCursor!==null?'<button id="next">Next page</button>':'')+'</div>':'';const body=tab==='raw'?'<pre class="raw">'+json(data)+'</pre>':tab==='diff'?((data.preview?.operations||data.operations||[]).map(card).join('')||'<div class="empty">No before/after diff in this result.</div>'):(list.map(card).join('')||'<div class="card"><div class="title">'+esc(data.message||data.error||'Ready')+'</div><div class="summary">'+json(data)+'</div></div>');root.innerHTML='<div class="toolbar"><div class="tabs"><button data-tab="result" aria-pressed="'+(tab==='result')+'">Result</button><button data-tab="diff" aria-pressed="'+(tab==='diff')+'">Diff</button><button data-tab="raw" aria-pressed="'+(tab==='raw')+'">Raw</button></div><span class="count">'+selected.size+' selected</span></div><div class="grid">'+body+'</div>'+paging+(canApply&&data.confirmationRequired?'<label class="confirm"><input id="confirm" type="checkbox"> I reviewed the full plan and want to apply it to '+esc(data.account?.label||data.account?.id||'this account')+'.</label>':'')+'<div class="actions">'+(canApply?'<button id="apply" class="primary" '+(data.confirmationRequired||applyStates.has(data.receipt)?'disabled':'')+'>Apply signed plan</button>':'')+'<span id="status" class="status" role="status">'+esc(bridgeError||applyStates.get(data.receipt)||operationError||data.error||'')+'</span></div>';bind()};
const focusRange=()=>root.querySelector('#page-range')?.focus({preventScroll:false});
const bind=()=>{const prev=root.querySelector('#prev'),next=root.querySelector('#next'),status=root.querySelector('#status');if(prev)prev.addEventListener('click',()=>{const cursor=[...reviewPages.keys()].filter(v=>v<current.preview.cursor).sort((a,b)=>b-a)[0];if(cursor!==undefined){current={...current,preview:reviewPages.get(cursor)};render();focusRange();}});if(next)next.addEventListener('click',async()=>{if(busy)return;const cursor=current.preview.nextCursor;const cached=reviewPages.get(cursor);if(cached){current={...current,preview:cached};render();focusRange();return;}const version=generation;busy=true;next.disabled=true;if(status)status.textContent='Loading…';try{const result=await callTool('get_thingtime_mutation_preview',{receipt:current.receipt,accountId:current.account?.id,cursor});if(version!==generation)return;const data=result?.structuredContent??result?.toolOutput??result;if(data?.preview?.previewId!==current.preview.previewId||data?.preview?.cursor!==cursor)throw new Error(data?.error||'Could not load the next page.');busy=false;selected.clear();render(result);focusRange();}catch(error){if(version!==generation)return;busy=false;next.disabled=false;operationError=error?.message||'Could not load the next page.';if(status)status.textContent=error?.message||'Could not load the next page.';}});root.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>{tab=el.dataset.tab;render()}));root.querySelectorAll('.pick').forEach(el=>el.addEventListener('change',()=>{const i=Number(el.dataset.index);el.checked?selected.add(i):selected.delete(i);render()}));const confirm=root.querySelector('#confirm'),apply=root.querySelector('#apply');if(confirm&&apply)confirm.addEventListener('change',()=>apply.disabled=!confirm.checked||busy||applyStates.has(current.receipt));if(apply)apply.addEventListener('click',async()=>{if(busy||applyStates.has(current.receipt)||(current.confirmationRequired&&!confirm?.checked))return;const version=generation,receipt=current.receipt;applyStates.set(receipt,'Applying…');busy=true;apply.disabled=true;const status=root.querySelector('#status');if(status)status.textContent='Applying…';try{const args={receipt:current.receipt,accountId:current.account?.id,...(confirm?.checked?{confirmed:true}:{}),...(current.run?.id?{runId:current.run.id}:{})};const result=await callTool('apply_thingtime_mutation',args);const data=result?.structuredContent??result?.toolOutput??result;if(data?.code==='confirmation_required'){applyStates.delete(receipt);if(version!==generation&&current.receipt!==receipt)return;busy=false;current={...current,...data};render();root.querySelector('#confirm')?.focus();return;}if(result?.isError){const error=new Error('Thingtime did not confirm the plan. Check its history in chat before applying again.');error.uncertain=true;throw error;}applyStates.set(receipt,'This plan was already submitted. Check its result in chat.');if(version!==generation){if(current.receipt===receipt)render();return;}busy=false;selected.clear();tab='result';render(result)}catch(error){if(error?.uncertain)applyStates.set(receipt,error?.message||'Check this plan history in chat.');else applyStates.delete(receipt);if(version!==generation){if(current.receipt===receipt)render();return;}busy=false;operationError=error?.message||'Could not apply.';apply.disabled=Boolean(applyStates.has(current.receipt)||(current.confirmationRequired&&!confirm?.checked));if(status)status.textContent=error?.message||'Could not apply.'}})};
window.addEventListener('message',event=>{if(event.source!==window.parent)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;if(message.method==='ui/notifications/tool-result'&&!Object.hasOwn(message,'id')){if(message.params&&typeof message.params==='object')render(message.params);return;}if(message.method!==undefined||typeof message.id!=='string')return;const entry=pending.get(message.id);if(!entry)return;const hasResult=Object.hasOwn(message,'result'),hasError=Object.hasOwn(message,'error');if(hasResult===hasError)return;if(hasError&&(!message.error||typeof message.error.code!=='number'||typeof message.error.message!=='string'))return;if(hasResult&&(!message.result||typeof message.result!=='object'))return;pending.delete(message.id);clearTimeout(entry.timer);if(hasError){const error=new Error(entry.method==='tools/call'?'Thingtime could not confirm the operation. Check its history in chat before applying again.':'Thingtime could not connect to this result card.');error.code=message.error.code;error.uncertain=entry.method==='tools/call';entry.reject(error);}else entry.resolve(message.result);});
const connected=initialize().then(result=>{if(result.protocolVersion!=='2026-01-26')throw new Error('This host uses an incompatible Thingtime result-card protocol.');bridgeState='ready';window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');},error=>{if(window.openai?.callTool&&(error.code===-32601||error.timeout===true)){bridgeState='legacy';return;}throw error;}).catch(error=>{bridgeState='failed';statusError(error.message||'Thingtime could not connect to this result card.');});
if(window.openai?.toolOutput)render(window.openai.toolOutput);
</script></body></html>`;
