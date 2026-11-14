import React from 'react';
import { useRouteLoaderData } from 'react-router';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { CHARACTER_HEADER } from '../Characters/CharacterScope';
import { useCharacterScope } from '../Characters/CharacterScope';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { attachmentContentUrl, normalizePublicAttachment } from './attachmentUiCore';
import { isPdfAttachment, PDF_VIEWER_TEMPLATE, bindPdfPresentation, type PdfPresentationState, pdfAttachmentFromSource } from './pdfPresentation';
import { useSharedMediaUrl } from '../Sharing/SharedMedia';
import { HtmlThingRenderer, type HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '~/utils/dataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { MAX_ATTACHMENT_RANGE_BYTES, readExactRange } from '~/api/utils/attachments/attachmentRanges';

const PAGE_CHUNK = 256 * 1024;
type PageContext = { document: PDFDocumentProxy | null; page: number; zoom: number; busy: (value: boolean) => void; success: () => void; failure: () => void; presentation: PdfPresentationState };
const PdfContext = React.createContext<PageContext | null>(null);

/** Narrow PDF byte/page adapter. Its toolbar is ordinary editable Component
 * markup, supplied as `children`; it never executes PDF scripts or annotations. */
export function PdfDocument({ attachment: input, src, version, children, renderedChildren }: { attachment?: unknown; src?: unknown; version?: unknown; children?: unknown; renderedChildren?: React.ReactNode }) {
  const attachment = pdfAttachmentFromSource(input, src);
  const mediaUrl = useSharedMediaUrl(), actor = useCurrentUser(), character = useCharacterScope(), plane = useDataPlane();
  const root = useRouteLoaderData('root') as { user?: { id?: string } } | undefined;
  const generation = React.useSyncExternalStore(rootIdentity.subscribe, () => rootIdentity.read().generation, () => 0);
  const host = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (visible || !host.current) return;
    if (!globalThis.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '400px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [visible]);
  const url = attachment ? mediaUrl(attachmentContentUrl(attachment.id)) : '';
  const identity = JSON.stringify([globalThis.location?.origin, root?.user?.id, actor?.id, character?.id, plane, generation, url, version]);
  if (!attachment || !isPdfAttachment(attachment) || !url) return null;
  return <div ref={host} style={{ minWidth: 0, minHeight: 240 }}>{visible ? <PdfDocumentSession key={identity} attachment={attachment} url={url} actorId={actor?.id} characterId={character?.id} plane={plane} expectedVersion={typeof version === 'string' ? version : undefined} template={children} renderedChildren={renderedChildren} /> : null}</div>;
}

function PdfDocumentSession({ attachment, url, actorId, characterId, plane, expectedVersion, template, renderedChildren }: {
  attachment: NonNullable<ReturnType<typeof normalizePublicAttachment>>; url: string; actorId?: string; characterId?: string; plane: string | null; expectedVersion?: string; template?: unknown; renderedChildren?: React.ReactNode;
}) {
  const mediaUrl = useSharedMediaUrl();
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = React.useState(1), [zoom, setZoom] = React.useState(1), [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState(''), [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController(); let disposed = false; let loading: PDFDocumentLoadingTask | undefined;
    setBusy(true); setError('');
    const headers: Record<string, string> = { ...(characterId ? { [CHARACTER_HEADER]: characterId } : {}), ...(actorId ? { [EXPECTED_ACTOR_HEADER]: actorId } : {}), ...(plane ? { [EXPECTED_DATA_PLANE_HEADER]: plane } : {}) };
    const fail = () => { if (!disposed) { setError('This PDF could not be opened. Retry, or download the original.'); setBusy(false); setDocument(null); } };
    const request = async (params: Record<string, string>) => {
      const endpoint = new URL(url, window.location.origin);
      if (endpoint.origin !== window.location.origin || endpoint.pathname !== '/api/v1/attachments/content') throw Error('Untrusted PDF source');
      for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
      const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok) { await response.body?.cancel(); throw Error('PDF bytes unavailable'); }
      return response;
    };
    void (async () => {
      await requireThingtimeCapability('api.attachment-content', '1.14.0');
      const [{ pdfjs }, metadata] = await Promise.all([import('./pdfRuntime.client'), request({ fingerprint: '1' }).then(r => r.json())]);
      const version = metadata.version, size = metadata.size;
      if (!/^[a-f0-9]{64}$/.test(version) || !Number.isSafeInteger(size) || size !== attachment.size || (expectedVersion && version !== expectedVersion)) throw Error('PDF version changed');
      const read = async (begin: number, end: number) => {
        const bytes = new Uint8Array(end - begin);
        for (let offset = begin; offset < end; offset += MAX_ATTACHMENT_RANGE_BYTES) {
          const range = { version, offset, length: Math.min(MAX_ATTACHMENT_RANGE_BYTES, end - offset) };
          const response = await request({ range: '1', version, offset: String(offset), length: String(range.length) });
          if (response.headers.get('ETag') !== `"${version}"`) { await response.body?.cancel(); throw Error('PDF version changed'); }
          bytes.set(await readExactRange(response, range, size, () => controller.signal.throwIfAborted()), offset - begin);
        }
        return bytes;
      };
      const initial = size ? await read(0, Math.min(size, PAGE_CHUNK)) : new Uint8Array();
      controller.signal.throwIfAborted();
      class Transport extends pdfjs.PDFDataRangeTransport {
        requestDataRange(begin: number, end: number) {
          if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > size) { fail(); return; }
          void read(begin, end).then(bytes => { if (!disposed) this.onDataRange(begin, bytes); }).catch(() => { fail(); void loading?.destroy(); });
        }
        abort() { controller.abort(); }
      }
      const range = new Transport(size, initial, initial.length === size, attachment.name);
      loading = pdfjs.getDocument({ range, rangeChunkSize: PAGE_CHUNK, disableAutoFetch: true, disableStream: true,
        useSystemFonts: true, useWorkerFetch: false,
        cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' });
      loading.onPassword = () => { fail(); void loading?.destroy(); };
      const loaded = await loading.promise;
      if (disposed) { await loading.destroy(); return; }
      setPage(1); setDocument(loaded);
    })().catch(() => { if (!disposed) fail(); });
    return () => { disposed = true; controller.abort(); void loading?.destroy(); };
  }, [url, attachment.id, attachment.size, attachment.name, actorId, characterId, plane, expectedVersion, retry]);
  const pages = document?.numPages || 0;
  const scope = { pdf: { page, pages, pagesLabel: pages || '—', zoomLabel: `${Math.round(zoom * 100)}%`, disabled: !document, previousDisabled: !document || page <= 1, nextDisabled: !document || page >= pages,
    name: attachment.name, downloadUrl: mediaUrl(attachmentContentUrl(attachment.id, true)), status: busy && !error ? '◌' : '', error, noError: !error } };
  const body = bindPdfPresentation(template || PDF_VIEWER_TEMPLATE, scope.pdf) as HtmlThingNode;
  const action = (name: string) => {
    if (name === 'retry') { setRetry(v => v + 1); return; }
    if (!document) return;
    if (name === 'previous') setPage(p => Math.max(1, p - 1));
    if (name === 'next') setPage(p => Math.min(pages, p + 1));
    if (name === 'zoom-out') setZoom(z => Math.max(0.1, Math.round((z - 0.25) * 100) / 100));
    if (name === 'zoom-in') setZoom(z => Math.round((z + 0.25) * 100) / 100);
    if (name === 'fit') setZoom(1);
  };
  return <PdfContext.Provider value={{ document, page, zoom, busy: setBusy, success: () => { setError(''); setBusy(false); }, presentation: scope.pdf, failure: () => { setError('This page could not be displayed. Retry, or download the original.'); setBusy(false); } }}>
    <div data-pdf-viewer aria-label={`PDF: ${attachment.name}`} aria-busy={busy && !error} style={{ minWidth: 0, width: '100%' }}
      onClick={event => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tt-pdf]'); if (button && !button.disabled) { event.preventDefault(); event.stopPropagation(); action(button.dataset.ttPdf!); } }}
      onChange={event => { const input = event.target as HTMLInputElement; if (input.dataset.ttPdf === 'page' && document) { const next = Number(input.value); if (Number.isInteger(next) && next >= 1 && next <= pages) setPage(next); } }}>
      {renderedChildren ?? <HtmlThingRenderer node={body} />}
    </div>
  </PdfContext.Provider>;
}

export function PdfPageCanvas() {
  const scope = React.useContext(PdfContext), host = React.useRef<HTMLDivElement>(null), canvas = React.useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = React.useState(640), [text, setText] = React.useState('');
  React.useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width)); observer.observe(host.current); return () => observer.disconnect();
  }, []);
  const callbacks = React.useRef(scope); callbacks.current = scope;
  const document = scope?.document, pageNumber = scope?.page, zoom = scope?.zoom;
  React.useEffect(() => {
    if (!document || !canvas.current || !pageNumber || !zoom || width <= 0) return;
    let disposed = false, render: RenderTask | undefined;
    callbacks.current?.busy(true); setText('');
    void document.getPage(pageNumber).then(async page => {
      if (disposed || !canvas.current) return;
      const base = page.getViewport({ scale: 1 }); const scale = Math.max(0.1, (width - 16) / base.width) * zoom;
      const viewport = page.getViewport({ scale });
      // Render budget controls pixel density, never file size or page count.
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
      canvas.current.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.current.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.current.style.width = `${viewport.width}px`; canvas.current.style.height = `${viewport.height}px`;
      render = page.render({ canvas: canvas.current, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
      const content = await page.getTextContent();
      if (!disposed) { setText(content.items.map(item => 'str' in item ? item.str : '').join(' ')); callbacks.current?.success(); }
    }).catch(error => { if (!disposed && error?.name !== 'RenderingCancelledException') callbacks.current?.failure(); });
    return () => { disposed = true; render?.cancel(); };
  }, [document, pageNumber, zoom, width]);
  return <div ref={host} style={{ width: '100%', minHeight: '240px', overflow: 'auto', padding: '8px', background: 'var(--tt-surface-alt, #f5f5f7)' }}>
    <canvas ref={canvas} role="img" aria-label={`PDF page ${scope?.page || 1}`} style={{ display: 'block', margin: '0 auto', background: 'white' }} />
    <details style={{ marginTop: '8px', maxWidth: '100%', overflowWrap: 'anywhere' }}><summary>Page text</summary><p>{text}</p></details>
  </div>;
}

export function PdfViewer({ attachment, version }: { attachment: unknown; version?: string }) {
  const metadata = normalizePublicAttachment(attachment);
  return <PdfDocument attachment={metadata} src={metadata ? attachmentContentUrl(metadata.id) : undefined} version={version} />;
}

/** Builder element children retain their normal selection/editing wrappers.
 * Only the narrow PDF-local attribute namespace is bound by this context. */
export function usePdfElementBinding(attributes: Record<string, unknown> | undefined, children: React.ReactNode) {
  const context = React.useContext(PdfContext);
  if (!context) return { attributes, children };
  const bound = bindPdfPresentation({ tag: 'span', props: attributes }, context.presentation) as { props?: Record<string, unknown>; children?: unknown };
  return { attributes: bound.props, children: attributes?.['data-tt-pdf-value'] ? bound.children as React.ReactNode : children };
}
