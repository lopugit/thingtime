// Exercise only visible canonical UI controls. Never reads/writes workspace stores.
const wait = async (read, name) => {
  const until = performance.now() + 30000;
  while (performance.now() < until) { const value=read(); if(value)return value;await new Promise(r=>setTimeout(r,150)); }
  throw Error('Visible UI unavailable: '+name);
};
const visible = element => element && element.getClientRects().length > 0;
const byText = (selector,text) => [...document.querySelectorAll(selector)].find(x=>visible(x)&&x.textContent.trim()===text);
const enabled = element => element && !element.disabled && element.getAttribute('aria-disabled')!=='true' ? element : null;
// The actual shared menu renders a decorative icon before its label.
const menuByLabel = label => [...document.querySelectorAll('[role="menuitem"]')].find(item=>visible(item)&&[...item.querySelectorAll('p,span')].some(node=>node.textContent.trim()===label));
const readCard = card => ({thingId:card.getAttribute('data-thing-id'),selectLabel:card.querySelector('input[aria-label]')?.getAttribute('aria-label'),visibleText:card.innerText.slice(0,400)});
const field = (selector,value) => {
  const input=document.querySelector(selector);if(!visible(input))throw Error('Input unavailable');
  input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
};
const report={phase,documentTimeOrigin:performance.timeOrigin,syntheticThingKind:'folder',origin:location.origin,operations:[]};
try{
 if(location.origin!==expectedOrigin)throw Error('Local origin changed');
 if(phase==='create-edit'){
  const entry=await wait(()=>byText('h1','Things')||byText('button','Work on this device'),'Things library or explicit device-only action');
  if(entry.tagName==='BUTTON'){entry.click();report.operations.push('explicit-work-on-this-device');}
 }
 await wait(()=>byText('h1','Things'),'Things library heading');
 if(/Unexpected Application Error|Application Error!|Internal Server Error/.test(document.body.innerText))throw Error('Route error surface');
 const created='iOS local runtime persistence';const edited=created+' edited';
 if(phase==='create-edit'){
  (await wait(()=>byText('button','New'),'New menu')).click();
  (await wait(()=>[...document.querySelectorAll('[role="menuitem"]')].find(x=>visible(x)&&x.textContent.trim().endsWith('New folder')),'New folder action')).click();
  await wait(()=>document.querySelector('input[placeholder="Folder name"]'),'Folder name');field('input[placeholder="Folder name"]',created);
  (await wait(()=>enabled(byText('[role="dialog"] button','Create')),'Create folder')).click();
  const selected=await wait(()=>document.querySelector('input[aria-label="Select '+created+'"]'),'Saved folder');
  const card=selected.closest('[data-thing-id]');if(!card)throw Error('Saved Thing card missing');
  report.thingId=card.getAttribute('data-thing-id');report.operations.push('create-via-visible-folder-dialog');
  const rect=card.getBoundingClientRect();card.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+20,clientY:rect.top+20}));
  (await wait(()=>menuByLabel('Rename'),'Rename action')).click();
  await wait(()=>document.querySelector('input[aria-label="Thing title"]'),'Rename title');field('input[aria-label="Thing title"]',edited);
  (await wait(()=>enabled(byText('[role="dialog"] button','Rename')),'Save rename')).click();
  const renamed=await wait(()=>document.querySelector('input[aria-label="Select '+edited+'"]'),'Renamed Thing');
  report.beforeReloadReadback=readCard(renamed.closest('[data-thing-id]'));
  if(report.beforeReloadReadback.thingId!==report.thingId)throw Error('Renaming changed Thing identity');
  report.operations.push('edit-via-visible-rename-dialog');report.passed=true;
 }else{
  const selected=await wait(()=>document.querySelector('input[aria-label="Select '+edited+'"]'),'Retained edited Thing after reload');
  const card=selected.closest('[data-thing-id]');if(card?.getAttribute('data-thing-id')!==expectedThingId)throw Error('Retained Thing identity changed');
  report.afterReloadReadback=readCard(card);report.thingId=expectedThingId;report.operations.push('reload-retained-same-thing-and-edited-name');report.passed=true;
 }
 const response=await fetch('/.well-known/thingtime-capabilities.json',{redirect:'error'});const manifest=await response.json();
 if(response.status!==200||manifest.origin!==expectedOrigin)throw Error('Local capability read failed');
 report.manifestStatus=response.status;report.manifestOrigin=manifest.origin;
 report.rootChildren=document.querySelector('#root')?.childElementCount??0;
 report.viewportWidth=innerWidth;report.documentWidth=document.documentElement.scrollWidth;
 let rejected=false;try{await fetch('https://thingtime.com/.well-known/thingtime-capabilities.json',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(3000)});}catch{rejected=true;}
 report.externalRequestRejected=rejected;report.externalNetworking='blocked-in-this-WebView-only';report.localAccountApiSupported=false;
}catch(error){report.passed=false;report.error=error.message;report.visibleHeadings=[...document.querySelectorAll('h1,h2,[role="alert"]')].filter(visible).map(x=>x.textContent.trim().slice(0,250));report.visibleButtons=[...document.querySelectorAll('button,[role="menuitem"]')].filter(visible).map(x=>({text:x.textContent.trim().slice(0,100),label:x.getAttribute('aria-label')})).slice(0,35);}
return report;
