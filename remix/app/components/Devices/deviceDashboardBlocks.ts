import type { WebpageBlock } from '../Builder/webpageBlocks';

const metricNames = { cpu: 'CPU', ram: 'RAM', disk: 'Disk', network: 'Network' } as const;
type MetricKey = keyof typeof metricNames;
const rates = { disk: ['read', 'write'], network: ['download', 'upload'] } as const;
const captionColor = 'color-mix(in srgb, var(--tt-ink, #17171c) 45%, var(--tt-muted, #71717a))';

const element = (
	id: string,
	tag: string,
	css: Record<string, string> = {},
	text?: string,
	props?: Record<string, unknown>,
	children?: WebpageBlock[]
): WebpageBlock => ({ id, type: 'element', tag, css, ...(text ? { text } : {}), ...(props ? { props } : {}), ...(children ? { children } : {}) });

const card = (name: MetricKey): WebpageBlock => {
	const id = `device-dashboard-${name}`;
	const valuePath = `dashboard.${name}`;
	const accent = `var(--tt-device-${name}-accent)`;
	const fill = `var(--tt-device-${name}-fill, 0%)`;
	const track = 'var(--tt-border-strong, #d4d4d8)';
	const remainder = name === 'network' ? `var(--tt-device-network-remainder, ${track})` : track;
	return element(
		id,
		'article',
		{
			display: 'grid',
			'align-content': 'start',
			'justify-items': 'center',
			gap: '8px',
			'min-width': '0',
			padding: 'clamp(8px, 2.5vw, 16px)',
			border: '1px solid var(--tt-border, #ececef)',
			'text-align': 'center',
			'border-radius': 'var(--tt-radius-lg, 16px)',
			background: 'var(--tt-surface-alt, #f7f7f8)'
		},
		undefined,
		undefined,
		[
			element(
				`${id}-label`,
				'h4',
				{
					'font-weight': '700',
					'font-size': '13px',
					color: 'var(--tt-ink, #17171c)'
				},
				metricNames[name]
			),
			element(
				`${id}-gauge`,
				'div',
				{
					display: 'grid',
					'place-items': 'center',
					width: 'min(100%, 100px)',
					'aspect-ratio': '1',
					'border-radius': '50%',
					padding: '6px',
					background: `conic-gradient(${accent} 0 ${fill}, ${remainder} ${fill} 100%)`
				},
				undefined,
				undefined,
				[
					element(
						`${id}-face`,
						'div',
						{
							display: 'grid',
							'align-content': 'center',
							'justify-items': 'center',
							width: '100%',
							height: '100%',
							'border-radius': '50%',
							background: 'var(--tt-card, #fff)',
							color: accent,
							'line-height': '1.15',
							'font-variant-numeric': 'tabular-nums',
							'min-width': '0'
						},
						undefined,
						undefined,
						[
							element(
								`${id}-value`,
								'span',
								{
									'font-weight': '750',
									'font-size': name === 'network' ? 'clamp(14px, 4vw, 21px)' : 'clamp(16px, 4vw, 26px)',
									'overflow-wrap': 'anywhere'
								},
								`{${valuePath}.value}`
							),
							element(`${id}-unit`, 'span', { 'font-size': '11px', 'font-weight': '650' }, `{${valuePath}.unit}`)
						]
					)
				]
			),
			element(
				`${id}-detail`,
				'p',
				{ 'font-size': '11px', 'line-height': '1.35', color: captionColor, 'overflow-wrap': 'anywhere' },
				`{${valuePath}.detail}`
			),
			...(name === 'network' || name === 'disk'
				? [
						{
							id: `${id}-rate-visibility`,
							type: 'condition' as const,
							condition: { arg: `${valuePath}.hasRates`, equals: true },
							children: [
								element(
									`${id}-rates`,
									'div',
									{
										display: 'flex',
										'justify-content': 'center',
										'flex-wrap': 'wrap',
										gap: '2px 8px',
										'font-size': '11px',
										'line-height': '1.35',
										'font-weight': '650',
										'overflow-wrap': 'anywhere'
									},
									undefined,
									undefined,
									rates[name].map((rate) =>
										element(
											`${id}-${rate}`,
											'span',
											{ color: rate === 'upload' ? 'var(--tt-device-network-upload)' : accent },
											`{${valuePath}.${rate}}`
										)
									)
								)
							]
						}
				  ]
				: [])
		]
	);
};

export const deviceDashboardBlocks: WebpageBlock[] = [
	element(
		'device-dashboard',
		'section',
		{ display: 'grid', gap: '10px', 'min-width': '0' },
		undefined,
		{
			'aria-label': 'Device dashboard'
		},
		[
			element(
				'device-dashboard-heading',
				'h3',
				{
					'font-size': '16px',
					'font-weight': '750',
					color: 'var(--tt-ink, #17171c)'
				},
				'Device dashboard'
			),
			element(
				'device-dashboard-updated',
				'p',
				{
					'font-size': '12px',
					color: captionColor,
					'line-height': '1.35'
				},
				'{dashboard.status}'
			),
			element(
				'device-dashboard-grid',
				'div',
				{
					display: 'grid',
					'grid-template-columns': 'repeat(2, minmax(0, 1fr))',
					gap: '8px',
					'min-width': '0'
				},
				undefined,
				undefined,
				(Object.keys(metricNames) as MetricKey[]).map(card)
			)
		]
	)
];
