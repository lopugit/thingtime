import React from 'react';
import { useSharedAccess, useSharedMediaUrl } from '../Sharing/SharedMedia';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Download, ListMusic } from 'lucide-react';

import { attachmentContentUrl, attachmentDisplayName, attachmentMediaSrc, attachmentPlaybackContentType, attachmentTypeLabel, formatAttachmentBytes } from './attachmentUiCore';
import { audioAttachmentIdentity, captureOfflineAudioContext, readOfflineAudio, removeOfflineAudio, saveOfflineAudio, type OfflineAudioContext } from './audioPlaybackCache';
import { nextQueuedAudioIndex } from './audioPlaybackCore';
import type { PublicAttachment } from './attachmentTypes';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { subscribeWorkspaceIdentity, workspaceIdentityKey } from '~/local-workspace/runtime.client';
import { localMediaId } from '~/local-workspace/media';
import { RecordingTranscript } from './RecordingTranscript';

const BORDER = '1px solid var(--tt-border, #ececef)';
const MUTED = 'var(--tt-muted, #9a9aa6)';

let claimedAudio: HTMLAudioElement | null = null;

const claimAudio = (audio: HTMLAudioElement) => {
	if (claimedAudio && claimedAudio !== audio) claimedAudio.pause();
	claimedAudio = audio;
};

const releaseAudio = (audio: HTMLAudioElement) => {
	if (claimedAudio === audio) claimedAudio = null;
};

export const AudioAttachmentPlayer = (props: { attachments: PublicAttachment[]; compact?: boolean }) => {
 const user = useCurrentUser(), dataPlane = useDataPlane(), shared = useSharedAccess();
 const identity = React.useSyncExternalStore(subscribeWorkspaceIdentity, workspaceIdentityKey, () => '');
 const actorId = user?.temporary ? null : user?.id;
 const context = React.useMemo(() => identity ? captureOfflineAudioContext(actorId, dataPlane) : null, [identity, actorId, dataPlane]);
 // Replace the complete playback lifetime at an identity/context boundary.
 // Old native audio elements must not retain a source until a passive effect.
 const key = JSON.stringify([identity, actorId, dataPlane, shared.key || '', shared.sharedRoot || '']);
 return <AudioAttachmentPlayerSession key={key} {...props} context={context} />;
};

