import { getUserVaultProvider, listUserVaultProviders, userVaultConfigured } from './userVault';
import { assertSafeProviderEndpoint, type LopuVaultProviderRecord } from './vaultProviderClient';
import { getRecordingSettings } from './recordingsStore';
import { RecordingFailure, RECORDING_MAX_AUDIO_BYTES, type RecordingSettings } from './recordingsCore';
import { recordingProviderSupports, recordingStageSetting, type RecordingStage } from './recordingsWaterfall';

export type RecordingConnectionChoice = {
	id: string;
	name: string;
	provider: string;
	transcription: boolean;
	analysis: boolean;
	configured: boolean;
};

export const listRecordingConnections = async (ownerId: string): Promise<RecordingConnectionChoice[]> => {
	const entries = await listUserVaultProviders(ownerId);
	return [
		{
			id: 'configured',
			name: 'Platform audio and text provider',
			provider: 'openai',
			transcription: true,
			analysis: true,
			configured: Boolean(process.env.OPENAI_API_KEY?.trim())
		},
		{
			id: 'configured-anthropic',
			name: 'Platform Claude provider',
			provider: 'anthropic',
			transcription: false,
			analysis: true,
			configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim())
		},
		...entries
			.filter((entry) => ['openai', 'anthropic'].includes(entry.provider || ''))
			.map((entry) => ({
				id: entry.id,
				name: entry.name,
				provider: entry.provider!,
				transcription: recordingProviderSupports(entry.provider!, 'transcription'),
				analysis: recordingProviderSupports(entry.provider!, 'analysis'),
				configured: userVaultConfigured()
			}))
	];
};

export const validateRecordingConnections = async (ownerId: string, patch: Partial<RecordingSettings>) => {
	const choices = await listRecordingConnections(ownerId);
	for (const stage of ['transcription', 'analysis'] as const) {
		const ids = patch[recordingStageSetting(stage)];
		if (ids?.some((id) => !choices.some((choice) => choice.id === id && choice[stage])))
			throw new TypeError('Choose your own API provider connections that support this stage.');
	}
};

export const recordingConnectionStatus = async (ownerId: string, settings?: RecordingSettings) => {
	const choices = await listRecordingConnections(ownerId);
	const current = settings || (await getRecordingSettings(ownerId));
	const transcription = current.transcriptionProviders.some((id) =>
		choices.some((choice) => choice.id === id && choice.transcription && choice.configured)
	);
	const analysis = current.analysisProviders.some((id) => choices.some((choice) => choice.id === id && choice.analysis && choice.configured));
	return {
		configured: transcription && (!(current.createNotes || current.createTodos) || analysis),
		transcription,
		analysis,
		name: 'Selected AI provider waterfall',
		maxAudioBytes: RECORDING_MAX_AUDIO_BYTES,
		choices
	};
};

// Only the current owner's explicitly selected record is decrypted, and only
// immediately before a server-side request. Never enumerate CI credentials.
export const resolveRecordingConnection = async (ownerId: string, id: string, stage: RecordingStage): Promise<LopuVaultProviderRecord> => {
	let record: LopuVaultProviderRecord;
	if (id === 'configured' || id === 'configured-anthropic') {
		const anthropic = id === 'configured-anthropic';
		record = {
			id,
			name: 'Configured AI provider',
			provider: anthropic ? 'anthropic' : 'openai',
			endpoint: anthropic
				? process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com'
				: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
			model: null,
			token: (anthropic ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY)?.trim() || ''
		};
	} else {
		try {
			record = await getUserVaultProvider(ownerId, id);
		} catch {
			throw new RecordingFailure('provider_auth');
		}
	}
	if (!recordingProviderSupports(record.provider, stage) || !record.token || record.token.startsWith('sk-ant-oat'))
		throw new RecordingFailure('provider_auth');
	const safe = await assertSafeProviderEndpoint(record.endpoint);
	return { ...record, endpoint: safe.endpoint };
};
