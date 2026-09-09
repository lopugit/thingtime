import OpenAI, { toFile } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getAttachmentDownload } from '../attachments/attachments';
import { getAiPreferredModelWaterfall } from '../settings/prConflictResolverModelWaterfall';
import {
	resolveAiPreferredAnthropicChoice,
	resolveAiPreferredOpenAiChoice,
	toOpenAiReasoningEffort
} from '../settings/prConflictResolverModelWaterfallCore';
import {
	parseRecordingInsights,
	RecordingFailure,
	recordingProviderFailure,
	RECORDING_INSIGHTS_PROMPT,
	RECORDING_MAX_AUDIO_BYTES,
	RECORDING_MAX_TRANSCRIPT_CHARS
} from './recordingsCore';
import { getRecordingSettings } from './recordingsStore';
import { resolveRecordingConnection } from './recordingsConnections';
import { recordingStageSetting, runRecordingWaterfall, type RecordingStage } from './recordingsWaterfall';
import type { LopuVaultProviderRecord } from './vaultProviderClient';

const AUDIO_TYPES = new Set(['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'video/mp4']);

export const recordingProviderStatus = () => ({
	configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
	name: 'Configured AI provider',
	maxAudioBytes: RECORDING_MAX_AUDIO_BYTES
});

const client = (connection?: LopuVaultProviderRecord) => {
	if (!connection && !recordingProviderStatus().configured) throw new Error('Recording transcription is not configured on this Thingtime.');
	// Connections are resolved and guarded server-side. Never accept inline
	// credentials, follow redirects, log audio, or persist provider errors.
	return new OpenAI({
		...(connection ? { apiKey: connection.token, baseURL: connection.endpoint } : {}),
		timeout: 20_000,
		maxRetries: 0,
		fetch: (url, init) => fetch(url, { ...init, redirect: 'error' })
	});
};

const withConnections = async <T>(
	ownerId: string,
	stage: RecordingStage,
	beforeSend: (() => Promise<void>) | undefined,
	attempt: (connection: LopuVaultProviderRecord, signal: AbortSignal) => Promise<T>
) => {
	const key = recordingStageSetting(stage);
	const ids = (await getRecordingSettings(ownerId))[key];
	return runRecordingWaterfall({
		ids,
		stage,
		beforeAttempt: async () => {
			await beforeSend?.();
			const current = await getRecordingSettings(ownerId);
			if (!current.enabled || (stage === 'analysis' && !(current.createNotes || current.createTodos)) || JSON.stringify(current[key]) !== JSON.stringify(ids))
				throw new Error('Recording consent or provider selection changed.');
		},
		attempt: async (id, signal) => attempt(await resolveRecordingConnection(ownerId, id, stage), signal)
	});
};

export const readRecordingBytes = async (ownerId: string, attachmentId: string): Promise<{ bytes: Uint8Array; type: string }> => {
	const download = await getAttachmentDownload({ id: ownerId }, attachmentId, false);
	if (!download.ok) throw new RecordingFailure('source');
	if (!AUDIO_TYPES.has(download.contentType) || download.size < 1 || download.size > RECORDING_MAX_AUDIO_BYTES) {
		throw new RecordingFailure('format');
	}
	const response = await fetch(download.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) }).catch(() => {
		throw new RecordingFailure('download');
	});
	if (!response.ok || !response.body) throw new RecordingFailure('download');
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > download.size || total > RECORDING_MAX_AUDIO_BYTES) throw new RecordingFailure('download');
			chunks.push(value);
		}
	} catch {
		throw new RecordingFailure('download');
	} finally {
		await reader.cancel().catch(() => {});
	}
	if (total !== download.size) throw new RecordingFailure('download');
	return { bytes: Buffer.concat(chunks), type: download.contentType };
};

