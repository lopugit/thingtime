import React from 'react';
import { Modal, ModalBody, ModalCloseButton, ModalContent, ModalOverlay } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { useLopu } from '../Lopu/useLopu';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '../Nav/Drawer/useDrawer';
import { BuilderOverlayHost } from '../Builder/BuilderOverlayHost';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { SOCIAL_PREVIEW_TEMPLATES, SOCIAL_PREVIEW_LAYOUTS, socialPreviewShareUrl, socialPreviewDesignFromUrl, type SocialPreviewDesign } from '~/utils/socialPreviewDesign';
import { sharePreviewBlocks } from './sharePreviewBlocks';
import { OPEN_SHARE_PREVIEW, customisedShareLink, validShareDestination } from './sharePreviewLink';
const themeSwatches: Record<string, string> = {
 editorial: 'linear-gradient(100deg, #fff 0% 55%, #16161a 55% 70%, #6f3198 70% 85%, #00b7ef 85%)',
 'colour-blocks': 'linear-gradient(100deg, #59ff9c 0% 40%, #ffa3b1 40% 70%, #6f3198 70% 90%, #fff 90%)',
 'editorial-white': 'linear-gradient(100deg, #fff 0% 35%, #59bdff 35% 48%, #59ff9c 48% 61%, #a8e61d 61% 74%, #6f3198 74% 87%, #ffc20e 87%)',
 'pink-invitation': 'linear-gradient(100deg, #ff69b4 0% 35%, #fff 35% 65%, #59ff9c 65% 80%, #ffc20e 80% 90%, #6f3198 90%)',
 'night-garden': 'linear-gradient(100deg, #16161a 0% 50%, #a8e61d 50% 70%, #59bdff 70% 85%, #ff69b4 85%)'
};
type Metadata = { title: string; description: string; publicContent: boolean; image: { url: string; alt: string }; design: SocialPreviewDesign };
export function SharePreviewHost() {
 const user = useCurrentUser();
 const plane = useDataPlane();
 const location = useLocation();
 const identity = `${user?.id || 'guest'}:${plane || ''}:${location.key}`;
 const [selection, setSelection] = React.useState<{ identity: string; href: string } | null>(null);
 React.useEffect(() => {
  const open = (event: Event) => { try { const href = validShareDestination((event as CustomEvent).detail?.href, window.location.origin); setSelection({ identity, href }); } catch { /* Ignore unrelated or invalid event destinations. */ } };
  window.addEventListener(OPEN_SHARE_PREVIEW, open); return () => window.removeEventListener(OPEN_SHARE_PREVIEW, open);
 }, [identity]);
 return selection?.identity === identity ? <SharePreviewDialog key={`${identity}:${selection.href}`} href={selection.href} scopeKey={identity} onClose={() => setSelection(null)} /> : null;
}
export function SharePreviewDialog({ href, scopeKey, onClose }: { href: string; scopeKey: string; onClose: () => void }) {
 const lopu = useLopu();
 const [design, setDesign] = React.useState<SocialPreviewDesign>(() => socialPreviewDesignFromUrl(href));
 const [metadata, setMetadata] = React.useState<Metadata | null>(null);
 const [image, setImage] = React.useState('');
 const [busy, setBusy] = React.useState(true);
 const [error, setError] = React.useState('');
 const [retry, setRetry] = React.useState(0);
 const overlay = React.useRef<HTMLDivElement>(null);
 const destination = new URL(href, window.location.origin);
 const url = customisedShareLink(destination.href, window.location.origin, design);
 const active = React.useRef(true);
 React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
 React.useEffect(() => {
  const controller = new AbortController(); let preload: HTMLImageElement | undefined;
  setBusy(true); setError('');
  void (async () => {
   await requireThingtimeCapability('api.social-previews', '1.2.0', destination.origin, { fetch: window.fetch.bind(window), currentOrigin: () => window.location.origin, signal: controller.signal });
   const lookup = new URL('/api/v1/social-previews', destination.origin);
   // The server resolves anonymously. Hidden keys and unrelated query values
   // are retained in the copied destination but never used as metadata text.
   const previewUrl = new URL(socialPreviewShareUrl(destination.origin, url));
   lookup.searchParams.set('path', previewUrl.pathname + previewUrl.search);
   const response = await fetch(lookup, { credentials: 'omit', cache: 'no-store', signal: controller.signal, referrerPolicy: 'no-referrer' });
   const result = await response.json();
   if (!response.ok || result.ok !== true || typeof result.title !== 'string' || typeof result.description !== 'string') throw new Error('Could not load this link’s preview.');
   const imageUrl = new URL(result.image?.url, destination.origin);
   if (imageUrl.origin !== destination.origin || imageUrl.pathname !== '/social-card') throw new Error('This preview image is unavailable.');
   controller.signal.throwIfAborted(); setMetadata(result);
   await new Promise<void>((resolve, reject) => { preload = new Image(); preload.referrerPolicy = 'no-referrer'; preload.onload = () => resolve(); preload.onerror = () => reject(new Error('Could not load the preview image.')); preload.src = imageUrl.href; });
   controller.signal.throwIfAborted(); setImage(imageUrl.href); setBusy(false);
  })().catch(failure => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Preview unavailable.'); setBusy(false); } });
  return () => { controller.abort(); if (preload) { preload.onload = null; preload.onerror = null; preload.src = ''; } };
 // Primitive URL identity fences every request and image decode.
 }, [url, retry, destination.origin]);
 const selectedTemplate = design.template || metadata?.design?.template || 'editorial';
 const selectedLayout = design.layout || 'auto';
 const invite = (destination.pathname === '/invite' || destination.pathname.startsWith('/invite/'));
 const choiceRows = (rows: readonly { id: string; label: string; description: string }[], selected: string) => rows.map(item => ({ ...item, swatch: themeSwatches[item.id] || '', selected: item.id === selected, border: item.id === selected ? 'var(--tt-accent, #ba256b)' : 'var(--tt-border, #e8e6ec)', background: item.id === selected ? 'var(--tt-accent-tint, #fff5fa)' : 'var(--tt-card, #fff)' }));
 const copy = async () => { try { await navigator.clipboard.writeText(url); if (active.current) lopu({ title: 'Customised link copied', status: 'success', duration: 2000 }); } catch { if (active.current) lopu({ title: 'Select and copy Your customised link below', status: 'info' }); } };
 const nativeShare = async () => { try { await navigator.share({ url }); } catch (failure) { if (active.current && !(failure instanceof Error && failure.name === 'AbortError')) lopu({ title: 'Could not share link', description: 'Use Copy customised link instead.', status: 'error' }); } };
 const scope = { share: { title: metadata?.title || 'Your link preview', description: metadata?.description || '', image, alt: metadata?.image?.alt || 'Preview of this link', imageDisplay: image ? 'block' : 'none', busy, spinnerDisplay: busy ? 'inline-block' : 'none', status: error || (busy ? 'Updating preview…' : 'Preview ready'), retryDisplay: error ? 'inline-block' : 'none', privacy: metadata?.publicContent === false ? 'Only content available to link previews appears here. Access permissions stay the same.' : 'Content comes from this exact link. Theme and layout change its presentation.', url, nativeDisplay: typeof navigator.share === 'function' ? 'inline-block' : 'none', templates: choiceRows(SOCIAL_PREVIEW_TEMPLATES.filter(item => invite || ['editorial', 'colour-blocks'].includes(item.id)), selectedTemplate), layouts: choiceRows(SOCIAL_PREVIEW_LAYOUTS, selectedLayout) } };
 return <BuilderOverlayHost.Provider value={overlay}><Modal isOpen onClose={onClose} size="5xl" scrollBehavior="inside" isCentered>
  <ModalOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
  <ModalContent ref={overlay} data-testid="share-preview-dialog" aria-label="Share link and customise preview" containerProps={{ zIndex: DRAWER_MODAL_Z }} width="min(960px, calc(100vw - 24px))" maxW="calc(100vw - 24px)" maxH="calc(100dvh - 24px)" margin="12px" borderRadius="20px" background="var(--tt-card, #fff)">
   <ModalCloseButton aria-label="Close share preview" />
   <ModalBody minW={0} padding={{ base: '28px 18px', md: '34px' }} sx={{ '#share-preview-document button:focus-visible, #share-preview-document input:focus-visible': { outline: '2px solid var(--tt-accent, #ba256b)', outlineOffset: '3px' }, '#share-preview-document button': { borderColor: 'var(--tt-border, #e8e6ec)' }, '#share-preview-document button[aria-pressed="true"]': { borderColor: 'var(--tt-accent, #ba256b)', boxShadow: '0 0 0 1px var(--tt-accent, #ba256b)', background: 'var(--tt-accent-tint, #fff5fa)' }, '#share-preview-document button:hover': { filter: 'brightness(.97)' }, '.share-preview-workspace': { gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'minmax(0, 1.4fr) minmax(240px, 1fr)' } }, '.share-preview-spinner': { animation: 'share-preview-spin 1s linear infinite' }, '@keyframes share-preview-spin': { to: { transform: 'rotate(360deg)' } }, '@media (prefers-reduced-motion: reduce)': { '.share-preview-spinner': { animation: 'none' } } }}>
    <SettingsDocumentHost documentKey="share-preview-customiser" defaultDocument={sharePreviewBlocks} scopeKey={scopeKey} title="Share preview layout">
     {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={scope} actions={{ templates: ({ inputs }) => { if (SOCIAL_PREVIEW_TEMPLATES.some(item => item.id === inputs.id)) setDesign(previous => ({ ...previous, template: inputs.id as SocialPreviewDesign['template'] })); }, layouts: ({ inputs }) => { if (SOCIAL_PREVIEW_LAYOUTS.some(item => item.id === inputs.id)) setDesign(previous => ({ ...previous, layout: inputs.id as SocialPreviewDesign['layout'] })); }, copy, native: nativeShare, retry: () => setRetry(value => value + 1) }}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
    </SettingsDocumentHost>
   </ModalBody>
  </ModalContent>
 </Modal></BuilderOverlayHost.Provider>;
}
