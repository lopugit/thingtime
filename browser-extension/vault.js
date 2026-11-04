import {safeOrigin, senderOrigin, PROVIDER_PATH} from './protocol.js';
import {sameWorkspaceTarget,workspacePreferences} from './workspace.js';
const failure = message => ({ok: false, error: message});
const metadata = value => ({id: value.id, title: typeof value.title === 'string' ? value.title : '', username: typeof value.username === 'string' ? value.username : '', domains: Array.isArray(value.domains) ? value.domains.filter(v => typeof v === 'string') : [], ...(Array.isArray(value.origins)?{origins:value.origins.filter(v=>typeof v==='string'&&safeOrigin(v)===v)}:{}), hasPassword: value.hasPassword === true, fillEligible: value.fillEligible === true});
/** A live owned first-party document is the credential source. No cookie access,
 * authenticated cross-origin fetch, secret persistence, or URL-based tab search. */
export function createVaultController(api, {settings, workspace, currentDocument, accountIdentity = () => null, accountAdmission = async () => true, randomUUID = () => crypto.randomUUID()}) {
  const sessions = new Map();
  const byProvider = new Map();
  const pending = new Map();
  const key = target => `${target.tabId}:${target.documentId}`;
  const checkpoint = () => api.storage.session.set({vaultRouting: [...sessions.values()].map(s => ({providerTabId:s.providerTabId, providerOrigin:s.providerOrigin}))});
  const providerURL = (value, origin) => {
    try { const u = new URL(value); return u.origin === origin && u.pathname === PROVIDER_PATH && u.searchParams.get('view') === 'vault'; } catch { return false; }
  };
  const recovered = (async () => {
    const saved = await api.storage.session.get('vaultRouting');
    for (const s of saved.vaultRouting || []) {
      const tab = await api.tabs.get(s.providerTabId).catch(() => null);
      if (tab && providerURL(tab.url, s.providerOrigin) && (!tab.pendingUrl || providerURL(tab.pendingUrl, s.providerOrigin))) await api.tabs.remove(tab.id).catch(() => {});
    }
    await api.storage.session.remove('vaultRouting');
  })();
  async function validTarget(target) {
    return target && await currentDocument(target.tabId, target.documentId, target.origin);
  }
  async function close(session) {
    if (sessions.get(key(session.target)) !== session) return;
    sessions.delete(key(session.target)); byProvider.delete(session.providerTabId);
    session.catalog = null; session.ownerId = null;
    void api.tabs.sendMessage(session.target.tabId,{action:'vault-source-invalidate',sessionId:session.id},{documentId:session.target.documentId}).catch(()=>{});
    for (const r of pending.values()) if (r.session === session) { pending.delete(r.id); await api.alarms.clear(`vault:${r.id}`); r.resolve({...failure('The vault connection ended. Reconnect to Thingtime.'),connectionEnded:true}); }
    const tab = await api.tabs.get(session.providerTabId).catch(() => null);
    if (tab && tab.windowId === session.providerWindowId && providerURL(tab.url, session.providerOrigin) && (!tab.pendingUrl || providerURL(tab.pendingUrl, session.providerOrigin))) await api.tabs.remove(tab.id).catch(() => {});
    await checkpoint();
  }
  const targetView = target => ({tabId:target.tabId,windowId:target.windowId,documentId:target.documentId,origin:target.origin});
  async function workspaceMatches(target, epoch) {
    if (workspace.generation && workspace.generation() !== epoch) return false;
    const latest = await workspace.target();
    return sameWorkspaceTarget(latest,target) && (!workspace.generation || workspace.generation() === epoch);
  }
  async function source(message, sender, internal) {
    const epoch=workspace.generation?.();
    const target = internal ? await workspace.target() : senderOrigin(sender) ? {tabId:sender.tab.id, documentId:sender.documentId, origin:senderOrigin(sender), windowId:sender.tab.windowId} : null;
    if (!target || internal && (message.action==='vault-fill'&&!message.target || message.target&&!sameWorkspaceTarget(message.target,target))) return null;
    if (!await validTarget(target)) return null;
    const tab = await api.tabs.get(target.tabId).catch(() => null);
    if (!tab || tab.pendingUrl || internal&&!await workspaceMatches(target,epoch)) return null;
    return {...target,windowId:tab.windowId,workspaceEpoch:epoch};
  }
  async function requestCurrent(r) {
    const s=r.session;
    const identityCurrent=()=>{
      const identity=accountIdentity();
      const expected=r.expectedOwnerId||s.ownerId;
      return (!s.identity||JSON.stringify(s.identity)===JSON.stringify(identity))&&(!identity||!expected||identity.ownerId===expected);
    };
    if(!identityCurrent())return false;
    if(r.cancelled||sessions.get(key(s.target))!==s||!r.responding&&pending.get(r.id)!==r||!await validTarget(s.target))return false;
    if(r.workspaceBound&&!await workspaceMatches(s.target,r.workspaceEpoch))return false;
    return identityCurrent()&&!r.cancelled&&sessions.get(key(s.target))===s&&(!r.workspaceBound||!workspace.generation||workspace.generation()===r.workspaceEpoch);
  }
  async function connection(target, caller, guard = async () => true, existingOnly = false) {
    if(!await accountAdmission())throw new Error('Unlock the Thingtime browser workspace to reconnect.');
    const config = await settings();
    if (config.autofillEnabled === false) throw new Error('Saved-account offers are disabled in Config.');
    if (!await accountAdmission())throw new Error('Unlock the Thingtime browser workspace to reconnect.');
    if (!await guard()) throw new Error('The selected website changed.');
    const origin = safeOrigin(config.origin); if (!origin) throw new Error('Choose a trusted Thingtime origin.');
    let s = sessions.get(key(target));
    if (s && s.providerOrigin !== origin) { await close(s); s = null; }
    if (s) {
      const frame = await api.webNavigation.getFrame({tabId:s.providerTabId, frameId:0}).catch(() => null);
      if (s.providerDocumentId && (frame?.documentId !== s.providerDocumentId || !providerURL(frame.url, origin))) { await close(s); s = null; }
    }
    if (s && !Number.isInteger(s.providerTabId)) throw new Error('The vault connection is opening.');
    if (!s) {
      if (existingOnly) throw new Error('The vault connection ended.');
      s = {id:randomUUID(),identity:accountIdentity(),target, providerOrigin:origin, caller, catalog:null, ownerId:null, providerTabId:null, providerWindowId:null};
      sessions.set(key(target), s);
      const stored = await api.storage.local.get('workspacePreferences');
      const p = workspacePreferences(stored.workspacePreferences);
      if (!await guard()) { await close(s); throw new Error('The selected website changed.'); }
      const win = await api.windows.create({url:`${origin}${PROVIDER_PATH}?view=vault`, type:'popup', focused:true, width:p.width, height:p.height});
      const tab = win.tabs?.[0];
      if (!tab || !Number.isInteger(tab.id) || sessions.get(key(target)) !== s || !await validTarget(target) || !await guard()) { if (tab) await api.tabs.remove(tab.id).catch(() => {}); await close(s); throw new Error('The requesting page changed.'); }
      s.providerTabId = tab.id; s.providerWindowId = win.id; byProvider.set(tab.id, s); await checkpoint();
      void api.tabs.sendMessage(tab.id,{action:'vault-provider-init'},{frameId:0}).catch(()=>{});
    }
    if (!await accountAdmission())throw new Error('Unlock the Thingtime browser workspace to reconnect.');
    if (!await guard()) throw new Error('The selected website changed.');
    return s;
  }
  async function deliver(s, r) {
    if (!s.providerDocumentId || r.waitingForCancellation || r.delivered || r.delivering || pending.get(r.id) !== r) return;
    r.delivering=true;
    if (!await requestCurrent(r)) { pending.delete(r.id);r.cancelled=true;await api.alarms.clear(`vault:${r.id}`);r.resolve(failure('The selected website changed.'));return; }
    const stored = await api.storage.local.get('workspacePreferences');
    if (!r.backgroundRefresh) await api.windows.update(s.providerWindowId,{focused:true}).catch(()=>{});
    if(!await requestCurrent(r)||r.cancelled||pending.get(r.id)!==r){pending.delete(r.id);r.cancelled=true;r.resolve(failure('The selected website changed.'));return;}
    r.delivered=true;
    const expectedOwnerId=r.expectedOwnerId||s.ownerId||s.identity?.ownerId;
    r.delivery=api.tabs.sendMessage(s.providerTabId, {action:'vault-provider-request', request:{version:1,id:r.id,type:r.type,origin:s.target.origin,target:{tabId:s.target.tabId,frameId:0,documentId:s.target.documentId},...(r.entryId?{entryId:r.entryId}:{}),...(r.totp?{totp:r.totp}:{}),...(r.query?{query:r.query}:{}),...(r.cursor?{cursor:r.cursor}:{}),...(expectedOwnerId?{expectedOwnerId}:{}),presentation:{fontSize:workspacePreferences(stored.workspacePreferences).fontSize}}}, {documentId:s.providerDocumentId});
    await r.delivery;
  }
  async function begin(s, request) {
    const prior=[...pending.values()].find(r=>r.session===s);
    if(prior&&(request.type!=='fill'||!prior.backgroundRefresh))return failure('Finish the current Thingtime request first.');
    if(prior){
      prior.cancelled=true;
      pending.delete(prior.id);
      void api.alarms.clear(`vault:${prior.id}`);
      prior.resolve({ok:false,superseded:true});
    }
    return new Promise(resolve => {
      const r = {...request,id:randomUUID(),session:s,resolve,delivered:false,waitingForCancellation:prior?.delivered===true}; pending.set(r.id,r);
      void api.alarms.create(`vault:${r.id}`,{delayInMinutes:5});
      void (async()=>{
        if(r.waitingForCancellation){
          await prior.delivery;
          const reply=await api.tabs.sendMessage(s.providerTabId,{action:'vault-provider-cancel',id:prior.id},{documentId:s.providerDocumentId});
          if(reply?.ok!==true){await close(s);return;}
          r.waitingForCancellation=false;
        }
        await deliver(s,r);
      })().catch(()=>close(s));
    });
  }
  async function focus(s) {
    try {
    if (!await validTarget(s.target)) return;
    const tab = await api.tabs.get(s.target.tabId).catch(() => null); if (!tab || tab.windowId !== s.target.windowId || tab.pendingUrl) return;
    await api.tabs.update(tab.id,{active:true}); await api.windows.update(tab.windowId,{focused:true});
    } catch { /* Document binding still controls delivery; never replay a fill to repair focus. */ }
  }
  async function handle(message, sender, internal) {
    await recovered;
    if (message?.action?.startsWith('vault-provider-')) {
      const s = byProvider.get(sender.tab?.id);
      if (!s || sender.frameId !== 0 || senderOrigin(sender) !== s.providerOrigin || !providerURL(sender.url,s.providerOrigin) || !await currentDocument(sender.tab.id,sender.documentId,s.providerOrigin,true) || !await validTarget(s.target)) return {ok:false};
      if (message.action === 'vault-provider-ready') {
        if (s.providerDocumentId && s.providerDocumentId !== sender.documentId) { await close(s); return {ok:false}; }
        s.providerDocumentId = sender.documentId;
        for (const r of pending.values()) if (r.session===s) await deliver(s,r);
        return {ok:true};
      }
      if (message.action === 'vault-provider-invalidate') { await close(s); return {ok:true}; }
      const r = pending.get(message.id);
      if (!r || r.session !== s || s.providerDocumentId !== sender.documentId || message.version !== 1) return {ok:false};
      if (!await requestCurrent(r)||r.cancelled||pending.get(r.id)!==r) { pending.delete(r.id);r.cancelled=true;r.resolve(failure('The selected website changed.'));return {ok:false}; }
      r.responding=true;
      pending.delete(r.id); await api.alarms.clear(`vault:${r.id}`);
      if(typeof message.ownerId!=='string'||(s.identity?.ownerId&&s.identity.ownerId!==message.ownerId)||(s.ownerId&&s.ownerId!==message.ownerId)){
        r.resolve({...failure('The selected Thingtime account changed.'),connectionEnded:true});await close(s);return {ok:false};
      }
      if(message.error){
        if(r.backgroundRefresh&&message.error.name==='NetworkError'&&s.catalog!==null&&s.ownerId===message.ownerId&&await requestCurrent(r)){
          r.resolve({ok:false,retryable:true,ownerId:s.ownerId});
          return {ok:true};
        }
        r.resolve({...failure('Thingtime could not complete this request. Reconnect and try again.'),connectionEnded:true});await close(s);return {ok:true};
      }
      s.ownerId=message.ownerId;
      if (r.type==='catalog') {
        s.catalog=(Array.isArray(message.catalog)?message.catalog:[]).filter(v=>typeof v?.id==='string' && v.fillEligible===true).map(metadata);
        if (!r.backgroundRefresh) {
          if (r.caller && Number.isInteger(r.caller.tabId)) { const caller=await api.tabs.get(r.caller.tabId).catch(()=>null); if(caller?.url===api.runtime.getURL('popup.html')) await api.windows.update(caller.windowId,{focused:true}).catch(()=>{}); } else await focus(s);
        }
        if(!await requestCurrent(r)){r.resolve(failure('The selected website changed.'));return {ok:false};}
        r.resolve({ok:true,connected:true,sessionId:s.id,target:targetView(s.target),ownerId:s.ownerId,origin:s.target.origin,catalog:s.catalog,nextCursor:typeof message.nextCursor==='string'?message.nextCursor:null});
      } else if (r.type==='fill') {
        const values=message.values;
        if (!values || typeof values.username!=='string' || typeof values.password!=='string' || !await validTarget(s.target)) r.resolve(failure('The requesting page changed.'));
        else {
          await focus(s);
          if (s.ownerId!==message.ownerId || !await requestCurrent(r)) { values.username=''; values.password=''; r.resolve(failure('The vault or requesting page changed.')); return {ok:true}; }
          const result=await api.tabs.sendMessage(s.target.tabId,{action:'vault-fill-values',nonce:r.capture.nonce,targetId:r.capture.targetId,origin:s.target.origin,entryId:r.entryId,username:values.username,password:values.password},{documentId:s.target.documentId}).catch(()=>null);
          r.resolve(result?.ok===true?{ok:true}:failure('The sign-in fields changed. Choose the account again.'));
          values.username=''; values.password='';
        }
      } else r.resolve({ok:true});
      return {ok:true};
    }
    const target=await source(message,sender,internal);
    if (!target) return failure('Open Thingtime from the toolbar on the website you want to use.');
    if (message.action==='vault-lock') { const s=sessions.get(key(target)); if(s)await close(s); return {ok:true}; }
    if (message.action==='vault-cached') {
      const s=sessions.get(key(target));
      const blank={ok:true,target:targetView(target),catalog:[],origin:target.origin};
      if(!await accountAdmission())return blank;
      if (!s?.providerDocumentId) return blank;
      if (!await currentDocument(s.providerTabId,s.providerDocumentId,s.providerOrigin,true)) { await close(s); return blank; }
      const config=await settings();
      if(internal&&!await workspaceMatches(target,target.workspaceEpoch))return failure('The selected website changed.');
      const identity=accountIdentity();
      if(sessions.get(key(target))!==s||safeOrigin(config.origin)!==s.providerOrigin||config.autofillEnabled===false||identity&&identity.ownerId!==s.ownerId)return blank;
      return {ok:true,connected:s.catalog!==null,sessionId:s.id,ownerId:s.ownerId,target:targetView(target),catalog:s.catalog||[],origin:target.origin};
    }
    if (!['vault-catalog','vault-fill','vault-import-totp'].includes(message.action)) return {ok:false};
    if(!await accountAdmission())return failure('Unlock the Thingtime browser workspace to reconnect.');
    if (message.action==='vault-fill') {
      if(typeof message.entryId!=='string' || !message.entryId) return {ok:false};
      const expected=message.expectedOwnerId;
      const changed=()=>({...failure('The selected Thingtime account changed. Reopen the account chooser.'),connectionEnded:true});
      if(expected!==undefined){
        const verifiedOwner=internal?accountIdentity()?.ownerId:sessions.get(key(target))?.ownerId;
        if(typeof expected!=='string'||expected!==verifiedOwner)return changed();
      }
      const capture=await api.tabs.sendMessage(target.tabId,{action:'vault-prepare',targetId:message.targetId},{documentId:target.documentId}).catch(()=>null);
      if(!capture?.ok || capture.origin!==target.origin || capture.actionOrigin!==target.origin ||
        typeof capture.nonce!=='string' || typeof capture.targetId!=='string' ||
        (message.targetId!==undefined && capture.targetId!==message.targetId) || !await validTarget(target))
        return failure('Choose an available sign-in field on this website.');
      const guard=async()=>await (internal?workspaceMatches(target,target.workspaceEpoch):validTarget(target))&&
        (!internal||expected===undefined||accountIdentity()?.ownerId===expected);
      const s=await connection(target,sender,guard,!internal&&expected!==undefined).catch(error=>{
        if(expected!==undefined)return null;
        throw error;
      });
      if(!s)return changed();
      if(expected!==undefined){
        const verifiedOwner=s.ownerId||(internal?s.identity?.ownerId:null);
        if(expected!==verifiedOwner||(internal&&accountIdentity()?.ownerId!==expected))return changed();
      }
      return begin(s,{type:'fill',entryId:message.entryId,expectedOwnerId:expected,capture,workspaceBound:internal,workspaceEpoch:target.workspaceEpoch});
    }
    const guard=()=>internal?workspaceMatches(target,target.workspaceEpoch):validTarget(target);
    const backgroundRefresh=message.action==='vault-catalog'&&message.backgroundRefresh===true;
    const existing=sessions.get(key(target));
    if(backgroundRefresh&&(!existing?.catalog||!existing.providerDocumentId))return failure('The vault connection ended. Reconnect to Thingtime.');
    const s=await connection(target,sender,guard,backgroundRefresh);
    if(message.action==='vault-import-totp') {
      if(!internal || typeof message.totp!=='string' || !/^otpauth:\/\/totp\//i.test(message.totp)) return {ok:false};
      return begin(s,{type:'totp-import',totp:message.totp,workspaceBound:internal,workspaceEpoch:target.workspaceEpoch});
    }
    return begin(s,{type:'catalog',backgroundRefresh,workspaceBound:internal,workspaceEpoch:target.workspaceEpoch,caller:internal?{tabId:sender.tab?.id}:null,query:typeof message.query==='string'?message.query:'',cursor:typeof message.cursor==='string'?message.cursor:''});
  }
  api.tabs.onRemoved.addListener(id=>{for(const s of sessions.values())if([s.target.tabId,s.providerTabId].includes(id))void close(s);});
  api.webNavigation.onCommitted.addListener(d=>{if(d.frameId!==0)return;for(const s of sessions.values())if(d.tabId===s.target.tabId&&d.documentId!==s.target.documentId||d.tabId===s.providerTabId&&(s.providerDocumentId&&s.providerDocumentId!==d.documentId||!providerURL(d.url,s.providerOrigin)))void close(s);});
  api.tabs.onUpdated.addListener((id,change)=>{for(const s of sessions.values())if(id===s.providerTabId){if(change.url&&!providerURL(change.url,s.providerOrigin))void close(s);else if(change.status==='complete')void api.tabs.sendMessage(id,{action:'vault-provider-init'},{frameId:0}).catch(()=>{});}});
  api.alarms.onAlarm.addListener(a=>{if(!a.name.startsWith('vault:'))return;const r=pending.get(a.name.slice(6));if(r)void close(r.session);});
  api.storage.onChanged?.addListener((_changes,area)=>{if(area==='local')for(const s of sessions.values())void settings().then(c=>{if(c.origin!==s.providerOrigin||c.autofillEnabled===false)void close(s);});});
  return {invalidate:()=>{for(const s of [...sessions.values()])void close(s);},handle:async(...args)=>{try{return await handle(...args);}catch{return failure('The vault or selected website changed. Reconnect and try again.');}}};
}
