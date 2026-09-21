import { api } from './apis';
import type { LibraryExample } from './types';
const bearer = { type: 'bearer' as const };
const googleKey = { type: 'header' as const, name: 'X-Goog-Api-Key' };
const setup = (examples: LibraryExample[], text: string, credentialLabel = 'API key / access token') =>
	examples.map((e) => ({ ...e, setup: text, credentialLabel }));
export const PLATFORM_API_EXAMPLES: LibraryExample[] = [
	...setup(
		api(
			'Mapbox',
			'Weather & maps',
			'https://api.mapbox.com',
			'https://docs.mapbox.com/api/search/geocoding/',
			[
				['Forward geocoding', '/search/geocode/v6/forward', { query: 'Federation Square Melbourne' }, { q: '{query}', limit: '3' }],
				[
					'Reverse geocoding',
					'/search/geocode/v6/reverse',
					{ longitude: 144.9691, latitude: -37.818 },
					{ longitude: '{longitude}', latitude: '{latitude}' }
				],
				[
					'Driving directions',
					'/directions/v5/mapbox/driving/{coordinates}',
					{ coordinates: '144.9631,-37.8136;144.9691,-37.818' },
					{ geometries: 'geojson', overview: 'simplified', steps: 'false' }
				],
				[
					'Walking directions',
					'/directions/v5/mapbox/walking/{coordinates}',
					{ coordinates: '144.9631,-37.8136;144.9691,-37.818' },
					{ geometries: 'geojson', overview: 'simplified', steps: 'false' }
				]
			],
			{ type: 'query', name: 'access_token' },
			'https://account.mapbox.com/access-tokens/'
		),
		'Use a token permitted for Geocoding or Directions. This server request has no browser referrer; use a dedicated server token rather than a URL-restricted browser token. Provider billing applies.',
		'Mapbox access token'
	),
	...setup(
		[
			...api(
				'Google Places',
				'Weather & maps',
				'https://places.googleapis.com',
				'https://developers.google.com/maps/documentation/places/web-service/place-details',
				[['Place details REST', '/v1/places/{placeId}', { placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }]],
				googleKey,
				'https://console.cloud.google.com/google/maps-apis/credentials',
				{ 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,googleMapsUri,attributions' }
			),
			...api(
				'Google Places',
				'Weather & maps',
				'https://places.googleapis.com',
				'https://developers.google.com/maps/documentation/places/web-service/text-search',
				[['Text search REST', '/v1/places:searchText', { query: 'cafes in Melbourne' }]],
				googleKey,
				'https://console.cloud.google.com/google/maps-apis/credentials',
				{ 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.attributions' }
			).map((e) => ({ ...e, request: { ...e.request!, method: 'POST' as const, body: { textQuery: '{query}', pageSize: 5 } } })),
			...api(
				'Google Places',
				'Weather & maps',
				'https://places.googleapis.com',
				'https://developers.google.com/maps/documentation/places/web-service/nearby-search',
				[['Nearby cafes REST', '/v1/places:searchNearby', { latitude: -37.8136, longitude: 144.9631, radius: 500 }]],
				googleKey,
				'https://console.cloud.google.com/google/maps-apis/credentials',
				{ 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.attributions' }
			).map((e) => ({
				...e,
				request: {
					...e.request!,
					method: 'POST' as const,
					body: {
						includedTypes: ['cafe'],
						maxResultCount: 5,
						locationRestriction: { circle: { center: { latitude: '{latitude}', longitude: '{longitude}' }, radius: '{radius}' } }
					}
				}
			}))
		],
		'Enable Places API (New) and billing. Use a separate server API key restricted to Places API; website/referrer-restricted keys are for the JavaScript demos. Field masks and small result limits constrain the requested data. These POST searches only read data, but Google may bill them.',
		'Google Places server API key'
	),
	...setup(
		api(
			'YouTube',
			'Media APIs',
			'https://www.googleapis.com/youtube/v3',
			'https://developers.google.com/youtube/v3/docs',
			[
				['Search videos', '/search', { query: 'NASA earth' }, { part: 'snippet', q: '{query}', type: 'video', maxResults: '5' }],
				['Video details', '/videos', { videoId: 'aqz-KE-bpKQ' }, { part: 'snippet,contentDetails,statistics', id: '{videoId}' }],
				['Channel details', '/channels', { handle: '@NASA' }, { part: 'snippet,statistics', forHandle: '{handle}' }]
			],
			{ type: 'query', name: 'key' },
			'https://console.cloud.google.com/apis/credentials'
		),
		'Enable YouTube Data API v3. Use an API-restricted server key; each run consumes provider quota.',
		'YouTube API key'
	),
	...setup(
		api(
			'Spotify',
			'Media APIs',
			'https://api.spotify.com/v1',
			'https://developer.spotify.com/documentation/web-api',
			[
				['Search tracks', '/search', { query: 'Khruangbin' }, { q: '{query}', type: 'track', limit: '5', market: 'AU' }],
				['Track details', '/tracks/{id}', { id: '11dFghVXANMlKmJXsNCbNl' }, { market: 'AU' }],
				['Artist details', '/artists/{id}', { id: '4NHQUGzhtTLFvgF5SZesLK' }],
				['Album tracks', '/albums/{id}/tracks', { id: '4aawyAB9vmqN3uQ7FjRGTy' }, { limit: '5', market: 'AU' }]
			],
			bearer,
			'https://developer.spotify.com/dashboard'
		),
		'Paste a short-lived OAuth access token from your Spotify app, not its client secret. Development-mode eligibility and endpoint access depend on your app/account. No playback or account changes occur.',
		'Spotify OAuth access token'
	),
	...setup(
		api(
			'Microsoft Graph',
			'Productivity APIs',
			'https://graph.microsoft.com/v1.0',
			'https://learn.microsoft.com/graph/overview',
			[
				['My profile', '/me', {}, { $select: 'id,displayName,userPrincipalName' }],
				['My drive files', '/me/drive/root/children', {}, { $top: '5', $select: 'id,name,size,webUrl' }],
				['My calendar events', '/me/events', {}, { $top: '5', $select: 'id,subject,start,end,webLink' }]
			],
			bearer,
			'https://developer.microsoft.com/graph/graph-explorer'
		),
		'Use a delegated Microsoft Graph OAuth access token. Grant User.Read for profile, Files.Read for drive, or Calendars.ReadBasic for events as appropriate. Results contain your account data and remain in this open demo.',
		'Microsoft Graph OAuth access token'
	),
	...setup(
		api(
			'GitLab',
			'Developer APIs',
			'https://gitlab.com/api/v4',
			'https://docs.gitlab.com/api/',
			[
				['My GitLab profile', '/user'],
				['My projects', '/projects', {}, { membership: 'true', per_page: '5', simple: 'true' }],
				['Project issues', '/projects/{projectId}/issues', { projectId: 278964 }, { per_page: '5', state: 'opened' }]
			],
			{ type: 'header', name: 'PRIVATE-TOKEN' },
			'https://gitlab.com/-/user_settings/personal_access_tokens'
		),
		'Use a GitLab.com personal access token with read_api and access to the selected project. No issue or project is changed.',
		'GitLab personal access token'
	),
	...setup(
		api(
			'Cloudflare',
			'Cloud platforms',
			'https://api.cloudflare.com/client/v4',
			'https://developers.cloudflare.com/api/',
			[
				['Verify API token', '/user/tokens/verify'],
				['List zones', '/zones', {}, { per_page: '5' }],
				['Zone DNS records', '/zones/{zoneId}/dns_records', { zoneId: 'your-zone-id' }, { per_page: '5' }]
			],
			bearer,
			'https://dash.cloudflare.com/profile/api-tokens'
		),
		'Use an API token with Zone Read or DNS Read for the chosen zone. Token verification checks validity; these examples never alter DNS.',
		'Cloudflare API token'
	),
	...setup(
		api(
			'Contentful',
			'Content platforms',
			'https://cdn.contentful.com',
			'https://www.contentful.com/developers/docs/references/content-delivery-api/',
			[
				[
					'Published entries',
					'/spaces/{space}/environments/{environment}/entries',
					{ space: 'your-space-id', environment: 'master' },
					{ limit: '5', include: '0' }
				],
				['Published assets', '/spaces/{space}/environments/{environment}/assets', { space: 'your-space-id', environment: 'master' }, { limit: '5' }],
				[
					'Content types',
					'/spaces/{space}/environments/{environment}/content_types',
					{ space: 'your-space-id', environment: 'master' },
					{ limit: '5' }
				]
			],
			bearer,
			'https://app.contentful.com/'
		),
		'Use a Content Delivery API token for your space and environment, not a management token. These examples read published content only.',
		'Contentful delivery token'
	)
];
