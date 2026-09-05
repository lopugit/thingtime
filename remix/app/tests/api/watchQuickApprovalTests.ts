import { expectJson, type ApiTestDefinition } from './apiTestRunner';

const suffix = crypto.randomUUID().replace(/-/g, '');
const username = `ttquickwatch${suffix.slice(0, 10)}`;
const password = `Test-${suffix}!`;
const credential = `ttnode_${suffix}${crypto.randomUUID().replace(/-/g, '')}`;
let pairing: any;
let addressed: any;
const common = {
	group: 'watch' as const,
	method: 'POST' as const,
	path: '/api/v1/watch/pairing',
	mutates: true,
	headers: { 'X-Forwarded-For': `2001:db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}::25` }
};
const claim = () => ({ op: 'claim', pairingId: pairing?.pairingId, deviceCode: pairing?.deviceCode, credential });
const offer = () => ({ op: 'offer', pairingId: pairing?.pairingId, userCode: pairing?.userCode, approvalToken: pairing?.approvalToken });
const approve = () => ({ op: 'approve', pairingId: pairing?.pairingId, userCode: pairing?.userCode });
const failed = (status: number, message: string) => expectJson([status], (body) => body?.ok === false, message);

export const watchQuickApprovalTests: ApiTestDefinition[] = [
	{
		...common,
		id: 'watch-username-unknown',
		name: 'Mistyped username offers actionable recovery',
		description: 'Never silently turn an addressed request into an unbound code.',
		anonymous: true,
		body: {
			op: 'start',
			codeFormat: 'numeric-4',
			targetUsername: `missing${suffix}`,
			device: { name: 'Unknown recipient fixture', platform: 'watchos' }
		},
		expect: failed(400, 'Unknown recipient rejected before code creation.')
	},
	{
		...common,
		id: 'watch-inbox-anonymous',
		name: 'Pending Watch inbox requires sign-in',
		description: 'No ambient pending codes are public.',
		method: 'GET',
		path: '/api/v1/watch/pairing?op=pending',
		anonymous: true,
		expect: failed(401, 'Anonymous inbox was rejected.')
	},
	{
		...common,
		id: 'watch-quick-register',
		name: 'Create quick-approval fixture owner',
		description: 'An isolated real API account, never a seeded credential.',
		path: '/api/v1/auth/register',
		body: { username, password, email: `${username}@example.invalid` },
		expect: expectJson([200], (body) => body?.user?.username === username, 'Recipient account registered.')
	},
	{
		...common,
		id: 'watch-numeric-start',
		name: 'New Watch requests four digits',
		description: 'Numeric codes preserve leading zeroes and expire in five minutes.',
		anonymous: true,
		body: { op: 'start', codeFormat: 'numeric-4', device: { name: 'Quick approval fixture', platform: 'watchos' } },
		expect: expectJson(
			[201],
			(body) => {
				pairing = body?.pairing;
				return (
					/^\d{4}$/.test(pairing?.userCode) && /^ttapprove_/.test(pairing?.approvalToken) && Date.parse(pairing.expiresAt) - Date.now() <= 300_000
				);
			},
			'Four-digit code and a separate secure handoff token returned.'
		)
	},
	{
		...common,
		id: 'watch-offer-anonymous',
		name: 'Phone handoff requires its browser account',
		description: 'The handoff token alone does not select a user.',
		anonymous: true,
		body: offer,
		expect: failed(401, 'Anonymous offer was rejected.')
	},
	{
		...common,
		id: 'watch-offer-needs-secret',
		name: 'Four digits cannot forge a phone handoff',
		description: 'A PIN plus pairing ID is insufficient to bind a request.',
		body: () => ({ ...offer(), approvalToken: 'invalid' }),
		expect: failed(400, 'Missing handoff proof was rejected.')
	},
	{
		...common,
		id: 'watch-offer',
		name: 'Paired phone offers request to its active account',
		description: 'Offer attaches the request but does not approve.',
		body: offer,
		expect: expectJson(
			[200],
			(body) => body?.offered === true && body.account?.username === username && !body.approved,
			'Offer was delivered without approval.'
		)
	},
	{
		...common,
		id: 'watch-offer-repeat',
		name: 'Phone handoff retry is idempotent',
		description: 'Foreground and queued delivery converge to the same request.',
		body: offer,
		expect: expectJson([200], (body) => body?.offered === true, 'Repeated offer is safe.')
	},
	{
		...common,
		id: 'watch-offer-no-auto-approve',
		name: 'Delivery never auto-approves the Watch',
		description: 'The Watch still waits for an explicit browser button after handoff.',
		anonymous: true,
		body: claim,
		expect: expectJson([428], (body) => body?.code === 'authorization_pending', 'Explicit approval is still required.')
	},
	{
		...common,
		id: 'watch-inbox-prefilled',
		name: 'Recipient sees prefilled approval request',
		description: 'Safe device, code and request ID only; never the claim/handoff secrets.',
		method: 'GET',
		path: '/api/v1/watch/pairing?op=pending',
		expect: expectJson(
			[200],
			(body) =>
				body?.account?.username === username &&
				body.requests?.some((r: any) => r.pairingId === pairing?.pairingId && r.userCode === pairing?.userCode) &&
				!JSON.stringify(body).includes(pairing.deviceCode) &&
				!JSON.stringify(body).includes(pairing.approvalToken),
			'Prefilled request is visible only to its recipient.'
		)
	},
	{
		...common,
		id: 'watch-username-start',
		name: 'Watch can address an entered username',
		description: 'A targeted request appears in the named account inbox and has a distinct active PIN.',
		anonymous: true,
		body: { op: 'start', codeFormat: 'numeric-4', targetUsername: username, device: { name: 'Username fixture', platform: 'watchos' } },
		expect: expectJson(
			[201],
			(body) => {
				addressed = body?.pairing;
				return /^\d{4}$/.test(addressed?.userCode) && addressed.userCode !== pairing?.userCode;
			},
			'Username request has a unique numeric PIN.'
		)
	},
	{
		...common,
		id: 'watch-username-inbox',
		name: 'Username request reaches matching sessions',
		description: 'The account inbox contains the username-targeted request.',
		method: 'GET',
		path: '/api/v1/watch/pairing?op=pending',
		expect: expectJson(
			[200],
			(body) => body.requests?.some((r: any) => r.pairingId === addressed?.pairingId && r.userCode === addressed?.userCode),
			'Username-targeted request is ready to approve.'
		)
	},
	{
		...common,
		id: 'watch-quick-register-other',
		name: 'Create isolated unrelated account',
		description: 'Exercise account boundaries through real browser cookies.',
		path: '/api/v1/auth/register',
		body: { username: `${username}other`, password, email: `${username}other@example.invalid` },
		expect: expectJson([200], (body) => body?.user?.username === `${username}other`, 'Unrelated account registered.')
	},
	{
		...common,
		id: 'watch-inbox-isolated',
		name: 'Other account cannot list either request',
		description: 'Pending requests are scoped by recipient, not by IP or global last request.',
		method: 'GET',
		path: '/api/v1/watch/pairing?op=pending',
		expect: expectJson([200], (body) => body.requests?.length === 0, 'Other account has no leaked requests.')
	},
	{
		...common,
		id: 'watch-offer-takeover',
		name: 'Handoff cannot switch recipients',
		description: 'Even the full handoff proof cannot rebind an already offered request.',
		body: offer,
		expect: failed(404, 'Recipient takeover was rejected.')
	},
	{
		...common,
		id: 'watch-offered-approve-other',
		name: 'Other account cannot approve an offered PIN',
		description: 'Explicit approval is bound to the selected recipient.',
		body: approve,
		expect: failed(403, 'Wrong-account approval was rejected.')
	},
	{
		...common,
		id: 'watch-offered-lookup-other',
		name: 'Other account cannot look up an offered PIN',
		description: 'Knowing four digits must not reveal the recipient’s request.',
		body: () => ({ op: 'lookup', userCode: pairing?.userCode }),
		expect: failed(404, 'Wrong-account PIN lookup was rejected.')
	},
	{
		...common,
		id: 'watch-quick-login-owner',
		name: 'Return to recipient account',
		description: 'Use the normal login API.',
		path: '/api/v1/login',
		body: { username, password },
		expect: expectJson([200], (body) => body?.user?.username === username, 'Recipient signed in.')
	},
	{
		...common,
		id: 'watch-prefilled-approve',
		name: 'Prefilled button approves its exact Watch',
		description: 'No manual lookup/entry is needed once offered.',
		body: approve,
		expect: expectJson([200], (body) => body?.approved === true, 'Prefilled request explicitly approved.')
	},
	{
		...common,
		id: 'watch-prefilled-claim',
		name: 'Approved quick request can be claimed',
		description: 'The Watch claims directly with its private secret.',
		anonymous: true,
		body: claim,
		expect: expectJson([200], (body) => body?.user?.username === username && body?.credentialStored === true, 'The intended account was paired.')
	},
	{
		...common,
		id: 'watch-prefilled-sync',
		name: 'Quick-approved Watch downloads notifications',
		description: 'No phone browser credentials are needed for subsequent sync.',
		path: '/api/v1/watch/sync',
		anonymous: true,
		headers: { ...common.headers, Authorization: `Bearer ${credential}` },
		body: { limit: 10 },
		expect: expectJson(
			[200],
			(body) => body?.account?.username === username && Array.isArray(body?.notifications),
			'Direct notification sync succeeded.'
		)
	},
	...Array.from(
		{ length: 5 },
		(_, i): ApiTestDefinition => ({
			...common,
			id: `watch-short-pin-guess-${i}`,
			name: `PIN guess ${i + 1} consumes an attempt`,
			description: 'Invalid format still consumes the account guessing budget.',
			body: { op: 'lookup', userCode: 'invalid' },
			expect: failed(400, 'Invalid PIN rejected.')
		})
	),
	{
		...common,
		id: 'watch-short-pin-limited',
		name: 'Sixth PIN guess is rate limited',
		description: 'A four-digit space requires strict per-account throttling.',
		body: { op: 'lookup', userCode: 'invalid' },
		expect: expectJson(
			[429],
			(body, response) => body?.ok === false && !!response.headers.get('Retry-After'),
			'Five-attempt ceiling enforced with Retry-After.'
		)
	}
];
