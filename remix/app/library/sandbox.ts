import type { LibraryExample } from './types';
import { parseExampleInput } from './request';
const js = (value: unknown) =>
	JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
// No authored JavaScript or URL enters this document. Only compiled catalogue code.
// The opaque-origin frame cannot access Thingtime cookies, storage or the parent DOM.
export function exampleSandbox(example: LibraryExample, input: Record<string, unknown>, runId: string) {
	parseExampleInput(JSON.stringify(input));
	if (!example.module || !example.code || !/^https:\/\/esm\.sh\/[a-zA-Z0-9@./_-]+\?bundle$/.test(example.module))
		throw new Error('Unsupported remote module.');
	const send = `const send=(ok,result)=>{let text;try{text=JSON.stringify(result,(_,v)=>typeof v==="bigint"?String(v):v,2)??"null"}catch{text="Result is not serializable"}parent.postMessage({type:"tt-library",runId:${js(
		runId
	)},ok,text:text.slice(0,65536)},"*")};`;
	const job = `const m=await import(${js(example.module)});const input=${js(input)};${example.code}`;
	// Pure transforms run in a worker: even a user-entered enormous range can be
	// terminated without freezing the app. Visual demos need their isolated DOM.
	const execution = example.visual
		? `try{const root=document.getElementById("preview");const result=await (async()=>{${job}})();send(true,result)}catch{send(false,"Demo failed. Check the inputs or retry the remote module.")}`
		: `const source=${js(
				`onmessage=async()=>{try{const result=await(async()=>{${job}})();postMessage({ok:true,result})}catch{postMessage({ok:false,result:"Demo failed. Check the inputs or retry the remote module."})}}`
		  )};const url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));const worker=new Worker(url);const timeout=setTimeout(()=>{worker.terminate();send(false,"The demo exceeded its 15-second time limit.")},15000);worker.onmessage=e=>{clearTimeout(timeout);worker.terminate();URL.revokeObjectURL(url);send(e.data.ok,e.data.result)};worker.onerror=()=>{clearTimeout(timeout);worker.terminate();send(false,"The remote module could not load. Retry when the CDN is available.")};worker.postMessage(null);addEventListener("pagehide",()=>worker.terminate());`;
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://esm.sh blob:; worker-src blob:; connect-src https://esm.sh; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:#fafafb;color:#24242b;font:14px system-ui}*{box-sizing:border-box}#preview{padding:16px;min-height:280px;height:320px;overflow:auto}svg{max-width:100%;height:auto}canvas{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style></head><body><div id="preview"></div><script type="module">${send}${execution}</script></body></html>`;
}
