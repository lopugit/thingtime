// Sample things for every built-in kind renderer — plain JSON exactly as the
// documents would sit in the `things` collection. The docs kind gallery maps
// over this list; it is also handy seed material for /api/v1/things.

export const sampleKindThings: Array<{ kind: string; thing: Record<string, unknown> }> = [
	{
		kind: 'post',
		thing: {
			kind: 'post',
			author: { username: 'lopu', displayName: 'Lopu 🦄', avatarUrl: null },
			text: 'Planted three new roses in the garden today 🌹 The data about them lives right next to this post — same tree, different render.',
			tags: ['garden', 'thingtime'],
			reactionCounts: { '❤️': 12, '🌱': 5 },
			commentCount: 3,
			createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString()
		}
	},
	{
		kind: 'video',
		thing: {
			kind: 'video',
			title: 'Repotting a monstera without the mess',
			channel: 'Thingtime Garden',
			duration: '4:32',
			views: '1.2k',
			url: 'https://example.com/watch/monstera',
			poster: null
		}
	},
	{
		kind: 'listing',
		thing: {
			kind: 'listing',
			title: 'Sunny yellow armchair',
			price: 120,
			currency: 'AUD',
			condition: 'used',
			location: 'Byron Bay',
			description: 'Super comfy reading chair, moving house so it needs a new home. Pick-up only.',
			seller: 'lopu',
			sold: false
		}
	},
	{
		kind: 'dashboard',
		thing: {
			kind: 'dashboard',
			title: 'Garden dashboard',
			metrics: [
				{ label: 'Plants', value: '23', change: 9, series: [12, 14, 15, 17, 19, 21, 23] },
				{ label: 'Watered today', value: '18', change: -5, series: [20, 19, 21, 18, 19, 18, 18] },
				{ label: 'Seedlings', value: '7', change: 40, series: [2, 3, 3, 4, 5, 6, 7] },
				{ label: 'Harvest (kg)', value: '3.4', change: 13, series: [1.1, 1.6, 2.0, 2.4, 2.8, 3.1, 3.4] }
			]
		}
	},
	{
		kind: 'place',
		thing: {
			kind: 'place',
			name: 'Community garden plot',
			address: '12 Rainbow Lane, Byron Bay',
			lat: -28.6474,
			lng: 153.602,
			note: 'Our shared plot — the tomatoes are on the north bed.'
		}
	},
	{
		kind: 'news-analysis',
		thing: {
			kind: 'news-analysis',
			headline: 'Council votes to expand community gardens',
			summary: 'The proposal passed 8–3. Coverage differs on the budget impact; the underlying figures are public.',
			bias: -0.2,
			claims: [
				{ claim: 'The expansion costs $2.1M over four years', verdict: 'verified' },
				{ claim: 'Rates will rise to pay for it', verdict: 'misleading' },
				{ claim: 'Waitlists for plots exceed 400 residents', verdict: 'verified' }
			],
			perspectives: [
				{ outlet: 'The Local Times', lean: 'lean left', take: 'Frames the vote as overdue investment in food security.' },
				{ outlet: 'Coast Daily', lean: 'lean right', take: 'Focuses on cost overruns in the previous garden program.' },
				{ outlet: 'Civic Wire', lean: 'centre', take: 'Publishes the budget table and both council speeches in full.' }
			],
			sources: ['council-minutes-2026-06', 'budget-paper-14', 'abs-community-data']
		}
	},
	{
		kind: 'comparison',
		thing: {
			kind: 'comparison',
			title: 'Which watering can?',
			items: [
				{ name: 'Classic tin 9L', price: '$24', weight: '1.4kg', 'drip-free spout': true, warranty: '2 years' },
				{ name: 'Recycled plastic 6L', price: '$11', weight: '0.6kg', 'drip-free spout': false, warranty: '1 year' },
				{ name: 'Copper heirloom 8L', price: '$89', weight: '1.9kg', 'drip-free spout': true, warranty: 'lifetime' }
			]
		}
	},
	{
		kind: 'chart',
		thing: {
			kind: 'chart',
			title: 'Rainfall this week (mm)',
			type: 'bar',
			labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
			values: [2, 14, 8, 0, 22, 31, 12],
			unit: ''
		}
	},
	{
		kind: 'profile',
		thing: {
			kind: 'profile',
			username: 'lopu',
			displayName: 'Lopu 🦄',
			bio: 'Gardening the internet. Everything is a thing.',
			avatarUrl: null,
			bannerUrl: null,
			stats: { things: 482, friends: 57, gardens: 3 }
		}
	},
	{
		kind: 'recipe',
		thing: {
			kind: 'recipe',
			title: 'Garden pesto',
			time: '15 min',
			serves: '4',
			ingredients: ['2 cups basil leaves', '1/2 cup olive oil', '1/3 cup pine nuts', '2 cloves garlic', 'Parmesan + salt to taste'],
			steps: [
				'Toast the pine nuts in a dry pan until golden.',
				'Blend basil, nuts, and garlic while streaming in the oil.',
				'Fold in parmesan, season, and store under a film of oil.'
			]
		}
	},
	{
		kind: 'element',
		thing: {
			kind: 'element',
			tag: 'div',
			props: {
				style: {
					padding: '20px',
					borderRadius: '16px',
					background: 'linear-gradient(135deg, #ffe9f2 0%, #e8f4ff 100%)',
					fontFamily: 'inherit',
					textAlign: 'center'
				}
			},
			children: [
				{
					tag: 'h3',
					props: { style: { margin: 0, fontSize: '18px', color: '#16161a' } },
					children: ['This card is pure JSON 🧱']
				},
				{
					tag: 'p',
					props: { style: { margin: '8px 0 0', fontSize: '13px', color: '#5a5a66' } },
					children: ['tag + props + children, stored in Mongo, rendered through a sanitising gate.']
				},
				{
					tag: 'button',
					props: {
						style: {
							marginTop: '14px',
							padding: '8px 18px',
							borderRadius: '999px',
							border: 'none',
							background: '#16161a',
							color: '#ffffff',
							fontWeight: 700,
							cursor: 'pointer'
						}
					},
					children: ['A button, as data']
				}
			]
		}
	}
];
