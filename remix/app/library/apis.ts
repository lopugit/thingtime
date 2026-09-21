import { slug, type LibraryExample } from './types';

type ApiRecipe = [title: string, path: string, input?: Record<string, unknown>, params?: Record<string, string>];
function api(
	provider: string,
	category: string,
	origin: string,
	docs: string,
	recipes: ApiRecipe[],
	auth?: NonNullable<LibraryExample['request']>['auth'],
	accountUrl?: string,
	headers?: Record<string, string>
): LibraryExample[] {
	return recipes.map(([title, path, input = {}, params]) => ({
		id: `${slug(provider)}-${slug(title)}`,
		provider,
		title,
		category,
		docs,
		input,
		kind: 'thing',
		description: `Read ${title.toLowerCase()} from ${provider}. The response is live; availability and account limits depend on the provider.`,
		request: { url: origin + path, params, auth, accountUrl, headers }
	}));
}
const bearer = { type: 'bearer' as const };
export const API_EXAMPLES: LibraryExample[] = [
	...api('GitHub', 'Developer APIs', 'https://api.github.com', 'https://docs.github.com/en/rest', [
		['Repository details', '/repos/{owner}/{repo}', { owner: 'vitejs', repo: 'vite' }],
		['Repository releases', '/repos/{owner}/{repo}/releases', { owner: 'vitejs', repo: 'vite' }, { per_page: '5' }],
		['Repository contributors', '/repos/{owner}/{repo}/contributors', { owner: 'vitejs', repo: 'vite' }, { per_page: '5' }],
		['User profile', '/users/{username}', { username: 'octocat' }],
		['Search repositories', '/search/repositories', { query: 'topic:react stars:>10000' }, { q: '{query}', per_page: '5' }],
		['Repository languages', '/repos/{owner}/{repo}/languages', { owner: 'microsoft', repo: 'typescript' }]
	]),
	...api('Open-Meteo', 'Weather & maps', 'https://api.open-meteo.com', 'https://open-meteo.com/en/docs', [
		[
			'Current weather',
			'/v1/forecast',
			{ latitude: -37.8136, longitude: 144.9631 },
			{ latitude: '{latitude}', longitude: '{longitude}', current: 'temperature_2m,wind_speed_10m' }
		],
		[
			'Hourly temperature',
			'/v1/forecast',
			{ latitude: 51.5072, longitude: -0.1276 },
			{ latitude: '{latitude}', longitude: '{longitude}', hourly: 'temperature_2m', forecast_days: '1' }
		],
		[
			'Daily forecast',
			'/v1/forecast',
			{ latitude: 40.7128, longitude: -74.006 },
			{ latitude: '{latitude}', longitude: '{longitude}', daily: 'temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '3' }
		],
		[
			'Rain forecast',
			'/v1/forecast',
			{ latitude: 48.8566, longitude: 2.3522 },
			{ latitude: '{latitude}', longitude: '{longitude}', hourly: 'precipitation_probability,precipitation', forecast_days: '1' }
		],
		[
			'Sunrise and sunset',
			'/v1/forecast',
			{ latitude: 35.6762, longitude: 139.6503 },
			{ latitude: '{latitude}', longitude: '{longitude}', daily: 'sunrise,sunset', timezone: 'auto', forecast_days: '3' }
		],
		[
			'UV index forecast',
			'/v1/forecast',
			{ latitude: -33.8688, longitude: 151.2093 },
			{ latitude: '{latitude}', longitude: '{longitude}', daily: 'uv_index_max', timezone: 'auto', forecast_days: '3' }
		]
	]),
	...api('PokéAPI', 'Games & culture', 'https://pokeapi.co', 'https://pokeapi.co/docs/v2', [
		['Pokémon details', '/api/v2/pokemon/{pokemon}', { pokemon: 'ditto' }],
		['Species lore', '/api/v2/pokemon-species/{pokemon}', { pokemon: 'eevee' }],
		['Type matchups', '/api/v2/type/{type}', { type: 'fire' }],
		['Ability details', '/api/v2/ability/{ability}', { ability: 'overgrow' }],
		['Move details', '/api/v2/move/{move}', { move: 'thunderbolt' }],
		['Item details', '/api/v2/item/{item}', { item: 'potion' }]
	]),
	...api('JSONPlaceholder', 'Learning APIs', 'https://jsonplaceholder.typicode.com', 'https://jsonplaceholder.typicode.com/guide/', [
		['Example posts', '/posts', {}, { _limit: '5' }],
		['Example user', '/users/{id}', { id: 1 }],
		['Post comments', '/posts/{id}/comments', { id: 1 }],
		['Example albums', '/albums', {}, { _limit: '5' }],
		['Example todos', '/todos', { userId: 1 }, { userId: '{userId}', _limit: '10' }]
	]),
	...api('Open Library', 'Books & knowledge', 'https://openlibrary.org', 'https://openlibrary.org/developers/api', [
		['Search books', '/search.json', { query: 'The Hobbit' }, { q: '{query}', limit: '5' }],
		['Search authors', '/search/authors.json', { query: 'Ursula Le Guin' }, { q: '{query}', limit: '5' }],
		['Book edition', '/books/{edition}.json', { edition: 'OL7353617M' }],
		['Author details', '/authors/{author}.json', { author: 'OL23919A' }],
		['Subject books', '/subjects/{subject}.json', { subject: 'science_fiction' }, { limit: '5' }]
	]),
	...api('Hacker News', 'Developer APIs', 'https://hacker-news.firebaseio.com', 'https://github.com/HackerNews/API', [
		['Top story IDs', '/v0/topstories.json'],
		['New story IDs', '/v0/newstories.json'],
		['Ask HN story IDs', '/v0/askstories.json'],
		['Story details', '/v0/item/{id}.json', { id: 8863 }],
		['User activity', '/v0/user/{username}.json', { username: 'jl' }]
	]),
	...api('Rick and Morty', 'Games & culture', 'https://rickandmortyapi.com', 'https://rickandmortyapi.com/documentation', [
		['Character directory', '/api/character'],
		['Search characters', '/api/character/', { name: 'rick' }, { name: '{name}' }],
		['Character details', '/api/character/{id}', { id: 1 }],
		['Location details', '/api/location/{id}', { id: 1 }],
		['Episode details', '/api/episode/{id}', { id: 1 }]
	]),
	...api('TVmaze', 'Games & culture', 'https://api.tvmaze.com', 'https://www.tvmaze.com/api', [
		['Search shows', '/search/shows', { query: 'Planet Earth' }, { q: '{query}' }],
		['Show details', '/shows/{id}', { id: 1 }],
		['Show episodes', '/shows/{id}/episodes', { id: 1 }],
		['Show cast', '/shows/{id}/cast', { id: 1 }],
		['Search people', '/search/people', { query: 'David Attenborough' }, { q: '{query}' }]
	]),
	...api(
		'Stripe',
		'Payments & business',
		'https://api.stripe.com',
		'https://docs.stripe.com/api',
		[
			['Test account balance', '/v1/balance'],
			['Test products', '/v1/products', {}, { limit: '5' }],
			['Test prices', '/v1/prices', {}, { limit: '5' }],
			['Test customers', '/v1/customers', {}, { limit: '5' }],
			['Test subscriptions', '/v1/subscriptions', {}, { limit: '5' }]
		],
		bearer,
		'https://dashboard.stripe.com/test/apikeys'
	),
	...api(
		'NASA',
		'Space & science',
		'https://api.nasa.gov',
		'https://api.nasa.gov/',
		[
			['Astronomy picture', '/planetary/apod', {}, { thumbs: 'true' }],
			['Astronomy archive date', '/planetary/apod', { date: '2024-01-01' }, { date: '{date}', thumbs: 'true' }],
			['Near Earth objects', '/neo/rest/v1/feed', { date: '2024-01-01' }, { start_date: '{date}', end_date: '{date}' }],
			['Browse asteroids', '/neo/rest/v1/neo/browse', {}, { size: '5' }],
			[
				'Space weather notifications',
				'/DONKI/notifications',
				{ start: '2024-01-01', end: '2024-01-07' },
				{ startDate: '{start}', endDate: '{end}', type: 'all' }
			]
		],
		{ type: 'query', name: 'api_key' },
		'https://api.nasa.gov/'
	),
	...api(
		'TMDB',
		'Games & culture',
		'https://api.themoviedb.org',
		'https://developer.themoviedb.org/reference/intro/getting-started',
		[
			['Popular movies', '/3/movie/popular'],
			['Search movies', '/3/search/movie', { query: 'Spirited Away' }, { query: '{query}' }],
			['Movie details', '/3/movie/{id}', { id: 129 }],
			['Trending this week', '/3/trending/all/week'],
			['Popular television', '/3/tv/popular']
		],
		bearer,
		'https://www.themoviedb.org/settings/api'
	),
	...api(
		'GIPHY',
		'Media APIs',
		'https://api.giphy.com',
		'https://developers.giphy.com/docs/api/',
		[
			['Trending GIFs', '/v1/gifs/trending', {}, { limit: '5', rating: 'g' }],
			['Search GIFs', '/v1/gifs/search', { query: 'hello' }, { q: '{query}', limit: '5', rating: 'g' }],
			['Trending stickers', '/v1/stickers/trending', {}, { limit: '5', rating: 'g' }],
			['Search stickers', '/v1/stickers/search', { query: 'celebrate' }, { q: '{query}', limit: '5', rating: 'g' }],
			['Translate a phrase', '/v1/gifs/translate', { text: 'good morning' }, { s: '{text}', rating: 'g' }]
		],
		{ type: 'query', name: 'api_key' },
		'https://developers.giphy.com/dashboard/'
	),
	...api(
		'Pexels',
		'Media APIs',
		'https://api.pexels.com',
		'https://www.pexels.com/api/documentation/',
		[
			['Curated photos', '/v1/curated', {}, { per_page: '5' }],
			['Search photos', '/v1/search', { query: 'nature' }, { query: '{query}', per_page: '5' }],
			['Photo details', '/v1/photos/{id}', { id: 2014422 }],
			['Search videos', '/videos/search', { query: 'ocean' }, { query: '{query}', per_page: '5' }],
			['Popular videos', '/videos/popular', {}, { per_page: '5' }]
		],
		{ type: 'header', name: 'Authorization' },
		'https://www.pexels.com/api/'
	),
	...api(
		'OpenWeather',
		'Weather & maps',
		'https://api.openweathermap.org',
		'https://openweathermap.org/api',
		[
			['City weather', '/data/2.5/weather', { city: 'Melbourne' }, { q: '{city}', units: 'metric' }],
			['Five day forecast', '/data/2.5/forecast', { city: 'London' }, { q: '{city}', units: 'metric', cnt: '5' }],
			['Air pollution', '/data/2.5/air_pollution', { latitude: 51.5072, longitude: -0.1276 }, { lat: '{latitude}', lon: '{longitude}' }],
			['Find coordinates', '/geo/1.0/direct', { city: 'Paris' }, { q: '{city}', limit: '3' }],
			['Reverse geocode', '/geo/1.0/reverse', { latitude: 35.6762, longitude: 139.6503 }, { lat: '{latitude}', lon: '{longitude}', limit: '3' }]
		],
		{ type: 'query', name: 'appid' },
		'https://home.openweathermap.org/api_keys'
	),
	...api(
		'OpenAI',
		'AI & language',
		'https://api.openai.com',
		'https://platform.openai.com/docs/api-reference/models',
		[['Available models', '/v1/models']],
		bearer,
		'https://platform.openai.com/api-keys'
	),
	...api(
		'Anthropic',
		'AI & language',
		'https://api.anthropic.com',
		'https://docs.anthropic.com/en/api/models-list',
		[['Available Claude models', '/v1/models', {}, { limit: '10' }]],
		{ type: 'header', name: 'x-api-key' },
		'https://console.anthropic.com/settings/keys',
		{ 'anthropic-version': '2023-06-01' }
	)
];
