import React from 'react';
import { Button, Flex, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from '@chakra-ui/react';
import type { useCommentDraft } from '../hooks/useCommentDraft';
import { DraftSaveStatus } from './DraftPicker';
import type { PlainCommentReview, PlainCommentLegacySource } from './plainCommentDraft';
import { TRANSFER_DIALOG_Z } from '../components/Things/transferLayers';

type Draft = ReturnType<typeof useCommentDraft>;
export function PlainCommentDraftTools({ draft }: { draft: Draft }) {
 return <Tools key={draft.identity} draft={draft} />;
}
function Tools({ draft }: { draft: Draft }) {
 const [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
 const [review, setReview] = React.useState<PlainCommentReview | null>(null);
 const [accountPage, setAccountPage] = React.useState<{ sources: PlainCommentLegacySource[]; nextCursor: string | null } | null>(null);
 const live = React.useRef(true), running = React.useRef(false);
 React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
 const run = async (action: () => Promise<void>) => {
  if (running.current) return; running.current = true; setBusy(true); setError('');
  try { await action(); }
  catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Earlier draft recovery failed.'); }
  finally { running.current = false; if (live.current) setBusy(false); }
 };
 const close = () => { if (!running.current) { setOpen(false); setReview(null); setError(''); } };
 const findAccount = (cursor: string | null = null) => void run(async () => {
  const result = await draft.listLegacyAccount(cursor); if (live.current) { setAccountPage(result); setReview(null); }
 });
 return <>
  {(draft.value || draft.error) && <DraftSaveStatus status={draft.status} error={draft.error} paused={!!draft.recoveryError} retry={draft.retry} />}
  {draft.legacyError && <Text fontSize="xs" role="alert">{draft.legacyError}</Text>}
  {(!!draft.legacySources.length || draft.accountRecovery) && <Button size="xs" variant="ghost" alignSelf="flex-start" onClick={() => setOpen(true)}>Recover earlier comment draft</Button>}
  <Modal isOpen={open} onClose={close} size="lg" scrollBehavior="inside">
   <ModalOverlay zIndex={TRANSFER_DIALOG_Z - 1} />
   <ModalContent containerProps={{ zIndex: TRANSFER_DIALOG_Z }} width="calc(100% - 24px)" marginX={0} marginY={6} maxHeight={{ base: 'calc(100dvh - 120px)', md: 'calc(100dvh - 48px)' }}>
    <ModalHeader>Earlier comment draft</ModalHeader><ModalCloseButton isDisabled={busy} />
    <ModalBody>
     <Text fontSize="sm" mb={3}>Choose an earlier draft to review. It is kept unchanged. Copying adds only its plain text to this workspace’s comment; it does not send the comment.</Text>
     <Flex gap={2} flexWrap="wrap">{draft.legacySources.map(source => <Button key={source.key} size="xs" isDisabled={busy} onClick={() => void run(async () => {
      setReview(null); const value = await draft.reviewLegacy(source); if (live.current) setReview(value);
     })}>{source.label}</Button>)}</Flex>
     {draft.accountRecovery && <>
      <Text fontSize="xs" mt={3} mb={2}>Earlier account drafts have no database label. Review them online before copying text into this workspace. Files and rich content stay in their original editor.</Text>
      <Button size="xs" isDisabled={busy} onClick={() => findAccount()}>Find earlier account drafts</Button>
      {accountPage && <Flex direction="column" gap={2} mt={2}>
       {!accountPage.sources.length && <Text fontSize="sm">No earlier account drafts for this comment.</Text>}
       {accountPage.sources.map(source => <Button key={source.key} size="sm" variant="outline" whiteSpace="normal" height="auto" py={2} textAlign="left" overflowWrap="anywhere" maxW="100%" isDisabled={busy} onClick={() => void run(async () => {
        setReview(null); const value = await draft.reviewLegacy(source); if (live.current) setReview(value);
       })}>{source.label}</Button>)}
       {accountPage.nextCursor && <Button size="xs" isDisabled={busy} onClick={() => findAccount(accountPage.nextCursor)}>Next account drafts</Button>}
      </Flex>}
     </>}
     {review && <>
      <Text mt={3} fontSize="xs">{review.source.label}{review.text.length > 4000 ? ' — showing the first 4,000 characters; the complete text is copied.' : ''}</Text>
      <Text as="pre" mt={2} whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="sm" maxHeight="240px" overflowY="auto">{review.text.slice(0,4000)}</Text>
      {!!draft.value && <Text mt={3} fontSize="sm">Your current text is kept. The recovered text will be appended after it.</Text>}
     </>}
     {error && <Text role="alert" mt={3} color="red.500" fontSize="sm">{error}</Text>}
    </ModalBody>
    <ModalFooter gap={2} flexWrap="wrap">
     <Button variant="ghost" isDisabled={busy} onClick={close}>Cancel</Button>
     <Button isLoading={busy} isDisabled={!review || !draft.context} onClick={() => void run(async () => {
      if (!review) return; await draft.copyLegacy(review); if (live.current) { setOpen(false); setReview(null); }
     })}>{draft.value ? 'Append to comment' : 'Copy into comment'}</Button>
    </ModalFooter>
   </ModalContent>
  </Modal>
 </>;
}
