import OpenAI, { toFile } from 'openai';
import { getAttachmentDownload } from '../attachments/attachments';
import { getAiPreferredModelWaterfall } from '../settings/prConflictResolverModelWaterfall';
import { resolveAiPreferredOpenAiChoice, toOpenAiReasoningEffort } from '../settings/prConflictResolverModelWaterfallCore';
import { parseRecordingInsights, RECORDING_INSIGHTS_PROMPT, RECORDING_MAX_AUDIO_BYTES, RECORDING_MAX_TRANSCRIPT_CHARS } from './recordingsCore';

const AUDIO_TYPES = new Set(['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'video/mp4']);

export const recordingProviderStatus = () => ({
	configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
	name: 'Thingtime OpenAI provider',
	maxAudioBytes: RECORDING_MAX_AUDIO_BYTES
});

const client = () => {
	if (!recordingProviderStatus().configured) throw new Error('Recording transcription is not configured on this Thingtime.');
	// The same operator-owned key/base as Lopu chat. Never use browser-supplied
	// hosts or credentials, follow redirects, log audio, or include provider errors.
	return new OpenAI({ timeout: 60_000, maxRetries: 0, fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }) });
};

export const readRecordingBytes = async (ownerId: string, attachmentId: string): Promise<{ bytes: Uint8Array; type: string }> => {
	const download = await getAttachmentDownload({ id: ownerId }, attachmentId, false);
	if (!download.ok) throw new Error('This recording is no longer available.');
	if (!AUDIO_TYPES.has(download.contentType) || download.size < 1 || download.size > RECORDING_MAX_AUDIO_BYTES) {
		throw new Error('Use an audio recording smaller than 24 MiB (M4A, MP3, MP4, WAV or WebM).');
	}
	const response = await fetch(download.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
	if (!response.ok || !response.body) throw new Error('The recording could not be downloaded.');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > download.size || total > RECORDING_MAX_AUDIO_BYTES) throw new Error('The recording exceeded its expected size.');
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	if (total !== download.size) throw new Error('The recording download was incomplete.');
	return { bytes: Buffer.concat(chunks), type: download.contentType };
};

export const transcribeRecording = async (ownerId: string, attachmentId: string, beforeSend?: () => Promise<void>): Promise<string> => {
	const { bytes, type } = await readRecordingBytes(ownerId, attachmentId);
	await beforeSend?.();
	return transcribeRecordingAudio(bytes, type);
};

// Separated from authorized attachment lookup so provider acceptance can use
// a synthetic audio fixture without creating data or bypassing attachment ACLs.
export const transcribeRecordingAudio = async (bytes: Uint8Array, type: string): Promise<string> => {
	if (!AUDIO_TYPES.has(type) || !bytes.byteLength || bytes.byteLength > RECORDING_MAX_AUDIO_BYTES) throw new Error('Unsupported recording.');
	const api = client();
	const extension = type.includes('wav') ? 'wav' : type.includes('webm') ? 'webm' : type.includes('mpeg') ? 'mp3' : 'm4a';
	try {
		const result = await api.audio.transcriptions.create({
			model: 'gpt-4o-mini-transcribe',
			file: await toFile(bytes, `recording.${extension}`, { type }),
			response_format: 'json'
		});
		const text = result.text?.trim();
		if (!text || text.length > RECORDING_MAX_TRANSCRIPT_CHARS) throw new Error('empty');
		return text;
	} catch {
		throw new Error('Transcription did not finish. Check the recording provider and retry.');
	}
};

export const analyzeRecording = async (transcript: string, beforeSend?: () => Promise<void>) => {
	const api = client();
	const choice = resolveAiPreferredOpenAiChoice(await getAiPreferredModelWaterfall());
	await beforeSend?.();
	try {
		const effort = toOpenAiReasoningEffort(choice?.effort ?? null);
		const result = await api.chat.completions.create({
			model: choice?.model || process.env.LOPU_OPENAI_MODEL?.trim() || 'gpt-4o-mini',
			...(effort ? { reasoning_effort: effort } : {}),
			...(choice?.speed === 'fast' ? { service_tier: 'priority' as const } : {}),
			max_completion_tokens: 6000,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: RECORDING_INSIGHTS_PROMPT },
				{ role: 'user', content: transcript }
			]
		});
		return parseRecordingInsights(result.choices[0]?.message.content || '', transcript);
	} catch {
		throw new Error('Lopu could not organize this transcript yet. Your saved transcript is safe; retry to continue.');
	}
};
