import React from 'react';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { Download, ListMusic } from 'lucide-react';

import { attachmentContentUrl, attachmentDisplayName, attachmentMediaSrc, attachmentPlaybackContentType, attachmentTypeLabel, formatAttachmentBytes } from './attachmentUiCore';
import { readOfflineAudio, removeOfflineAudio, saveOfflineAudio } from './audioPlaybackCache';
import { nextQueuedAudioIndex } from './audioPlaybackCore';
import type { PublicAttachment } from './attachmentTypes';
import { useCurrentUser } from '~/hooks/useCurrentUser';

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

export const AudioAttachmentPlayer = ({ attachments, compact = false }: { attachments: PublicAttachment[]; compact?: boolean }) => {
	const user = useCurrentUser();
	const audioRef = React.useRef<HTMLAudioElement | null>(null);
	const [activeIndex, setActiveIndex] = React.useState(0);
	const [playAfterChange, setPlayAfterChange] = React.useState(false);
	const [offlineCopy, setOfflineCopy] = React.useState<Blob | null>(null);
	const [offlineUrl, setOfflineUrl] = React.useState<string | null>(null);
	const [offlineAvailable, setOfflineAvailable] = React.useState(false);
	const [usingOffline, setUsingOffline] = React.useState(false);
	const [savingOffline, setSavingOffline] = React.useState(false);
	const [playbackError, setPlaybackError] = React.useState<string | null>(null);

	const active = attachments[Math.min(Math.max(activeIndex, 0), Math.max(attachments.length - 1, 0))];
	const activeId = active?.id || '';
	const activeLinkedUrl = active?.url || '';
	const viewerId = user?.id || null;

	React.useEffect(() => {
		const audio = audioRef.current;
		return () => {
			if (audio) releaseAudio(audio);
		};
	}, []);

	React.useEffect(() => {
		if (!activeId || activeLinkedUrl) {
			setOfflineCopy(null);
			setOfflineAvailable(false);
			setUsingOffline(false);
			return;
		}
		let cancelled = false;
		setOfflineCopy(null);
		setOfflineAvailable(false);
		setUsingOffline(false);
		void readOfflineAudio(activeId, viewerId).then((copy) => {
			if (cancelled || !copy) return;
			setOfflineCopy(copy);
			setOfflineAvailable(true);
		});
		return () => {
			cancelled = true;
		};
	}, [activeId, activeLinkedUrl, viewerId]);

	React.useEffect(() => {
		if (!usingOffline || !offlineCopy) {
			setOfflineUrl(null);
			return;
		}
		const url = URL.createObjectURL(offlineCopy);
		setOfflineUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [offlineCopy, usingOffline]);

	const source = active ? offlineUrl || attachmentMediaSrc(active) : '';
	const sourceType = active ? attachmentPlaybackContentType(active) : '';

	React.useEffect(() => {
		if (!playAfterChange || !source) return;
		const frame = window.requestAnimationFrame(() => {
			const audio = audioRef.current;
			if (!audio) return;
			void audio.play().catch(() => setPlaybackError('Playback needs a tap or click to start.'));
		});
		setPlayAfterChange(false);
		return () => window.cancelAnimationFrame(frame);
	}, [playAfterChange, source]);

	const selectTrack = React.useCallback((index: number, play = false) => {
		setPlaybackError(null);
		// Do not briefly point the next queued track at the prior track’s object
		// URL while IndexedDB availability is being checked.
		setUsingOffline(false);
		setOfflineCopy(null);
		setOfflineUrl(null);
		setActiveIndex(index);
		setPlayAfterChange(play);
	}, []);

	const saveActiveOffline = React.useCallback(async () => {
		if (!active || active.url || savingOffline) return;
		setSavingOffline(true);
		setPlaybackError(null);
		try {
			const copy = await saveOfflineAudio(active, viewerId);
			setOfflineCopy(copy);
			setOfflineAvailable(true);
			setUsingOffline(true);
			setPlayAfterChange(true);
		} catch (error) {
			setPlaybackError(error instanceof Error ? error.message : 'Thingtime could not save this audio for offline playback.');
		} finally {
			setSavingOffline(false);
		}
	}, [active, savingOffline, viewerId]);

	const clearActiveOffline = React.useCallback(async () => {
		if (!active || active.url) return;
		try {
			await removeOfflineAudio(active.id, viewerId);
			setUsingOffline(false);
			setOfflineCopy(null);
			setOfflineAvailable(false);
		} catch {
			setPlaybackError('Thingtime could not remove the saved offline copy.');
		}
	}, [active, viewerId]);

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
						if (offlineUrl) {
							setUsingOffline(false);
							setPlaybackError('The saved copy could not be decoded. Streaming will be used instead.');
							return;
						}
						setPlaybackError('This browser could not decode this audio codec. You can still download the original file.');
					}}
				>
					<source src={source} type={sourceType} />
				</audio>
			</Box>

			{!active.url ? (
				<Flex mt={2} columnGap={2} rowGap={1} flexWrap="wrap" alignItems="center">
					{offlineAvailable ? (
						<>
							<Button size="xs" variant="outline" onClick={() => setUsingOffline((current) => !current)}>
								{usingOffline ? 'Use streaming' : 'Use offline copy'}
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
						{usingOffline ? 'Playing your saved local copy' : 'Streaming from Thingtime'}
					</Text>
				</Flex>
			) : null}

			<Button
				as="a"
				href={active.url || attachmentContentUrl(active.id, true)}
				{...(active.url ? { target: '_blank', rel: 'noopener noreferrer' } : { download: active.name })}
				mt={2}
				size="xs"
				variant="ghost"
				leftIcon={<Download size={13} />}
			>
				Download original
			</Button>

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
