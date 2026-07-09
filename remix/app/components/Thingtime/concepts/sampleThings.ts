// The shared demo thing for the viewer concepts — a slice of an everyday
// person's world, deep enough to exercise nesting, arrays, mixed leaves, and
// kind-carrying subtrees (which the concepts render through the kind registry).

export const makeSampleWorld = (): Record<string, unknown> => ({
	me: {
		kind: 'profile',
		username: 'lopu',
		displayName: 'Lopu 🦄',
		bio: 'Gardening the internet. Everything is a thing.',
		stats: { things: 482, friends: 57, gardens: 3 }
	},
	garden: {
		name: 'Rainbow garden',
		established: 2023,
		organic: true,
		plants: [
			{ name: 'Monstera', water: 'weekly', happy: true, age: 3 },
			{ name: 'Rose bush', water: 'daily', happy: true, age: 1 },
			{ name: 'Basil', water: 'daily', happy: false, age: 0.2 }
		],
		'watering schedule': {
			morning: '7:00am',
			evening: '6:30pm',
			'skip when raining': true
		},
		journal:
			'## Repotting plan\n\nThe monstera doubled over winter — time to size up before the roots stage a breakout.\n\n- [x] Buy 30cm terracotta pot\n- [ ] Fresh potting mix\n- [ ] Bribe Monty with plant food\n\n> Growth is just nested time.',
		dashboard: {
			kind: 'dashboard',
			title: 'Garden health',
			metrics: [
				{ label: 'Plants', value: '23', change: 9, series: [12, 14, 15, 17, 19, 21, 23] },
				{ label: 'Seedlings', value: '7', change: 40, series: [2, 3, 3, 4, 5, 6, 7] }
			]
		}
	},
	'for sale': {
		kind: 'listing',
		title: 'Sunny yellow armchair',
		price: 120,
		currency: 'AUD',
		condition: 'used',
		location: 'Byron Bay',
		description: 'Super comfy reading chair, moving house so it needs a new home.',
		sold: false
	},
	'favourite recipe': {
		kind: 'recipe',
		title: 'Garden pesto',
		time: '15 min',
		serves: '4',
		ingredients: ['2 cups basil leaves', '1/2 cup olive oil', '1/3 cup pine nuts', '2 cloves garlic'],
		steps: ['Toast the pine nuts.', 'Blend everything while streaming in oil.', 'Fold in parmesan and season.']
	},
	places: {
		'community garden': {
			kind: 'place',
			name: 'Community garden plot',
			address: '12 Rainbow Lane, Byron Bay',
			lat: -28.6474,
			lng: 153.602,
			note: 'Tomatoes on the north bed.'
		},
		'dream trip': 'Iceland in spring'
	},
	settings: {
		theme: 'rainbow',
		notifications: true,
		'items per page': 5,
		drawer: {
			open: true,
			width: 300,
			opens: { direction: 'left' }
		}
	},
	ideas: ['Grow a moon garden 🌙', 'Teach the feed to love ferns', 'Host a seed swap']
});

// a tiny thing for compact/story variants
export const makeSampleNote = (): Record<string, unknown> => ({
	title: 'Seed swap',
	when: 'Saturday 10am',
	confirmed: true,
	guests: 12,
	'bring list': ['basil seeds', 'spare pots', 'lemonade']
});
