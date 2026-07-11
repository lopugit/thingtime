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
	// ————— Media & content —————
	{
		kind: 'image',
		thing: {
			kind: 'image',
			images: [{ src: null, alt: 'Garden bed' }, { src: null, alt: 'Rose close-up' }],
			caption: 'The north bed after the spring planting',
			credit: 'lopu'
		}
	},
	{
		kind: 'audio',
		thing: {
			kind: 'audio',
			title: 'Rainy garden sounds',
			artist: 'Field recordings',
			duration: '3:12',
			src: null
		}
	},
	{
		kind: 'playlist',
		thing: {
			kind: 'playlist',
			title: 'Watering the plants',
			curator: 'lopu',
			tracks: [
				{ title: 'Morning dew', artist: 'Fern & Frond', duration: '3:41' },
				{ title: 'Photosynthesis', artist: 'The Chlorophylls', duration: '4:05' },
				{ title: 'Root systems', artist: 'Mycelium', duration: '2:58' }
			]
		}
	},
	{
		kind: 'podcast',
		thing: {
			kind: 'podcast',
			show: 'Everything Is A Thing',
			episode: 'Why your data wants to be a garden',
			episodeNumber: 12,
			description: 'We talk about nested data, kind renderers, and why brackets scare people.',
			duration: '42 min',
			publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString()
		}
	},
	{
		kind: 'article',
		thing: {
			kind: 'article',
			title: 'The internet is made of things',
			excerpt: 'Every feed, store, and inbox is the same trick: structured data wearing a friendly template. Here is how Thingtime makes that trick available to everyone.',
			author: 'Lopu',
			source: 'Thingtime Journal',
			readingTime: '6 min',
			publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
			cover: null
		}
	},
	{
		kind: 'quote',
		thing: {
			kind: 'quote',
			quote: 'Everything is a thing, and every thing can bloom.',
			attribution: 'Lopu',
			source: 'Thingtime manifesto'
		}
	},
	{
		kind: 'book',
		thing: {
			kind: 'book',
			title: 'The Secret Life of Structured Data',
			author: 'A. Schema',
			year: '2024',
			rating: 4,
			pages: 312,
			blurb: 'A field guide to the shapes hiding inside every app you use.'
		}
	},
	{
		kind: 'movie',
		thing: {
			kind: 'movie',
			title: 'JSON & The Argonauts',
			year: '2026',
			rating: 8.1,
			runtime: '1h 58m',
			genres: ['Adventure', 'Data'],
			synopsis: 'A ragtag crew of key-value pairs sails the nested seas in search of the golden render.'
		}
	},
	{
		kind: 'link',
		thing: {
			kind: 'link',
			url: 'https://thingtime.example/things/garden',
			title: 'My rainbow garden — live thing',
			description: 'A shared Thingtime thing: watering schedule, plants, and the harvest dashboard.',
			site: 'thingtime.example'
		}
	},
	{
		kind: 'file',
		thing: {
			kind: 'file',
			name: 'garden-plan-2026.pdf',
			type: 'pdf',
			size: '2.4 MB',
			modifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString(),
			url: null
		}
	},
	{
		kind: 'code',
		thing: {
			kind: 'code',
			filename: 'renderThing.tsx',
			language: 'tsx',
			code: "const card = <RenderThing thing={anyJson} />;\n// kinds resolve by field or by shape ✨",
			description: 'The one-line dispatcher any feed can use.'
		}
	},
	{
		kind: 'repository',
		thing: {
			kind: 'repository',
			owner: 'lopugit',
			name: 'thingtime',
			description: 'Data for everyone — nested things, kind renderers, and a rainbow.',
			language: 'TypeScript',
			stars: 1289,
			forks: 87,
			url: null
		}
	},
	{
		kind: 'rich-text',
		thing: {
			kind: 'rich-text',
			blocks: [
				{ type: 'header', data: { text: 'Garden notes', level: 2 } },
				{ type: 'paragraph', data: { text: 'The monstera doubled over winter. Time to repot before the roots stage a breakout.' } },
				{ type: 'checklist', data: { items: [{ text: 'Buy 30cm pot', checked: true }, { text: 'Fresh potting mix', checked: false }] } },
				{ type: 'quote', data: { text: 'Growth is just nested time.', caption: 'Lopu' } }
			]
		}
	},

	// ————— Social & communication —————
	{
		kind: 'email',
		thing: {
			kind: 'email',
			from: 'Community Garden',
			to: 'lopu',
			subject: 'Your plot inspection is booked 🌱',
			preview: 'Hi Lopu! Just confirming Thursday 9am for the seasonal plot walk-through. Bring your…',
			sentAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
			unread: true
		}
	},
	{
		kind: 'chat',
		thing: {
			kind: 'chat',
			title: 'Seed swap crew',
			messages: [
				{ from: 'Mika', text: 'Anyone got spare basil seeds?' },
				{ from: 'me', text: 'Loads! Bringing them Saturday 🌿', me: true },
				{ from: 'Mika', text: 'Legend. Trading for heirloom tomatoes.' }
			]
		}
	},
	{
		kind: 'contact',
		thing: {
			kind: 'contact',
			name: 'Fern Whitlock',
			role: 'Community garden coordinator',
			phone: '+61 400 000 000',
			email: 'fern@rainbowlane.example',
			address: '12 Rainbow Lane, Byron Bay'
		}
	},
	{
		kind: 'faq',
		thing: {
			kind: 'faq',
			title: 'Seed swap FAQ',
			items: [
				{ question: 'Do I need to bring seeds to take seeds?', answer: 'Nope — first-timers can just take a few packets and pay it forward next season.' },
				{ question: 'Are cuttings welcome?', answer: 'Yes, as long as they are pest-free and labelled.' }
			]
		}
	},
	{
		kind: 'poll',
		thing: {
			kind: 'poll',
			question: 'What should we plant in the shared bed?',
			options: [
				{ label: 'Pumpkins 🎃', votes: 14 },
				{ label: 'Sunflowers 🌻', votes: 22 },
				{ label: 'Sweet corn 🌽', votes: 9 }
			],
			closesAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString()
		}
	},
	{
		kind: 'review',
		thing: {
			kind: 'review',
			rating: 5,
			title: 'The comfiest reading chair',
			text: 'Bought the yellow armchair from Lopu — it is even sunnier in person. Smooth pickup, honest listing.',
			reviewer: 'Mika',
			subject: 'Sunny yellow armchair',
			date: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString()
		}
	},
	{
		kind: 'job',
		thing: {
			kind: 'job',
			role: 'Head gardener',
			company: 'Rainbow Lane Collective',
			location: 'Byron Bay',
			salary: '$85k–$95k',
			type: 'Full-time',
			tags: ['permaculture', 'composting', 'community'],
			description: 'Lead the shared beds, run the seed library, and teach weekend workshops.',
			postedAt: new Date(Date.now() - 1000 * 60 * 60 * 70).toISOString()
		}
	},

	// ————— Commerce & money —————
	{
		kind: 'product',
		thing: {
			kind: 'product',
			name: 'Copper heirloom watering can 8L',
			price: 89,
			compareAt: 119,
			currency: 'AUD',
			rating: 4,
			reviewCount: 132,
			variants: ['8L', '5L'],
			inStock: true
		}
	},
	{
		kind: 'order',
		thing: {
			kind: 'order',
			orderNumber: '#TT-4821',
			status: 'Shipped',
			currency: 'AUD',
			items: [
				{ name: 'Heirloom tomato seeds', qty: 3, price: 4.5 },
				{ name: 'Copper watering can', qty: 1, price: 89 }
			],
			subtotal: 102.5,
			shipping: 9.95,
			total: 112.45
		}
	},
	{
		kind: 'shipment',
		thing: {
			kind: 'shipment',
			carrier: 'AusPost',
			trackingNumber: 'TT123456789AU',
			status: 'Shipped',
			eta: 'Friday',
			steps: ['Ordered', 'Packed', 'Shipped', 'Out for delivery', 'Delivered'],
			currentStep: 2
		}
	},
	{
		kind: 'coupon',
		thing: {
			kind: 'coupon',
			code: 'GROW20',
			discount: '20% off',
			description: 'Everything in the seedling section',
			brand: 'Rainbow Nursery',
			expiresAt: 'July 31'
		}
	},
	{
		kind: 'donation',
		thing: {
			kind: 'donation',
			title: 'New greenhouse for the community garden',
			description: 'Help us build a four-season greenhouse so the seed library never sleeps.',
			raised: 7420,
			goal: 12000,
			currency: 'AUD',
			supporters: 143
		}
	},
	{
		kind: 'subscription',
		thing: {
			kind: 'subscription',
			plan: 'Thingtime Bloom',
			price: 9,
			currency: 'USD',
			period: 'month',
			features: ['Unlimited things', 'Shareable themes', 'Kind templates', 'Rainbow mode 🌈'],
			highlight: true
		}
	},
	{
		kind: 'stock',
		thing: {
			kind: 'stock',
			symbol: 'SEED',
			name: 'Seedling Industries',
			price: 42.7,
			currency: 'USD',
			changePercent: 3.2,
			series: [38.2, 39.1, 38.7, 40.3, 41.0, 41.8, 42.7]
		}
	},
	{
		kind: 'budget',
		thing: {
			kind: 'budget',
			title: 'July garden budget',
			currency: 'AUD',
			categories: [
				{ label: 'Seeds & seedlings', spent: 64, budget: 80 },
				{ label: 'Tools', spent: 112, budget: 100 },
				{ label: 'Compost', spent: 25, budget: 60 }
			]
		}
	},
	{
		kind: 'property',
		thing: {
			kind: 'property',
			title: 'Sunny cottage with established garden',
			price: 720,
			currency: 'AUD',
			forRent: true,
			beds: 2,
			baths: 1,
			area: '540 m²',
			address: 'Rainbow Lane, Byron Bay'
		}
	},
	{
		kind: 'menu',
		thing: {
			kind: 'menu',
			title: 'Garden Café',
			currency: 'AUD',
			sections: [
				{
					name: 'Breakfast',
					items: [
						{ name: 'Basil scramble', price: 18, description: 'From the north bed, obviously' },
						{ name: 'Tomato toast', price: 14, description: 'Heirloom, sourdough, olive oil' }
					]
				},
				{ name: 'Drinks', items: [{ name: 'Mint & honey iced tea', price: 7, description: '' }] }
			]
		}
	},

	// ————— Planning & time —————
	{
		kind: 'event',
		thing: {
			kind: 'event',
			title: 'Seed swap Saturday',
			startsAt: new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(),
			venue: 'Community garden',
			description: 'Bring seeds, cuttings, and lemonade. First-timers welcome.',
			rsvpCount: 34,
			online: false
		}
	},
	{
		kind: 'ticket',
		thing: {
			kind: 'ticket',
			event: 'Open Garden Festival',
			holder: 'Lopu',
			date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 12).toISOString(),
			section: 'GA',
			seat: 'Lawn',
			code: 'TT-88-BLOOM'
		}
	},
	{
		kind: 'calendar',
		thing: {
			kind: 'calendar',
			title: 'This week',
			days: [
				{ date: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), events: [{ time: '7:00', title: 'Water the beds' }, { time: '18:00', title: 'Compost turn' }] },
				{ date: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(), events: [{ time: '9:00', title: 'Plot inspection with Fern' }] },
				{ date: new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(), events: [] }
			]
		}
	},
	{
		kind: 'task',
		thing: {
			kind: 'task',
			title: 'Repot the monstera',
			done: false,
			due: 'Sunday',
			priority: 'High',
			assignee: 'lopu',
			notes: 'Roots are circling — size up to the 30cm terracotta.'
		}
	},
	{
		kind: 'task-list',
		thing: {
			kind: 'task-list',
			title: 'Spring planting',
			tasks: [
				{ title: 'Turn the compost', done: true },
				{ title: 'Start tomato seeds', done: true },
				{ title: 'Net the strawberries', done: false },
				{ title: 'Label the herb spiral', done: false }
			]
		}
	},
	{
		kind: 'timeline',
		thing: {
			kind: 'timeline',
			title: 'Garden history',
			entries: [
				{ date: '2026', title: 'Greenhouse fund launched', description: 'Community campaign kicked off at the seed swap.' },
				{ date: '2024', title: 'First harvest festival', description: '40 neighbours, one very large pumpkin.' },
				{ date: '2023', title: 'Rainbow garden established', description: 'Three beds, six ferns, endless optimism.' }
			]
		}
	},
	{
		kind: 'milestone',
		thing: {
			kind: 'milestone',
			title: 'Grow 30 plants',
			progress: 76,
			target: '30',
			unit: 'plants',
			note: '23 of 30 — seedlings sprinting since the rain.'
		}
	},
	{
		kind: 'itinerary',
		thing: {
			kind: 'itinerary',
			title: 'Iceland in spring',
			days: [
				{ label: 'Day 1 — Reykjavík', stops: ['Land at KEF', 'Hallgrímskirkja', 'Harbour walk'] },
				{ label: 'Day 2 — Golden Circle', stops: ['Þingvellir', 'Geysir', 'Gullfoss'] }
			]
		}
	},
	{
		kind: 'booking',
		thing: {
			kind: 'booking',
			title: 'Fern Cabin, Blue Mountains',
			confirmation: 'TT-STAY-2931',
			checkIn: 'Fri 24 Jul, 3pm',
			checkOut: 'Sun 26 Jul, 10am',
			guests: 2,
			location: 'Blackheath NSW',
			status: 'Confirmed'
		}
	},
	{
		kind: 'flight',
		thing: {
			kind: 'flight',
			flightNumber: 'TT 042',
			from: 'BNE',
			fromCity: 'Brisbane',
			to: 'KEF',
			toCity: 'Reykjavík',
			departs: '9:40 AM',
			arrives: '6:15 PM',
			gate: '23',
			seat: '14A'
		}
	},

	// ————— Knowledge, health & life —————
	{
		kind: 'weather',
		thing: {
			kind: 'weather',
			location: 'Byron Bay',
			temp: 22,
			unit: 'C',
			condition: 'Partly cloudy',
			high: 24,
			low: 15,
			forecast: [
				{ day: 'Fri', condition: 'sunny', high: 24, low: 14 },
				{ day: 'Sat', condition: 'showers', high: 21, low: 15 },
				{ day: 'Sun', condition: 'rain', high: 19, low: 14 },
				{ day: 'Mon', condition: 'partly cloudy', high: 22, low: 13 },
				{ day: 'Tue', condition: 'sunny', high: 25, low: 15 }
			]
		}
	},
	{
		kind: 'workout',
		thing: {
			kind: 'workout',
			title: 'Gardener strength',
			duration: '35 min',
			calories: 240,
			exercises: [
				{ name: 'Wheelbarrow lunges', sets: 3, reps: '12', weight: '' },
				{ name: 'Compost squats', sets: 3, reps: '15', weight: '10kg' },
				{ name: 'Watering-can carries', sets: 2, reps: '40m', weight: '8kg' }
			]
		}
	},
	{
		kind: 'course',
		thing: {
			kind: 'course',
			title: 'Permaculture foundations',
			provider: 'Rainbow Lane Collective',
			level: 'Beginner',
			lessons: 12,
			duration: '6 weeks',
			progress: 58,
			description: 'Design a garden that waters, feeds, and mulches itself.'
		}
	},
	{
		kind: 'certificate',
		thing: {
			kind: 'certificate',
			title: 'Compost Whisperer, Level II',
			recipient: 'Lopu',
			issuer: 'Rainbow Lane Collective',
			date: 'June 2026',
			credentialId: 'RLC-CW2-0042'
		}
	},
	{
		kind: 'definition',
		thing: {
			kind: 'definition',
			word: 'thing',
			phonetic: '/θɪŋ/',
			partOfSpeech: 'noun',
			meanings: [
				'Any piece of data a person cares about, nested inside other things.',
				'The unit of Thingtime: it can look like a card, a page, or a garden.'
			],
			example: 'Everything is a thing.'
		}
	},
	{
		kind: 'leaderboard',
		thing: {
			kind: 'leaderboard',
			title: 'Pumpkin weigh-off',
			entries: [
				{ name: 'Mika', score: '84 kg' },
				{ name: 'Lopu', score: '77 kg' },
				{ name: 'Fern', score: '71 kg' },
				{ name: 'Sol', score: '64 kg' }
			]
		}
	},
	{
		kind: 'match',
		thing: {
			kind: 'match',
			competition: 'Backyard Cup — Final',
			status: 'LIVE 71\'',
			home: { name: 'Ferns FC', score: 2 },
			away: { name: 'Succulents United', score: 1 },
			venue: 'Rainbow Lane oval',
			when: 'Today'
		}
	},
	{
		kind: 'changelog',
		thing: {
			kind: 'changelog',
			version: 'Thingtime v0.12',
			date: 'July 2026',
			changes: [
				{ type: 'Added', text: '60 kind renderers — your data knows how to look now.' },
				{ type: 'Added', text: 'Block editor for long text, everywhere.' },
				{ type: 'Improved', text: 'Nested viewers ship with desktop and mobile modes.' },
				{ type: 'Fixed', text: 'Brackets no longer allowed to scare anyone.' }
			]
		}
	},
	{
		kind: 'plant',
		thing: {
			kind: 'plant',
			name: 'Monty',
			species: 'Monstera deliciosa',
			water: 'weekly',
			light: 'bright indirect',
			lastWatered: '2 days ago',
			happy: true,
			notes: 'Two new leaves this month. He knows he is the favourite.'
		}
	},

	// ————— Builder —————
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