export const transcribeRecording = async (ownerId: string, attachmentId: string, beforeSend?: () => Promise<void>): Promise<string> => {
	const { bytes, type } = await readRecordingBytes(ownerId, attachmentId);
	return withConnections(ownerId, 'transcription', beforeSend, (connection, signal) =>
		transcribeRecordingAudio(bytes, type, { connection, signal, rawFailure: true })
	);
};

// Separated from authorized attachment lookup so provider acceptance can use
// a synthetic audio fixture without creating data or bypassing attachment ACLs.
export const transcribeRecordingAudio = async (
	bytes: Uint8Array,
	type: string,
	options: { connection?: LopuVaultProviderRecord; signal?: AbortSignal; rawFailure?: boolean } = {}
): Promise<string> => {
	if (!AUDIO_TYPES.has(type) || !bytes.byteLength || bytes.byteLength > RECORDING_MAX_AUDIO_BYTES) throw new Error('Unsupported recording.');
	const api = client(options.connection);
	const extension = type.includes('wav') ? 'wav' : type.includes('webm') ? 'webm' : type.includes('mpeg') ? 'mp3' : 'm4a';
	try {
		const result = await api.audio.transcriptions.create(
			{
				model: 'gpt-4o-mini-transcribe',
				file: await toFile(bytes, `recording.${extension}`, { type }),
				response_format: 'json'
			},
			{ signal: options.signal }
		);
		const text = result.text?.trim();
		if (!text || text.length > RECORDING_MAX_TRANSCRIPT_CHARS) throw new Error('empty');
		return text;
	} catch (error) {
		if (options.rawFailure) throw error;
		throw recordingProviderFailure(error, 'transcription');
	}
};

export const analyzeRecording = async (transcript: string, beforeSend?: () => Promise<void>, ownerId?: string) => {
	const preferences = await getAiPreferredModelWaterfall();
	const attempt = async (connection: LopuVaultProviderRecord | undefined, signal?: AbortSignal) => {
		if (connection?.provider === 'anthropic') {
			const choice = resolveAiPreferredAnthropicChoice(preferences, process.env.LOPU_CLAUDE_MODEL || 'claude-sonnet-4-6');
			const api = new Anthropic({
				apiKey: connection.token,
				baseURL: connection.endpoint,
				timeout: 20_000,
				maxRetries: 0,
				fetch: (url, init) => fetch(url, { ...init, redirect: 'error' })
			});
			const result = await api.messages.create(
				{
					model: connection.model || choice.model,
					max_tokens: 6000,
					system: RECORDING_INSIGHTS_PROMPT,
					messages: [{ role: 'user', content: transcript }]
				},
				{ signal }
			);
			return parseRecordingInsights(
				result.content
					.filter((part) => part.type === 'text')
					.map((part) => part.text)
					.join(''),
				transcript
			);
		}
		const api = client(connection);
		const choice = resolveAiPreferredOpenAiChoice(preferences);
		const usePreferredTuning = !connection?.model || connection.model === choice?.model;
		const effort = toOpenAiReasoningEffort(usePreferredTuning ? choice?.effort ?? null : null);
		const result = await api.chat.completions.create(
			{
				model: connection?.model || choice?.model || process.env.LOPU_OPENAI_MODEL?.trim() || 'gpt-4o-mini',
				...(effort ? { reasoning_effort: effort } : {}),
				...(usePreferredTuning && choice?.speed === 'fast' ? { service_tier: 'priority' as const } : {}),
				max_completion_tokens: 6000,
				response_format: { type: 'json_object' },
				messages: [
					{ role: 'system', content: RECORDING_INSIGHTS_PROMPT },
					{ role: 'user', content: transcript }
				]
			},
			{ signal }
		);
		return parseRecordingInsights(result.choices[0]?.message.content || '', transcript);
	};
	if (ownerId) return withConnections(ownerId, 'analysis', beforeSend, attempt);
	await beforeSend?.();
	try {
		return await attempt(undefined);
	} catch (error) {
		throw recordingProviderFailure(error, 'analysis');
	}
};
