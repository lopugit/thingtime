import type { WebpageBlock } from '../Builder/webpageBlocks';

const text = (id: string, tag: string, value: string, props: Record<string, unknown> = {}): WebpageBlock => ({
	id,
	type: 'element',
	tag,
	text: value,
	props
});
const linkStyle = {
	display: 'inline-flex',
	'align-items': 'center',
	'min-height': '44px',
	padding: '8px 12px',
	'border-radius': '8px',
	border: '1px solid var(--tt-border, #d4d4d8)',
	color: 'var(--tt-ink, #18181b)',
	'text-decoration': 'none',
	'overflow-wrap': 'anywhere'
};
export const deviceSyncOverviewBlocks: WebpageBlock[] = [
	{
		id: 'device-sync-overview',
		type: 'element',
		tag: 'section',
		props: { 'aria-label': 'Device file sync' },
		css: { display: 'grid', gap: '16px', 'font-size': '14px', 'line-height': '1.55', 'min-width': '0', color: 'var(--tt-ink, #18181b)' },
		children: [
			text('device-sync-eyebrow', 'p', 'DEVICE FILES', { 'aria-hidden': true }),
			{ ...text('device-sync-heading', 'h2', 'Synced files'), css: { 'font-size': '24px', 'font-weight': '650', margin: '0' } },
			text(
				'device-sync-description',
				'p',
				'Browse saved cloud folders for this device, including when it is offline. Opening files does not start or resume a transfer.'
			),
			{
				id: 'device-sync-navigation',
				type: 'element',
				tag: 'nav',
				props: { 'aria-label': 'Device files navigation' },
				css: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' },
				children: [
					{ ...text('device-sync-all-things', 'a', 'All Things', { href: '/things' }), css: linkStyle },
					{ ...text('device-sync-settings-link', 'a', 'Device settings', { href: '{deviceSync.settingsHref}' }), css: linkStyle },
					{ ...text('device-sync-files-link', 'a', 'Browse synced files', { href: '{deviceSync.filesHref}' }), css: linkStyle }
				]
			},
			{
				...text('device-sync-refresh', 'button', 'Refresh folders', {
					type: 'button',
					'data-tt-action': '$transient',
					'data-tt-action-inputs': JSON.stringify({ operation: 'refresh' })
				}),
				css: { ...linkStyle, 'justify-self': 'start', cursor: 'pointer', background: 'var(--tt-card, #fff)' }
			},
			text('device-sync-status', 'p', '{deviceSync.status}', { role: 'status', 'aria-live': 'polite' }),
			text('device-sync-error', 'p', '{deviceSync.error}', { role: 'alert' }),
			{
				id: 'device-sync-folders',
				type: 'collection',
				props: {
					itemsPath: 'deviceSync.folders',
					label: 'Saved sync folders',
					hideSearch: true,
					hideSize: true,
					hideCount: true,
					size: 'all',
					empty: '{deviceSync.empty}'
				},
				children: [
					{
						id: 'device-sync-folder',
						type: 'element',
						tag: 'article',
						css: {
							display: 'grid',
							gap: '6px',
							padding: '16px',
							border: '1px solid var(--tt-border, #e4e4e7)',
							'border-radius': '12px',
							'min-width': '0',
							background: 'var(--tt-card, #fff)'
						},
						children: [
							{ ...text('device-sync-folder-name', 'a', '{item.name}', { href: '{item.href}' }), css: { ...linkStyle, 'font-weight': '600' } },
							text('device-sync-folder-direction', 'p', '{item.mode}'),
							text('device-sync-folder-state', 'p', '{item.state}'),
							text('device-sync-folder-help', 'p', 'View the files saved in this cloud folder. Connection status is not a complete-backup guarantee.')
						]
					}
				]
			}
		]
	}
];
