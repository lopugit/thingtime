import React from 'react';
import { Box } from '@chakra-ui/react';
import { useLocation } from 'react-router';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useApi } from '~/hooks/useApi';
import { matchesCommittedPostCreate } from '~/components/Attachments/attachmentUiCore';
import { useDataPlane } from '~/hooks/useDataPlane';
import { PostComposer, type PendingPostSubmission } from '~/components/Feed/PostComposer';
import { ShareMessageDestination } from '~/components/Messenger/ShareMessageDestination';
import { ShareSaveDestination } from '~/components/Things/ShareSaveDestination';
import { SettingsDocumentHost } from '~/components/Settings/SettingsDocumentHost';
import { TransientBlockHost } from '~/components/Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { ContextActionToolbar } from '~/components/IncomingShare/ContextActionToolbar';
import { contextLayoutHeight } from '~/components/IncomingShare/contextViewport';
import { incomingShareBlocks } from '~/components/IncomingShare/incomingShareBlocks';
import { incomingShareRequestId, readIncomingShare, type IncomingShareDraft, type IncomingShareSubmission } from '~/components/IncomingShare/incomingShare';
export default function IncomingShareRoute() {
 const user = useCurrentUser(), location = useLocation(), plane = useDataPlane();
 const requestId = incomingShareRequestId(location.search), origin = window.location.origin;
 const identity = `${origin}:${user?.id || 'guest'}:${plane}:${requestId || ''}`;
 return <IncomingShareSession key={identity} identity={identity} requestId={requestId} accountId={user && !user.temporary ? user.id : null} origin={origin} />;
}
function IncomingShareSession({ identity, requestId, accountId, origin }: { identity: string; requestId: string | null; accountId: string | null; origin: string }) {
 const [draft, setDraft] = React.useState<IncomingShareDraft | null>(null), [mode, setMode] = React.useState('post');
 const api = useApi();
 const apiRef = React.useRef(api); apiRef.current = api;
 const [submission, setSubmission] = React.useState<IncomingShareSubmission | null>(null);
 const submissionRef = React.useRef<IncomingShareSubmission | null>(null);
 const [recoveredPost, setRecoveredPost] = React.useState<PendingPostSubmission | undefined>();
 const [visited, setVisited] = React.useState(() => new Set(['post']));
 const [toolbarHeight, setToolbarHeight] = React.useState(120), [toolbarVisibleHeight, setToolbarVisibleHeight] = React.useState(120);
 const measureToolbar = React.useCallback((reserved: number, visible: number) => { setToolbarHeight(reserved); setToolbarVisibleHeight(visible); }, []);
 const heading = React.useRef<HTMLDivElement>(null), messageHost = React.useRef<HTMLDivElement>(null);
 const surface = React.useRef<HTMLDivElement>(null);
 const [headingHeight, setHeadingHeight] = React.useState(200), [layoutHeight, setLayoutHeight] = React.useState(contextLayoutHeight);
 React.useLayoutEffect(() => {
  const element = heading.current; if (!element) return;
  const observer = new ResizeObserver(() => setHeadingHeight(Math.ceil(element.getBoundingClientRect().height)));
  observer.observe(element); const resize = () => setLayoutHeight(contextLayoutHeight()); window.addEventListener('resize', resize);
  return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
 }, []);
 React.useEffect(() => {
  let frame = 0;
  const check = (remaining: number) => {
    const field = document.activeElement, viewport = window.visualViewport;
    if (!viewport || !(field instanceof HTMLElement) || !field.matches('input, textarea, [contenteditable="true"]') || !surface.current?.contains(field)) return;
    const toolbar = document.querySelector('[data-testid="context-action-toolbar"]')?.getBoundingClientRect();
    const visibleBottom = toolbar?.bottom ?? viewport.height + viewport.offsetTop, visibleTop = visibleBottom - viewport.height;
    const docks = [...surface.current.querySelectorAll('[data-context-dock]')].filter(node => !node.contains(field)).map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height);
    const bottom = Math.min(visibleBottom, toolbar?.top ?? Infinity, ...docks.map(rect => rect.top)) - 12;
    const full = field.getBoundingClientRect(), selection = getSelection(), caret = field.isContentEditable && selection?.rangeCount && field.contains(selection.anchorNode) ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const rect = full.height <= bottom - visibleTop ? full : caret?.height ? caret : full;
    const scroller = document.scrollingElement;
    let adjusted = false;
    if (scroller && rect.bottom > bottom) { scroller.scrollTop += rect.bottom - bottom; adjusted = true; }
    else if (scroller && rect.top < visibleTop) { scroller.scrollTop += rect.top - visibleTop - 12; adjusted = true; }
    if (adjusted && remaining > 0) frame = requestAnimationFrame(() => check(remaining - 1));
  };
  const reveal = () => {
   cancelAnimationFrame(frame); frame = requestAnimationFrame(() => check(2));
  };
  const observer = new ResizeObserver(reveal); if (surface.current) observer.observe(surface.current); observer.observe(document.body);
  window.addEventListener('focusin', reveal); window.visualViewport?.addEventListener('scroll', reveal); window.visualViewport?.addEventListener('resize', reveal); reveal();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('focusin', reveal); window.visualViewport?.removeEventListener('scroll', reveal); window.visualViewport?.removeEventListener('resize', reveal); };
 }, [mode, toolbarHeight]);
 const [status, setStatus] = React.useState(''), [complete, setComplete] = React.useState(false);
 const lifetime = React.useRef(new AbortController()), committing = React.useRef(false);
 React.useEffect(() => {
  const controller = new AbortController(); lifetime.current = controller;
  if (accountId && requestId && window.thingtimeShare) {
   void readIncomingShare(window.thingtimeShare, requestId, accountId, origin, controller.signal).then(async incoming => {
    setDraft(incoming);
    if (incoming.submission) {
     const stored = incoming.submission; submissionRef.current = stored; setSubmission(stored);
     setMode(stored.destination); setVisited(new Set([stored.destination]));
     if (stored.outcomeIds?.length) {
      setComplete(true); setStatus('Shared successfully. Finishing the local receipt…');
      await window.thingtimeShare!.request({ method: 'complete', requestId: incoming.id, accountId: incoming.accountId });
      return;
     }
     if (stored.destination === 'post' && stored.recoveryPayload) {
      const pending = JSON.parse(stored.recoveryPayload) as PendingPostSubmission;
      if (pending.shareId !== incoming.id || pending.expectation?.ownerId !== incoming.accountId || !pending.payload || !Array.isArray(pending.attachmentIds)) throw new Error('The saved post submission does not match this account.');
      setRecoveredPost({ ...pending, unknownOutcome: true });
      try {
       const saved = await apiRef.current.v1.things.get({ id: pending.shareId }, { signal: controller.signal });
       if (pending.expectation && matchesCommittedPostCreate(saved, pending.expectation)) await finish(incoming, [saved.post.id]);
      } catch (error) { if (controller.signal.aborted) throw error; /* The normal composer retains the original immutable retry. */ }
     }
    }
   }).catch(error => { if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : 'The shared content is unavailable.'); });
  }
  return () => controller.abort();
 }, [accountId, requestId, origin]);
 const begin = async (destination: IncomingShareSubmission['destination'], operationId: string, targetId?: string, recoveryPayload?: string) => {
  if (!draft || !window.thingtimeShare) throw new Error('The original shared content is unavailable.');
  const intended = { destination, operationId, ...(targetId ? { targetId } : {}), ...(recoveryPayload !== undefined ? { recoveryPayload } : {}) };
  // Claim synchronously in this document; the native journal serializes other
  // WK stores and refuses destination/operation/target or payload changes.
  const current = submissionRef.current;
  if (current && (current.destination !== destination || current.operationId !== operationId || (current.targetId || '') !== (targetId || ''))) throw new Error('Finish the existing share submission before choosing another destination.');
  submissionRef.current = current || intended; setSubmission(submissionRef.current);
  await window.thingtimeShare.request({ method: 'beginSubmission', requestId: draft.id, accountId: draft.accountId, ...intended });
 };
 const finish = async (incoming: IncomingShareDraft, ids: string[]) => {
  if (committing.current || !window.thingtimeShare) return;
  committing.current = true;
  setComplete(true); setStatus('Shared successfully. Your original files remain available locally.');
  try {
   const claim = submissionRef.current;
   if (!claim) throw new Error('The share receipt is unavailable.');
   await window.thingtimeShare.request({ method: 'recordOutcome', requestId: incoming.id, accountId: incoming.accountId, destination: claim.destination, operationId: claim.operationId, ...(claim.targetId ? { targetId: claim.targetId } : {}), outcomeIds: ids });
   await window.thingtimeShare.request({ method: 'complete', requestId: incoming.id, accountId: incoming.accountId });
  } catch { if (!lifetime.current.signal.aborted) setStatus('Shared successfully. The local receipt is pending; reopening this share keeps the original submission for recovery.'); }
 };
 const choose = (value: string) => { if (submissionRef.current && submissionRef.current.destination !== value) { setStatus('Finish the existing submission before choosing another destination.'); return; } setVisited(previous => new Set([...previous, value])); setMode(value); };
 const actions = React.useMemo(() => [{ id: 'post', label: 'Post', glyph: '↗', run: () => choose('post') }, { id: 'message', label: 'Message', glyph: '↔', run: () => choose('message') }, { id: 'save', label: 'Save as Thing / file', glyph: '⊞', run: () => choose('save') }], []);
 const compactViewport = !!window.visualViewport && (window.visualViewport.height < layoutHeight || window.visualViewport.height < 480);
 const title = complete ? 'Shared' : mode === 'message' ? 'New message' : mode === 'save' ? 'Save to Things' : 'New post';
 const summary = draft ? `${draft.files.length ? `${draft.files.length} shared ${draft.files.length === 1 ? 'file' : 'files'} · ` : ''}${draft.directories.length ? `${draft.directories.length} shared ${draft.directories.length === 1 ? 'folder' : 'folders'} · ` : ''}Your content is ready. Choose where it goes below.` : 'Your shared text, links and files stay together.';
 const message = status || (!accountId ? 'Sign in to choose an account for this share.' : !requestId || !window.thingtimeShare ? 'Open Thingtime from the system Share menu to receive content.' : !draft ? 'Opening shared content…' : '');
 return <Box ref={surface} as="main" data-testid="incoming-share" maxW="900px" mx="auto" width="100%" minH="100dvh" px={{ base: '16px', md: '28px' }} pt="24px" pb={`${toolbarHeight + 48}px`} minW={0} sx={{ 'input, textarea, button, [contenteditable="true"]': { scrollMarginBottom: 'calc(var(--tt-context-toolbar-height, 120px) + 24px)' } }} style={{ '--tt-context-toolbar-height': `${toolbarHeight}px`, '--tt-context-card-gap': compactViewport ? '8px' : '12px', '--tt-context-card-padding': compactViewport ? '8px' : '16px', '--tt-context-secondary-display': compactViewport ? 'none' : 'block' } as React.CSSProperties}>
  <Box ref={heading}><SettingsDocumentHost showLayoutControls={!!accountId} documentKey="incoming-share-intro" defaultDocument={incomingShareBlocks} scopeKey={identity} title="Incoming share heading" clearMobileLaunchers>
   {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={identity} scope={{ share: { title, summary, status: message, signedOut: !accountId, loginDisplay: accountId ? 'none' : 'inline-flex', loginHref: `/login?redirectTo=${encodeURIComponent(window.location.pathname + window.location.search)}` } }} enabled={!editing} actions={{}}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
  </SettingsDocumentHost></Box>
  {draft && !complete && <>
   {visited.has('post') && <Box hidden={mode !== 'post'}><PostComposer initialSubmission={recoveredPost} beforeSubmit={pending => begin('post', pending.shareId, undefined, JSON.stringify({ ...pending, unknownOutcome: true }))} incomingShareActive={mode === 'post'} incomingShareToolbarHeight={toolbarVisibleHeight} initialDraft={{ id: draft.id, text: draft.text, files: draft.files }} onPosted={post => void finish(draft, [post.id])} /></Box>}
   {visited.has('message') && <Box ref={messageHost} hidden={mode !== 'message'} height={`${Math.max(0, layoutHeight - headingHeight - toolbarHeight - (compactViewport ? 0 : 48))}px`} minH={0}><ShareMessageDestination shareId={draft.id} text={draft.text} files={draft.files} active={mode === 'message'} beforeSubmit={(targetId, operationId, payload) => begin('message', operationId, targetId, JSON.stringify(payload))} initialSubmission={submission?.destination === 'message' && submission.targetId && submission.recoveryPayload ? { targetId: submission.targetId, operationId: submission.operationId, recoveryPayload: submission.recoveryPayload } : undefined} onSent={message => finish(draft, [message.messageId])} /></Box>}
   {visited.has('save') && <Box hidden={mode !== 'save'}><ShareSaveDestination active={mode === 'save'} toolbarHeight={toolbarVisibleHeight} shareId={draft.id} text={draft.text} files={draft.files} directories={draft.directories} beforeSubmit={(targetId, operationId, payload) => begin('save', operationId, targetId, JSON.stringify(payload))} initialSubmission={submission?.destination === 'save' && submission.targetId && submission.recoveryPayload ? { targetId: submission.targetId, operationId: submission.operationId, recoveryPayload: submission.recoveryPayload } : undefined} onSaved={ids => void finish(draft, ids)} /></Box>}
  </>}
  {!complete && <ContextActionToolbar showLayoutControls={!!accountId} onHeightChange={measureToolbar} scopeKey={identity} actions={actions} selected={mode} />}
 </Box>;
}
