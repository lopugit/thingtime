import { expectJson, type ApiTestDefinition } from './apiTestRunner';

// Real HTTP fixtures, never a seeded session/DB record. Each run owns its accounts.
const suffix = crypto.randomUUID().replace(/-/g, '');
const username = `tt-watch-test-${suffix.slice(0, 12)}`;
// Generate a fresh fixture credential; never embed or reuse an account password.
const password = crypto.randomUUID();
const credential = `ttnode_${suffix}${crypto.randomUUID().replace(/-/g, '')}`;
const ip = `2001:db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}::24`;
let pairing: { pairingId: string; deviceCode: string; userCode: string };
let deviceId: string;
const claim = () => ({ op: 'claim', ...pairing, credential });
const approval = () => ({ op: 'approve', pairingId: pairing?.pairingId, userCode: pairing?.userCode });
const common = {
	group: 'watch' as const,
	method: 'POST' as const,
	path: '/api/v1/watch/pairing',
	headers: { 'X-Forwarded-For': ip },
	mutates: true
};

export const watchPairingTests: ApiTestDefinition[] = [
	{
		...common,
		id: 'watch-code-lookup-auth',
		name: 'Code lookup requires a browser account',
		description: 'Human codes alone never authorize anonymous callers.',
		anonymous: true,
		body: { op: 'lookup', userCode: 'ABCDEFGH' },
		expect: expectJson([401], (body) => body?.ok === false, 'Anonymous lookup was rejected.')
	},
	{
		...common,
		id: 'watch-pairing-start',
		name: 'Watch receives code and manual entry address',
		description: 'The code-entry address needs no hidden pairing query; legacy complete links remain available.',
		anonymous: true,
		body: { op: 'start', device: { name: 'API Test Apple Watch', platform: 'watchos', model: 'Test', appVersion: '24' } },
		expect: expectJson(
			[201],
			(body) => {
				pairing = body?.pairing;
				return (
					body?.ok &&
					/^[A-Z2-9]{8}$/.test(pairing?.userCode) &&
					body.pairing.verificationEntryPath === '/watch/pair' &&
					body.pairing.verificationPath.startsWith('/watch/pair?pairing=')
				);
			},
			'Received an eight-character code and both approval paths.'
		)
	},
	...Array.from(
		{ length: 31 },
		(_, index): ApiTestDefinition => ({
			...common,
			id: `watch-pairing-poll-${index + 1}`,
			name: `Unapproved poll ${index + 1} remains pending`,
			description: 'Normal three-second polling must not consume the 30-request device-pairing creation budget.',
			anonymous: true,
			body: claim,
			expect: expectJson([428], (body) => body?.code === 'authorization_pending', 'Polling remains authorization_pending, not rate-limited.')
		})
	),
	{
		...common,
		id: 'watch-register-owner',
		name: 'Create isolated Watch test account',
		path: '/api/v1/auth/register',
		description: 'Establish a real browser session via the registration API with a reserved, undeliverable example.invalid address.',
		body: { username, password, email: `${username}@example.invalid`, displayName: 'Watch pairing test' },
		expect: expectJson([200, 201], (body) => body?.ok && body?.user?.username === username, 'Created the test owner through the public API.')
	},
	// Browsers forbid overriding Origin; the headless runner checks this boundary.
	...(typeof window === 'undefined'
		? [
				{
					...common,
					id: 'watch-code-lookup-cross-origin',
					name: 'Cross-origin code lookup is rejected',
					description: 'Code guessing requires same-origin browser requests.',
					headers: { ...common.headers, Origin: 'https://cross-origin.example.invalid' },
					body: () => ({ op: 'lookup', userCode: pairing?.userCode }),
					expect: expectJson([403], (body) => body?.ok === false, 'Cross-origin lookup was rejected.')
				}
		  ]
		: []),
	{
		...common,
		id: 'watch-code-lookup-unknown',
		name: 'Unknown code is actionable',
		description: 'A valid-shaped but nonexistent code returns a same-domain/new-code recovery message.',
		body: { op: 'lookup', userCode: '00000000' },
		expect: expectJson([404], (body) => body?.error?.includes('same Thingtime domain'), 'Unknown codes show recovery guidance.')
	},
	{
		...common,
		id: 'watch-code-lookup',
		name: 'Find Watch using only its displayed code',
		description: 'Lowercase, spaces and hyphens normalize without asking the user for a hidden pairing ID.',
		body: () => ({ op: 'lookup', userCode: `${pairing?.userCode.slice(0, 4)}-${pairing?.userCode.slice(4)}`.toLowerCase() }),
		expect: expectJson(
			[200],
			(body) =>
				body?.pairingId === pairing?.pairingId &&
				body?.approved === false &&
				body?.device?.platform === 'watchos' &&
				!body.deviceCode &&
				!body.credential &&
				!body.user,
			'Code-only lookup returns only the Watch review details.'
		)
	},
	{
		...common,
		id: 'watch-approve',
		name: 'Approve Watch for the signed-in account',
		description: 'Review does not approve automatically; this explicit action binds the account.',
		body: approval,
		expect: expectJson([200], (body) => body?.approved === true, 'The signed-in account approved its Watch.')
	},
	{
		...common,
		id: 'watch-approve-retry',
		name: 'Same-account approval retry is safe',
		description: 'A repeated tap or uncertain browser response must not break a valid approval.',
		body: approval,
		expect: expectJson([200], (body) => body?.approved === true, 'Repeated approval is idempotent.')
	},
	{
		...common,
		id: 'watch-register-other',
		name: 'Create isolated second account',
		path: '/api/v1/auth/register',
		description: 'Switch the browser session to exercise cross-account takeover protection.',
		body: { username: `${username}-other`, password, email: `${username}-other@example.invalid` },
		expect: expectJson([200, 201], (body) => body?.ok && body?.user?.username === `${username}-other`, 'Established the second test account.')
	},
	{
		...common,
		id: 'watch-approve-other-account',
		name: 'Another account cannot take over approval',
		description: 'Knowing the displayed code cannot overwrite an already approved owner.',
		body: approval,
		expect: expectJson([409], (body) => body?.ok === false, 'Cross-account takeover was rejected.')
	},
	{
		...common,
		id: 'watch-claim',
		name: 'Watch claims its approved scoped credential',
		description: 'Only the long device secret held on the Watch completes pairing.',
		anonymous: true,
		body: claim,
		expect: expectJson(
			[200],
			(body) => {
				deviceId = body?.device?.id;
				return body?.credentialStored === true && typeof deviceId === 'string' && body?.user?.username === username;
			},
			'The Watch claimed the original approved account.'
		)
	},
	{
		...common,
		id: 'watch-claim-retry',
		name: 'Lost claim response can be retried',
		description: 'An identical retry returns the same device, not a duplicate or a new account.',
		anonymous: true,
		body: claim,
		expect: expectJson([200], (body) => body?.device?.id === deviceId && body?.user?.username === username, 'Claim retry returned the same Watch.')
	},
	{
		...common,
		id: 'watch-sync-after-code-approval',
		name: 'Paired Watch downloads its notifications directly',
		description: 'The newly issued Watch-scoped credential must work without any iPhone/browser session.',
		path: '/api/v1/watch/sync',
		anonymous: true,
		headers: { ...common.headers, Authorization: `Bearer ${credential}` },
		body: { limit: 10 },
		expect: expectJson(
			[200],
			(body) => body?.ok && body?.account?.username === username && Array.isArray(body?.notifications),
			'Watch authenticated and downloaded its notification list.'
		)
	},
	{
		...common,
		id: 'watch-code-consumed',
		name: 'Consumed human code cannot find an active pairing',
		description: 'Manual lookup excludes consumed requests.',
		body: () => ({ op: 'lookup', userCode: pairing?.userCode }),
		expect: expectJson([404], (body) => body?.ok === false, 'Consumed code was rejected.')
	}
];
