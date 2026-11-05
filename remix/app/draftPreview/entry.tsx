import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { HtmlThingRenderer, type HtmlThingNode } from '../components/Kinds/HtmlThingRenderer';
import { WebpageBlocksRenderer } from '../components/Builder/WebpageBlocksRenderer';
import { prepareDraft, resolveDraftComponent } from './prepare';

type Draft = Awaited<ReturnType<typeof prepareDraft>>;
class RenderBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <output data-render-error>{this.state.error}</output> : this.props.children; }
}
function Preview({ draft }: { draft: Draft }) {
  return <RenderBoundary key={draft.hash}><div id="native-preview" data-content-hash={draft.hash}>
    {draft.root.thingtime[0] === 'component'
      ? <HtmlThingRenderer node={resolveDraftComponent(draft.root) as HtmlThingNode} />
      : <WebpageBlocksRenderer blocks={draft.root.crystal.blocks as any} componentsByRef={draft.components} interactive={false} draftAddresses bare />}
  </div></RenderBoundary>;
}
let update: (draft: Draft) => void;
let busy = false;
let current: Draft | undefined;
const status = document.querySelector('#diagnostics')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;
function App() {
  const [draft, setDraft] = React.useState<Draft>();
  update = next => { flushSync(() => setDraft(next)); };
  return <ChakraProvider resetCSS={false}>{draft ? <Preview draft={draft} /> : null}</ChakraProvider>;
}
const router = createMemoryRouter([{ id: 'root', path: '/', loader: () => ({ user: null }), element: <App /> }]);
createRoot(document.getElementById('preview-mount')!).render(<RouterProvider router={router} />);

async function render(content: unknown, root?: string) {
  if (busy) throw new Error('A draft render is already running');
  busy = true;
  current = undefined;
  exportButton.disabled = true;
  document.querySelector('#preview-mount')!.setAttribute('aria-busy', 'true');
  try {
    const draft = await prepareDraft(content, root);
    if (!update) throw new Error('Renderer is not ready');
    update(draft);
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const error = document.querySelector('[data-render-error]');
    if (error) throw new Error(`Native renderer failed: ${error.textContent}`);
    const preview = document.querySelector('#native-preview')!;
    if (!preview?.textContent?.trim() || !preview.getBoundingClientRect().height) throw new Error('Native renderer produced empty content');
    current = draft;
    exportButton.disabled = false;
    status.textContent = JSON.stringify({ ok: true, hash: draft.hash, diagnostics: draft.diagnostics }, null, 2);
    return { ok: true, json: draft.json, hash: draft.hash, diagnostics: draft.diagnostics, root: draft.root.id };
  } catch (error) {
    status.textContent = JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Render failed' });
    throw error;
  } finally { busy = false; document.querySelector('#preview-mount')!.removeAttribute('aria-busy'); }
}
// A caller-supplied value only; never a URL, account lookup, action or persisted ID.
(window as any).thingtimeDraft = { version: 1, render };
document.querySelector('#render')!.addEventListener('click', () => {
  void render((document.querySelector('#content') as HTMLTextAreaElement).value, (document.querySelector('#root-ref') as HTMLInputElement).value || undefined).catch(() => {});
});
document.querySelector('#export')!.addEventListener('click', () => {
  if (!current || busy) return;
  const url = URL.createObjectURL(new Blob([current.json], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'thingtime-draft.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
