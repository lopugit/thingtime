import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingsGridView } from '../app/components/Things/ThingsViews';
import { ThingRenderComponent } from '../app/components/Thingtime/ThingRenderComponent';
import { ContentExecutionBoundary, useContentExecutionHeld } from '../app/components/Builder/ContentExecutionHold';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { PageActionSurface } from '../app/components/Builder/PageActionSurface';
import { LiveTemplate, useThingSource } from '../app/components/Builder/liveComponent';
import { useTtActionClicks } from '../app/components/Actions/useTtActionClicks';
import { ComponentSelect, ComponentDataScope } from '../app/components/Builder/ComponentSelect';
import { ComponentUpload, ComponentUploadEnabled } from '../app/components/Builder/ComponentUpload';
import { ComponentLocalControl, NativeControlsEnabled } from '../app/components/Builder/NativeComponentControls';

const fixture = (window as any).restoreFixture = {
 referenceHeld:true, calls: [] as string[], queryCalls: [] as string[], localControls: {} as Record<string, ((input:Record<string,unknown>)=>void) | null>, runs: [] as any[], confirms: 0, confirmPending: false, defer: false, resolveConfirm: null as null | ((value: boolean) => void),
 api: { v1: { things:{get:async()=>({thing:{id:'referenced-renderer',thingtime:['component'],executionHeld:fixture.referenceHeld,crystal:{render:{tag:'p',children:['Referenced presentation remains readable.']}}}})}, actions: { run: async ({action,inputs}: any) => { fixture.calls.push(action); fixture.runs.push({action,inputs}); return {status:'ok', result:{silent:true}, durationMs:1, opsUsed:1}; } } } },
 runtime: { identity:{key:1}, viewer:{id:'isolated-viewer',signedIn:true}, query:{}, pageId:'synthetic-restored-page', version:0, refreshVersion:0, last:null, installing:false, sharedRun:undefined,
  load: (_key:string, fetcher:()=>Promise<unknown>)=>fetcher(), refresh:()=>fixture.calls.push('$refresh'), install:async()=>{fixture.calls.push('$install'); return true;}, report:()=>{}, setPageQuery:(params:any)=>fixture.queryCalls.push(params.marker) },
};
function HookControls() {
 const held = useContentExecutionHeld(false);
 const click = useTtActionClicks({ executionHeld:false, onLocal:()=>fixture.calls.push('$ui'), confirm:async()=>{
  fixture.confirms++; if (!fixture.defer) return true;
  fixture.confirmPending=true; return await new Promise<boolean>(resolve=>{fixture.resolveConfirm=(value)=>{fixture.confirmPending=false;resolve(value);};});
 }});
 const source = useThingSource({source:{action:'source-autorun',refresh:'load'}, cacheId:'hold-test',argValues:{},interactive:true,executionHeld:false});
 return <section aria-label="Hook controls" onClickCapture={click}>
  <p>Inherited hold: <span data-testid="held">{String(held)}</span></p><p>Source state: <span data-testid="source-state">{source.scope.state}</span></p>
  <input aria-label="Ordinary draft" defaultValue="Before restore" />
  {['$ui','$refresh','$install','saved-action'].map(action=><button key={action} data-tt-action={action} data-tt-action-inputs={JSON.stringify({op:'set',key:'selected',value:true})}>{action}</button>)}
 </section>;
}
function LocalControlProbe({name}:{name:string}) {
 const control=React.useContext(ComponentLocalControl);
 fixture.localControls[name]=control;
 return null;
}
function NativeProbe() {
 const native = React.useContext(NativeControlsEnabled), upload = React.useContext(ComponentUploadEnabled);
 return <><LocalControlProbe name="live" /><p>Native controls enabled: <span data-testid="native-enabled">{String(native)}</span></p><p>Upload enabled: <span data-testid="upload-enabled">{String(upload)}</span></p>
 <ComponentDataScope.Provider value={{choices:[{id:'one',title:'One'}]}}><ComponentSelect compact title="Native selection" optionsPath="choices" /></ComponentDataScope.Provider>
 <ComponentUpload name="attachment" title="Synthetic file" /></>;
}
function App() {
 const [held,setHeld]=React.useState(true);
 const [projectionHeld,setProjectionHeld]=React.useState(true);
 const [pageHeld,setPageHeld]=React.useState(false);
 (fixture as any).setPageHeld=setPageHeld;
 (fixture as any).setProjectionHeld=setProjectionHeld;
 (fixture as any).setHeld=setHeld;
 return <main style={{maxWidth:840,margin:'auto',padding:20}}>
 <style>{`body { margin:0; color:#20252a; background:#fafafa; font:16px/1.5 system-ui,sans-serif; } main { box-sizing:border-box; } h1 { font-size:24px; font-weight:650; margin:0 0 8px; } section { display:flex; flex-wrap:wrap; gap:10px; margin:16px 0; } section p,section input { flex-basis:100%; } p { margin:6px 0; } button { padding:7px 10px; border:1px solid #ccc; border-radius:7px; background:white; margin:4px 4px 4px 0; } input { max-width:100%; box-sizing:border-box; border:1px solid #ccc; padding:8px; border-radius:6px; } fieldset { min-width:0; } [data-live] { display:grid; gap:8px; }`}</style>
 <h1>Restored content remains readable</h1><p>This browser fixture uses synthetic account and API responses.</p>
 <div data-testid="inherited-boundary"><ContentExecutionBoundary held={held}><ContentExecutionBoundary held={false}>
 <HookControls />
 <LiveTemplate interactive executionHeld={false} scope={{}} render={{tag:'div',children:[{tag:'p',children:['Saved presentation and ordinary fields remain visible.']},{tag:'input',props:{'aria-label':'Rendered draft',defaultValue:'Saved input'}},{tag:'button',props:{'data-tt-action':'template-action'},children:['Template action']}]}}><NativeProbe /></LiveTemplate>
 </ContentExecutionBoundary></ContentExecutionBoundary></div>
 <section aria-label="Projected saved component" style={{display:'block'}}>
 <h2>Independent restored component</h2>
 <WebpageBlocksRenderer interactive blocks={[{id:'projected-component',type:'component',component:'held-component'}]} componentsByRef={{'held-component':{id:'saved-component',executionHeld:projectionHeld,crystal:{source:{action:'projected-source',refresh:'load'},render:{tag:'div',children:[{tag:'p',children:['Projected component remains readable.']},{tag:'button',props:{'data-tt-action':'projected-action'},children:['Projected action']}]}}}}} />
 </section>
 <ContentExecutionBoundary held={pageHeld}><PageActionSurface actionEnabled><LocalControlProbe name="page" />
 <h2>Independent expanded rows</h2><input name="unrelated" defaultValue="Must never leak into either row" aria-label="Unrelated field" />
 {['first','second'].map(row=><div key={row} data-tt-action-group><input name="title" defaultValue={row} aria-label={`${row} row title`} /><button data-tt-action={`row-${row}`}>{`Run ${row} row`}</button></div>)}
 </PageActionSurface></ContentExecutionBoundary>
 <section aria-label="Library held preview" style={{display:'block'}}><h2>Library preview</h2>
 <ThingsGridView displayMode="preview" items={[{id:'preview-data',executionHeld:held,thingtime:['note'],visibility:'private',author:null,targetId:null,folderId:null,acl:[],tags:[],createdAt:'2026-11-06T00:00:00Z',updatedAt:'2026-11-06T00:00:00Z',extended:null,crystal:{name:'Restored preview',executionHeld:false,tag:'p',children:['Flattened preview remains readable.']}}] as any} handlers={{selected:new Set(),cutIds:new Set(),isMobile:false,compact:true,dropTargetId:null,onItemClick:()=>{},onItemOpen:()=>{},onItemToggle:()=>{},onItemAction:()=>{},onItemContextMenu:()=>{},onItemDragStart:()=>{},onItemDragEnd:()=>{},onFolderDragOver:()=>{},onFolderDragLeave:()=>{},onFolderDrop:()=>{},itemMenuFor:()=>({items:[]})} as any} />
 </section>
 <section aria-label="Referenced held renderer" style={{display:'block'}}><h2>Referenced display Component</h2><ThingRenderComponent thing={{id:'unheld-data',renderComponent:{id:'referenced-renderer'},executionHeld:false}} /></section>
 <section aria-label="Held embedded renderer" style={{display:'block'}}><h2>Embedded display Component</h2><ThingRenderComponent thing={{id:'held-embedded-data',executionHeld:held,renderComponent:{render:{tag:'p',children:['Embedded presentation remains readable.']}}}} /></section>
 <div style={{height:700}} aria-hidden="true" /><p>End of restored content</p>
 </main>;
}
const router=createMemoryRouter([{id:'root',path:'/',loader:()=>({user:{id:'isolated-viewer'}}),element:<App />}]);
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
