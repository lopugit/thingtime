import React from 'react';
import { homeBackupDraft } from '~/fileSync/homeBackupPreset';
import type { ConfigurationDraft } from '~/fileSync/configurationEditor';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { SettingsDocumentHost, type SettingsDocumentHostProps } from '../Settings/SettingsDocumentHost';

export const homeBackupPresetBlocks: WebpageBlock[] = [{ id: 'home-backup-preset', type: 'element', tag: 'fieldset',
	css: { 'min-width': '0', padding: '12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px' }, children: [
		{ id: 'home-backup-title', type: 'element', tag: 'legend', text: 'Back up your home folder' },
		{ id: 'home-backup-help', type: 'element', tag: 'p', text: 'Choose your home folder as the device folder. This preset excludes Library, Applications and .Trash, including everything inside them. Your other exclusions stay in place.' },
		{ id: 'home-backup-action', type: 'element', tag: 'button', text: 'Use home backup preset', props: { type: 'button', disabled: '{preset.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'apply' } },
			css: { 'min-height': '40px', padding: '8px 12px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', 'max-width': '100%', 'white-space': 'normal' } },
		{ id: 'home-backup-review', type: 'element', tag: 'p', text: 'Review the folder, cloud destination and exclusions below. Backup keeps cloud copies when local files are deleted. The preset pauses the connection; uncheck Paused and save when you are ready, then choose Upload now.',
			css: { color: 'var(--tt-muted, #71717a)', 'font-size': '12px', 'overflow-wrap': 'anywhere' } },
		{ id: 'home-backup-error', type: 'element', tag: 'p', text: '{preset.error}', props: { role: 'alert' } }
	] }];

export function HomeBackupPreset({ draft, disabled, scopeKey, onChange, accountTransport }: {
	draft: ConfigurationDraft; disabled: boolean; scopeKey: string; onChange(draft: ConfigurationDraft): void;
	accountTransport?: SettingsDocumentHostProps['accountTransport'];
}) {
	const [error, setError] = React.useState('');
	const blocked = disabled || draft.pending || draft.configuration.sourceKind === 'photos';
	return <SettingsDocumentHost documentKey="file-sync-home-backup" defaultDocument={homeBackupPresetBlocks} scopeKey={scopeKey}
		title="Home folder backup preset" accountTransport={accountTransport}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing}
			scope={{ preset: { disabled: blocked, error } }} actions={{ apply: () => {
				if (blocked) return; setError(''); onChange(homeBackupDraft(draft));
			} }} onError={() => setError('The preset could not be applied. Your current draft is preserved.')}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