const AudioAttachmentPlayerSession = ({ attachments, compact = false, context }: { attachments: PublicAttachment[]; compact?: boolean; context: OfflineAudioContext | null }) => {
 const mediaUrl = useSharedMediaUrl();
 const shared = useSharedAccess();
	const audioRef = React.useRef<HTMLAudioElement | null>(null);
	const [activeIndex, setActiveIndex] = React.useState(0);
	const [playAfterChange, setPlayAfterChange] = React.useState(false);
	const [offlineCopy, setOfflineCopy] = React.useState<{ key: string; bytes: Blob } | null>(null);
	const [offlineUrl, setOfflineUrl] = React.useState<{ key: string; url: string } | null>(null);
	const [offlineAvailable, setOfflineAvailable] = React.useState(false);
	const [usingOffline, setUsingOffline] = React.useState(false);
	const [savingOffline, setSavingOffline] = React.useState(false);
	const [playbackError, setPlaybackError] = React.useState<string | null>(null);

 const active = attachments[Math.min(Math.max(activeIndex, 0), Math.max(attachments.length - 1, 0))];
 const descriptorKey = active ? audioAttachmentIdentity(active) : '';
 const descriptor = React.useRef({ key: descriptorKey, attachment: active });
 if (descriptor.current.key !== descriptorKey) descriptor.current = { key: descriptorKey, attachment: active };
 const cacheAttachment = descriptor.current.attachment;
	const deviceAudio = !!active && !!localMediaId(attachmentMediaSrc(active));
	const cacheAllowed = !!context && !deviceAudio && !shared.key && !shared.sharedRoot;
 const selectionKey = JSON.stringify([context?.key, descriptorKey, cacheAllowed]);
 const selection = React.useMemo(() => ({ key: selectionKey, controller: new AbortController() }), [selectionKey]);
 const currentSelection = React.useRef(selection); currentSelection.current = selection;
 const selectionCurrent = React.useCallback((signal = selection.controller.signal) => currentSelection.current === selection && signal === selection.controller.signal && !signal.aborted, [selection]);
 const copyAvailable = offlineAvailable && offlineCopy?.key === selectionKey;
 const savedUrl = offlineUrl?.key === selectionKey && copyAvailable && usingOffline ? offlineUrl.url : null;

 React.useLayoutEffect(() => {
  if (selection.controller.signal.aborted) selection.controller = new AbortController();
  const controller = selection.controller;
  setSavingOffline(false);
  return () => controller.abort();
 }, [selection]);


	React.useEffect(() => {
		if (!cacheAttachment?.id || cacheAttachment.url || !cacheAllowed) {
			setOfflineCopy(null);
			setOfflineAvailable(false);
			setUsingOffline(false);
			return;
		}
		let cancelled = false;
  const signal = selection.controller.signal;
		setOfflineCopy(null);
		setOfflineAvailable(false);
		setUsingOffline(false);
		void readOfflineAudio(cacheAttachment, context!).then((copy) => {
   if (cancelled || !selectionCurrent(signal) || !copy) return;
   setOfflineCopy({ key: selectionKey, bytes: copy });
   setOfflineAvailable(true);
  }).catch(() => { /* An unavailable cache must not replace the streaming path. */ });
		return () => {
			cancelled = true;
		};
	}, [cacheAttachment, cacheAllowed, context, selection, selectionCurrent, selectionKey]);

	React.useLayoutEffect(() => {
		if (!usingOffline || !offlineCopy || offlineCopy.key !== selectionKey) {
			setOfflineUrl(null);
			return;
		}
		const url = URL.createObjectURL(offlineCopy.bytes);
		setOfflineUrl({ key: selectionKey, url });
		return () => URL.revokeObjectURL(url);
	}, [offlineCopy, usingOffline, selectionKey]);

	// A pending root/plane has no native playback source. The stale metadata
 // may remain rendered while revalidation runs, but cannot reopen remote or
 // device bytes under an unresolved identity. Shared/public playback still
 // goes through its ordinary resolver once the workspace is bound.
 const source = active && context ? (cacheAllowed ? savedUrl : null) || mediaUrl(attachmentMediaSrc(active)) : '';
 React.useLayoutEffect(() => {
  const audio = audioRef.current;
  return () => {
   if (audio) { audio.pause(); audio.removeAttribute('src'); audio.querySelectorAll('source').forEach(source => source.removeAttribute('src')); audio.load(); releaseAudio(audio); }
  };
 }, [source]);

	React.useEffect(() => { setPlaybackError(null); }, [source]);
	const sourceType = active ? attachmentPlaybackContentType(active) : '';

	React.useEffect(() => {
		if (!playAfterChange || !source || !selectionCurrent()) return;
		const signal = selection.controller.signal;
		const frame = window.requestAnimationFrame(() => {
			const audio = audioRef.current;
			if (!audio || !selectionCurrent(signal)) return;
			void audio.play().catch(() => { if (selectionCurrent(signal)) setPlaybackError('Playback needs a tap or click to start.'); });
			setPlayAfterChange(false);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [playAfterChange, source, selection, selectionCurrent]);

	const selectTrack = React.useCallback((index: number, play = false) => {
		if (index === activeIndex) { setPlayAfterChange(play); return; }
		selection.controller.abort();
		setPlaybackError(null);
		// Do not briefly point the next queued track at the prior track’s object
		// URL while IndexedDB availability is being checked.
		setUsingOffline(false);
		setOfflineCopy(null);
		setOfflineUrl(null);
		setActiveIndex(index);
		setPlayAfterChange(play);
	}, [selection, activeIndex]);

	const saveActiveOffline = React.useCallback(async () => {
		if (!active || active.url || savingOffline || !cacheAllowed || !context || !selectionCurrent()) return;
		const signal = selection.controller.signal;
		setSavingOffline(true);
		setPlaybackError(null);
		try {
			const copy = await saveOfflineAudio(active, context, mediaUrl, { signal });
			if (!selectionCurrent(signal)) return;
			setOfflineCopy({ key: selectionKey, bytes: copy });
			setOfflineAvailable(true);
			setUsingOffline(true);
			setPlayAfterChange(true);
		} catch (error) {
			if (selectionCurrent(signal)) setPlaybackError(error instanceof Error ? error.message : 'Thingtime could not save this audio for offline playback.');
		} finally {
			if (selectionCurrent(signal)) setSavingOffline(false);
		}
	}, [active, savingOffline, context, mediaUrl, cacheAllowed, selection, selectionKey, selectionCurrent]);

	const clearActiveOffline = React.useCallback(async () => {
		if (!active || active.url || !cacheAllowed || !context || !selectionCurrent()) return;
		const signal = selection.controller.signal;
		try {
			await removeOfflineAudio(active, context);
			if (!selectionCurrent(signal)) return;
			setUsingOffline(false);
			setOfflineCopy(null);
			setOfflineAvailable(false);
		} catch {
			if (selectionCurrent(signal)) setPlaybackError('Thingtime could not remove the saved offline copy.');
		}
	}, [active, context, cacheAllowed, selection, selectionCurrent]);

	if (!active) return null;

	return (
		<Box border={BORDER} borderRadius="var(--tt-radius-md, 12px)" background="var(--tt-surface, #fafafb)" padding={compact ? 2.5 : 3} minWidth={0}>
			<Flex alignItems="flex-start" columnGap={2.5} minWidth={0}>
				<Flex boxSize="32px" borderRadius="8px" background="var(--tt-card, #ffffff)" alignItems="center" justifyContent="center" color="var(--tt-link, #2f8fd6)" flexShrink={0}>
					<ListMusic size={16} aria-hidden />
				</Flex>
				<Box minWidth={0} flex="1">
					<Text fontSize={compact ? 'xs' : 'sm'} fontWeight={650} noOfLines={1} color="var(--tt-ink, #16161a)" title={active.title || attachmentDisplayName(active)}>
						{active.title || attachmentDisplayName(active)}
					</Text>
					<Text fontSize="10px" color={MUTED} noOfLines={1}>
						{active.url ? 'Linked stream' : formatAttachmentBytes(active.size)} · {attachmentTypeLabel(active)} · {attachments.length === 1 ? '1 track' : `Track ${activeIndex + 1} of ${attachments.length}`}
					</Text>
				</Box>
			</Flex>

			<Box mt={2.5}>
				<audio
					key={source}
					ref={audioRef}
					controls
					preload="metadata"
					aria-label={`Play ${attachmentDisplayName(active)}`}
					style={{ display: 'block', width: '100%' }}
					onPlay={(event) => claimAudio(event.currentTarget)}
					onEnded={() => {
						const next = nextQueuedAudioIndex(activeIndex, attachments.length);
						if (next !== null) selectTrack(next, true);
					}}
					onError={() => {
						if (!source) return;
						if (cacheAllowed && savedUrl) {
							setUsingOffline(false);
							setPlaybackError('The saved copy could not be decoded. Streaming will be used instead.');
							return;
						}
						setPlaybackError('This browser could not decode this audio codec. You can still download the original file.');
					}}
				>
					{source ? <source src={source} type={sourceType} /> : null}
				</audio>
			</Box>

			{deviceAudio && !shared.key && !shared.sharedRoot ? <Text mt={2} fontSize="10px" color={MUTED}>Saved on this device</Text> : null}
			{!active.url && cacheAllowed ? (
				<Flex mt={2} columnGap={2} rowGap={1} flexWrap="wrap" alignItems="center">
					{copyAvailable ? (
						<>
							<Button size="xs" variant="outline" onClick={() => setUsingOffline((current) => !current)}>
								{usingOffline && copyAvailable ? 'Use streaming' : 'Use offline copy'}
							</Button>
							<Button size="xs" variant="ghost" onClick={() => void clearActiveOffline()}>
								Remove offline copy
							</Button>
						</>
					) : (
						<Button size="xs" variant="outline" leftIcon={<Download size={13} />} isLoading={savingOffline} onClick={() => void saveActiveOffline()}>
							Save full file offline
						</Button>
					)}
					<Text fontSize="10px" color={MUTED}>
						{usingOffline && copyAvailable ? 'Playing your saved local copy' : 'Streaming from Thingtime'}
					</Text>
				</Flex>
			) : null}

			<Button
				as="a"
				href={mediaUrl(active.url || attachmentContentUrl(active.id, true)) || undefined}
				{...(active.url ? { target: '_blank', rel: 'noopener noreferrer' } : { download: active.name })}
				mt={2}
				size="xs"
				variant="ghost"
				leftIcon={<Download size={13} />}
			>
				Download original
			</Button>
			{!active.url && <RecordingTranscript attachmentId={active.id} compact={compact} />}

			{attachments.length > 1 ? (
				<Flex mt={3} flexDirection="column" rowGap={1} aria-label="Audio queue">
					<Text fontFamily="mono" fontSize="10px" fontWeight={700} letterSpacing="0.08em" textTransform="uppercase" color={MUTED}>
						Queue · plays next automatically
					</Text>
					{attachments.map((attachment, index) => (
						<Button
							key={attachment.id}
							size="sm"
							variant={index === activeIndex ? 'solid' : 'ghost'}
							justifyContent="flex-start"
							fontWeight={index === activeIndex ? 650 : 500}
							onClick={() => selectTrack(index, true)}
							aria-current={index === activeIndex ? 'true' : undefined}
						>
							{index + 1}. {attachment.title || attachmentDisplayName(attachment)}
						</Button>
					))}
				</Flex>
			) : null}

			{playbackError ? (
				<Text mt={2} role="alert" color="var(--tt-danger, #e5484d)" fontSize="xs">
					{playbackError}
				</Text>
			) : null}
		</Box>
	);
};
