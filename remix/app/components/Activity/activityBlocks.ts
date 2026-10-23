import type { WebpageBlock } from '../Builder/webpageBlocks';
const element = (id: string, tag: string, text: string, props: Record<string, unknown> = {}): WebpageBlock => ({
	id,
	type: 'element',
	tag,
	text,
	props
});
const control = {
	display: 'inline-flex',
	'align-items': 'center',
	'min-height': '44px',
	padding: '8px 14px',
	border: '1px solid var(--tt-border, #d4d4d8)',
	'border-radius': '10px',
	background: 'var(--tt-card, #fff)',
	color: 'var(--tt-ink, #18181b)',
	cursor: 'pointer',
	'text-decoration': 'none',
	'font-size': '14px'
};
export const activityBlocks: WebpageBlock[] = [
	{
		id: 'activity-page',
		type: 'element',
		tag: 'section',
		props: { 'aria-label': 'Activity manager' },
		css: { display: 'grid', gap: '20px', 'min-width': '0', 'font-size': '14px', 'line-height': '1.6', color: 'var(--tt-ink, #18181b)' },
		children: [
			element('activity-eyebrow', 'p', 'THIS DEVICE · BACKGROUND WORK'),
			{ ...element('activity-heading', 'h1', 'Activity manager'), css: { 'font-size': '32px', 'font-weight': '650', margin: '0' } },
			element(
				'activity-description',
				'p',
				'See what is running in this window. Disable an activity to stop its timers, subscriptions or job admission. Choices stay saved on this device until you enable them again.'
			),
			{ ...element('activity-back', 'a', 'Back to Things', { href: '/things' }), css: { ...control, 'justify-self': 'start' } },
			element('activity-summary', 'p', '{activity.summary}', { role: 'status', 'aria-live': 'polite' }),
			{
				id: 'activity-coverage-details',
				type: 'element',
				tag: 'details',
				children: [
					element('activity-coverage-label', 'summary', 'What these controls cover'),
					element('activity-coverage', 'p', '{activity.coverage}')
				]
			},
			element('activity-native-status', 'p', '{activity.nativeStatus}', { role: 'status' }),
			{
				...element('activity-refresh-native', 'button', 'Refresh native services', {
					type: 'button',
					disabled: '{activity.nativeUnavailable}',
					'data-tt-action': '$transient',
					'data-tt-action-inputs': { operation: 'refresh-native' }
				}),
				css: { ...control, 'justify-self': 'start' }
			},
			element('activity-error', 'p', '{activity.error}', { role: 'alert' }),
			{
				id: 'activity-items',
				type: 'collection',
				props: {
					itemsPath: 'activity.rows',
					label: 'Registered activities',
					hideSize: true,
					hideCount: true,
					size: 'all',
					empty: 'No activity owners are mounted yet. Open a device or another app view to see its registered work.'
				},
				children: [
					{
						id: 'activity-card',
						type: 'element',
						tag: 'article',
						css: {
							display: 'grid',
							gap: '8px',
							padding: '20px',
							'margin-bottom': '12px',
							border: '1px solid var(--tt-border, #e4e4e7)',
							'border-radius': '14px',
							background: 'var(--tt-card, #fff)',
							'min-width': '0',
							'overflow-wrap': 'anywhere'
						},
						children: [
							{ ...element('activity-name', 'h2', '{item.title}'), css: { 'font-size': '17px', 'font-weight': '600', margin: '0' } },
							element('activity-kind', 'p', '{item.kind} · {item.state}'),
							element('activity-detail', 'p', '{item.detail}'),
							element('activity-metrics', 'p', '{item.metrics}'),
							{
								...element('activity-toggle', 'button', '{item.action}', {
									type: 'button',
									disabled: '{item.essential}',
									'data-tt-action': '$transient',
									'data-tt-action-inputs': { operation: 'toggle', id: '{item.id}' }
								}),
								css: { ...control, 'justify-self': 'start' }
							}
						]
					}
				]
			}
		]
	}
];
