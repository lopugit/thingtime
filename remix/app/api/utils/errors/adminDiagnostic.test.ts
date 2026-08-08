import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAX_ADMIN_DIAGNOSTIC_CHARS,
	MAX_ADMIN_DIAGNOSTIC_REVEALABLES,
	captureAdminErrorDiagnostic,
	sanitizeStoredAdminDiagnosticDetail
} from './adminDiagnostic';

test('admin diagnostics keep useful error context while scrubbing common secrets', () => {
	let getterReads = 0;
	const cause = Object.assign(new Error('Bearer cause-token at https://user:pass@example.invalid/path'), {
		apiKey: 'api-key-value'
	});
	const error = Object.assign(
		new Error(
			'Mongo failed at mongodb+srv://db-user:db-pass@example.invalid/thingtime ' +
				'THINGTIME_SERVICE_TOKEN=service-token JWT_SECRET=jwt-secret ' +
				'"password": "value with spaces" ownerId=507f1f77bcf86cd799439011 ' +
				'email=person@example.invalid eyJhbGciOiJIUzI1NiJ9.payload.signature ' +
				'-----BEGIN PRIVATE KEY----- private-material -----END PRIVATE KEY-----'
		),
		{
			name: 'MongoServerError',
			code: 224,
			password: 'plain-password',
			nested: { refresh_token: 'refresh-value', safeCount: 3 },
			cause
		}
	);
	Object.defineProperty(error, 'dangerousAccessor', {
		get() {
			getterReads += 1;
			return 'getter-secret';
		}
	});
	(cause as Error & { cycle?: unknown }).cycle = error;

	const diagnostic = captureAdminErrorDiagnostic(error);

	assert.equal(getterReads, 0, 'capturing an error must never invoke getters');
	assert.match(diagnostic.detail, /MongoServerError/);
	assert.match(diagnostic.detail, /"code": 224/);
	assert.match(diagnostic.detail, /\[redacted/);
	assert.doesNotMatch(
		diagnostic.detail,
		/db-user|db-pass|cause-token|user:pass|service-token|jwt-secret|value with spaces|507f1f77bcf86cd799439011|person@example\.invalid|private-material|plain-password|api-key-value|refresh-value|getter-secret/
	);
	assert.ok(diagnostic.redactions >= 5);
	assert.deepEqual(diagnostic.revealables, [], 'arbitrary error prose cannot authorize a reveal');
});

test('admin diagnostics retain only explicitly approved ObjectIds behind stable reveal references', () => {
	const first = '507f1f77bcf86cd799439011';
	const secondUppercase = '64B64C7E11AA22BB33CC44DD';
	const passwordShaped = 'aaaaaaaaaaaaaaaaaaaaaaaa';
	const tokenShaped = 'bbbbbbbbbbbbbbbbbbbbbbbb';
	const queryShaped = 'cccccccccccccccccccccccc';
	const ambiguous = 'dddddddddddddddddddddddd';
	const error = new Error(
		[
			`Billable Thing ${first} belongs to no current user`,
			`duplicate _id=${first}`,
			`driver _id: ObjectId("${secondUppercase}")`,
			`password=${passwordShaped}`,
			`token=${tokenShaped}`,
			`https://example.invalid/path?documentId=${queryShaped}`,
			`API secret was ObjectId("${ambiguous}")`
		].join(' · ')
	);

	const diagnostic = captureAdminErrorDiagnostic(error, { mongodbObjectIds: [first, secondUppercase] });

	assert.deepEqual(
		diagnostic.revealables.map(({ reference, kind, label, placeholder, value }) => ({ reference, kind, label, placeholder, value })),
		[
			{
				reference: 'mongodb-object-id-1',
				kind: 'mongodb-object-id',
				label: 'MongoDB ObjectId #1',
				placeholder: '[redacted MongoDB ObjectId #1]',
				value: first
			},
			{
				reference: 'mongodb-object-id-2',
				kind: 'mongodb-object-id',
				label: 'MongoDB ObjectId #2',
				placeholder: '[redacted MongoDB ObjectId #2]',
				value: secondUppercase.toLowerCase()
			}
		]
	);
	assert.match(diagnostic.detail, /Billable Thing \[redacted MongoDB ObjectId #1\]/);
	assert.match(JSON.parse(diagnostic.detail).message, /_id: ObjectId\("\[redacted MongoDB ObjectId #2\]"\)/);
	assert.doesNotMatch(diagnostic.detail, new RegExp([first, secondUppercase, passwordShaped, tokenShaped, queryShaped, ambiguous].join('|'), 'i'));
	assert.doesNotMatch(
		diagnostic.revealables.map((entry) => entry.value).join(' '),
		new RegExp([passwordShaped, tokenShaped, queryShaped, ambiguous].join('|'), 'i')
	);
});

test('admin diagnostic reveal tables stay bounded while overflow values remain redacted', () => {
	const ids = Array.from({ length: MAX_ADMIN_DIAGNOSTIC_REVEALABLES + 1 }, (_, index) => (index + 1).toString(16).padStart(24, '0'));
	const diagnostic = captureAdminErrorDiagnostic(new Error(ids.map((value) => `ObjectId("${value}")`).join(' ')), {
		mongodbObjectIds: ids
	});

	assert.equal(diagnostic.revealables.length, MAX_ADMIN_DIAGNOSTIC_REVEALABLES);
	assert.equal(diagnostic.truncated, true);
	assert.doesNotMatch(diagnostic.detail, new RegExp(ids.at(-1)!));
	assert.match(diagnostic.detail, /\[redacted-object-id\]/);
});

test('credential headers, hashes, and structured values are irreversible', () => {
	const cookieId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
	const passwordId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
	const tokenId = 'cccccccccccccccccccccccc';
	const credentialsId = 'dddddddddddddddddddddddd';
	const secretKeyId = 'eeeeeeeeeeeeeeeeeeeeeeee';
	const error = new Error(
		[
			`Cookie: session=${cookieId}; refresh=second-cookie`,
			'passwordHash=$2b$12$super-secret-password-hash',
			`password: new ObjectId("${passwordId}")`,
			`token: ["first-secret", "${tokenId}"]`,
			`credentials: { backup: "${credentialsId}" }`,
			`secretKey=${secretKeyId}`
		].join('\n')
	);

	const diagnostic = captureAdminErrorDiagnostic(error, {
		mongodbObjectIds: [cookieId, passwordId, tokenId, credentialsId, secretKeyId]
	});

	assert.deepEqual(diagnostic.revealables, []);
	assert.doesNotMatch(
		diagnostic.detail,
		/session=|second-cookie|super-secret-password-hash|aaaaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbbbb|cccccccccccccccccccccccc|dddddddddddddddddddddddd|eeeeeeeeeeeeeeeeeeeeeeee/i
	);

	for (const [label, value] of [
		['credentials', credentialsId],
		['secretKey', secretKeyId]
	] as const) {
		const isolated = captureAdminErrorDiagnostic(new Error(`${label}=${value}`), { mongodbObjectIds: [value] });
		assert.deepEqual(isolated.revealables, []);
		assert.doesNotMatch(isolated.detail, new RegExp(value, 'i'));
	}
});

test('multiline credential and cookie structures make every continuation irreversible', () => {
	const approved = '507f1f77bcf86cd799439011';
	for (const field of ['request cookies', 'clientSecret', 'password']) {
		const diagnostic = captureAdminErrorDiagnostic(
			new Error(
				[
					'context before credentials',
					`${field}: {`,
					'  "custom-name": "super-sensitive-value-should-not-render",',
					`  "nested-id": "${approved}"`,
					'}'
				].join('\n')
			),
			{ mongodbObjectIds: [approved] }
		);

		assert.match(diagnostic.detail, /context before credentials/);
		assert.match(diagnostic.detail, /redacted credential field and remainder/);
		assert.doesNotMatch(diagnostic.detail, /super-sensitive-value-should-not-render|507f1f77bcf86cd799439011/);
		assert.deepEqual(diagnostic.revealables, []);
	}
});

test('credential assignment labels normalize camelCase, plural, spaced, and CLI forms', () => {
	const labels = [
		'databasePassword',
		'currentPassword',
		'webhookSecret',
		'oauthClientSecret',
		'sessionCookie',
		'cookieHeader',
		'csrfToken',
		'credentialValue',
		'signingKey',
		'encryptionKey',
		'secure',
		'secureValue',
		'sensitiveData',
		'privateValue',
		'API key',
		'private key',
		'passwords',
		'tokens',
		'secrets',
		'passphrases',
		'apiKeys',
		'privateKeys',
		'accessKeys',
		'--password',
		'_password',
		'$password'
	];
	for (const [index, label] of labels.entries()) {
		const sentinel = `LEAKED-LABEL-SENTINEL-${index}`;
		const diagnostic = captureAdminErrorDiagnostic(new Error(`${label}=${sentinel}`));
		assert.doesNotMatch(diagnostic.detail, new RegExp(sentinel), label);
		assert.match(diagnostic.detail, /redacted credential field and remainder/, label);
	}

	for (const option of ['--password', '--token']) {
		const sentinel = `LEAKED-SPACE-OPTION-${option.slice(2).toUpperCase()}`;
		const diagnostic = captureAdminErrorDiagnostic(new Error(`command failed: dbtool ${option} ${sentinel} --host localhost`));
		assert.doesNotMatch(diagnostic.detail, new RegExp(sentinel), option);
		assert.match(diagnostic.detail, /redacted credential field and remainder/, option);
	}
});

test('native Error stacks are retained without invoking a substituted stack accessor', () => {
	const native = captureAdminErrorDiagnostic(new Error('native stack sentinel'));
	const nativeSnapshot = JSON.parse(native.detail);
	assert.equal(typeof nativeSnapshot.stack, 'string');
	assert.match(nativeSnapshot.stack, /native stack sentinel/);

	let stackReads = 0;
	const hostile = new Error('safe message');
	Object.defineProperty(hostile, 'stack', {
		configurable: true,
		get() {
			stackReads += 1;
			return 'stack-accessor-secret';
		}
	});
	const captured = captureAdminErrorDiagnostic(hostile);
	assert.equal(stackReads, 0);
	assert.doesNotMatch(captured.detail, /stack-accessor-secret/);

	for (const property of ['name', 'message'] as const) {
		let reads = 0;
		const indirect = new Error('safe native stack message');
		Object.defineProperty(indirect, property, {
			configurable: true,
			get() {
				reads += 1;
				return `LEAKED-${property.toUpperCase()}-SENTINEL`;
			}
		});
		const indirectCapture = captureAdminErrorDiagnostic(indirect);
		assert.equal(reads, 0, `${property} accessor must not be invoked by native stack formatting`);
		assert.doesNotMatch(indirectCapture.detail, new RegExp(`LEAKED-${property.toUpperCase()}-SENTINEL`));
	}
});

test('credential-bearing native errors keep safe callsite frames', () => {
	const diagnostic = captureAdminErrorDiagnostic(new Error('request cookies: {\n  "custom": "frame-secret"\n}'));
	const snapshot = JSON.parse(diagnostic.detail);

	assert.match(snapshot.message, /redacted credential field and remainder/);
	assert.doesNotMatch(snapshot.stack, /frame-secret/);
	assert.match(snapshot.stack, /\n\s+at /, 'safe native frames should survive message redaction');
});

test('identifier values containing extra text cannot inherit reveal eligibility from a placeholder', () => {
	const approved = '507f1f77bcf86cd799439011';
	const diagnostic = captureAdminErrorDiagnostic(new Error(`ownerId="tenant-secret ${approved}"`), {
		mongodbObjectIds: [approved]
	});

	assert.deepEqual(diagnostic.revealables, []);
	assert.doesNotMatch(diagnostic.detail, /tenant-secret|507f1f77bcf86cd799439011|redacted MongoDB ObjectId/);
	assert.match(diagnostic.detail, /ownerId=\[redacted\]/);

	const forgedPlaceholder = captureAdminErrorDiagnostic(
		new Error(`attacker text [redacted MongoDB ObjectId #1]\nownerId="tenant-secret ${approved}"`),
		{ mongodbObjectIds: [approved] }
	);
	assert.deepEqual(forgedPlaceholder.revealables, []);
	assert.doesNotMatch(forgedPlaceholder.detail, /tenant-secret|507f1f77bcf86cd799439011/);

	const realAndForged = captureAdminErrorDiagnostic(
		new Error(`Billable Thing ${approved} failed\nownerId="[redacted MongoDB ObjectId #1]"`),
		{ mongodbObjectIds: [approved] }
	);
	assert.equal(realAndForged.revealables.length, 1);
	assert.equal((realAndForged.detail.match(/\[redacted MongoDB ObjectId #1\]/g) || []).length, 2, 'only the real message and native stack copies survive');
	assert.match(realAndForged.detail, /ownerId=\[redacted\]/);
});

test('raw truncation redacts across the real fresh and stored output boundaries', () => {
	const objectId = '507f1f77bcf86cd799439011';
	const suffix = '\n…[text truncated after redaction]';
	for (const partial of [1, 6, 12, 23]) {
		for (const maxChars of [16 * 1024, MAX_ADMIN_DIAGNOSTIC_CHARS]) {
			const prefix = 'safe ';
			const filler = 'x'.repeat(maxChars - suffix.length - prefix.length - partial);
			const raw = `${prefix}${filler}${objectId}${'z'.repeat(1024)}`;
			const diagnostic =
				maxChars === 16 * 1024
					? captureAdminErrorDiagnostic(new Error(raw), { mongodbObjectIds: [objectId] })
					: sanitizeStoredAdminDiagnosticDetail(raw);
			const visibleText = maxChars === 16 * 1024 ? JSON.parse(diagnostic.detail).message : diagnostic.detail;

			assert.equal(diagnostic.truncated, true);
			assert.doesNotMatch(visibleText, new RegExp(objectId.slice(0, partial)), `${maxChars}:${partial}`);
			assert.deepEqual(diagnostic.revealables, []);
			assert.match(diagnostic.detail, /text truncated after redaction/);
		}
	}
});

test('ObjectIds use hexadecimal rather than word boundaries everywhere', () => {
	const objectId = '507f1f77bcf86cd799439011';
	const plain = captureAdminErrorDiagnostic(new Error(`compound thing_${objectId}_storage`));
	assert.doesNotMatch(plain.detail, new RegExp(objectId, 'i'));

	const vetoed = captureAdminErrorDiagnostic(
		new Error(`Billable Thing ${objectId}\npassword=prefix_${objectId}_suffix`),
		{ mongodbObjectIds: [objectId] }
	);
	assert.deepEqual(vetoed.revealables, []);
	assert.doesNotMatch(vetoed.detail, new RegExp(objectId, 'i'));

	const longerHex = `a${objectId}`;
	const longer = captureAdminErrorDiagnostic(new Error(`hash ${longerHex}`));
	assert.match(longer.detail, new RegExp(longerHex), 'a true longer hexadecimal token is not misclassified as an ObjectId');
});

test('an irreversible credential occurrence vetoes the same approved ObjectId everywhere', () => {
	const repeated = '507f1f77bcf86cd799439011';
	const diagnostic = captureAdminErrorDiagnostic(
		new Error(`Billable Thing ${repeated} belongs to no current user\npassword=${repeated}`),
		{ mongodbObjectIds: [repeated] }
	);

	assert.deepEqual(diagnostic.revealables, []);
	assert.doesNotMatch(diagnostic.detail, new RegExp(repeated, 'i'));
	assert.doesNotMatch(diagnostic.detail, /redacted MongoDB ObjectId/);
});

test('stored JSON diagnostics are rebuilt from the bounded error field allowlist', () => {
	const rawObjectId = '507f1f77bcf86cd799439011';
	const diagnostic = sanitizeStoredAdminDiagnosticDetail(
		JSON.stringify({
			name: 'MongoServerError',
			message: `Billable Thing ${rawObjectId} belongs to no current user`,
			password: 'must-never-survive',
			nested: { ownerId: rawObjectId }
		})
	);

	assert.match(diagnostic.detail, /MongoServerError/);
	assert.match(diagnostic.detail, /\[redacted-object-id\]/);
	assert.doesNotMatch(diagnostic.detail, /507f1f77bcf86cd799439011|must-never-survive|nested|ownerId/i);
	assert.deepEqual(diagnostic.revealables, []);

	const unsupported = sanitizeStoredAdminDiagnosticDetail(
		JSON.stringify({ nested: { ownerId: rawObjectId } })
	);
	assert.match(unsupported.detail, /UnavailableDiagnostic/);
	assert.doesNotMatch(unsupported.detail, /507f1f77bcf86cd799439011|nested|ownerId/i);
	assert.deepEqual(unsupported.revealables, []);

	const oversizedSecret = 'LEAKED-OVERSIZED-SECRET';
	const oversized = sanitizeStoredAdminDiagnosticDetail(
		JSON.stringify({
			name: 'Error',
			message: 'safe',
			nested: { privateValue: oversizedSecret },
			padding: 'x'.repeat(60_000)
		})
	);
	assert.match(oversized.detail, /UnavailableDiagnostic/);
	assert.doesNotMatch(oversized.detail, new RegExp(oversizedSecret));
	assert.equal(oversized.truncated, true);
});

test('stored diagnostics redact canonical secure and sensitive assignment labels', () => {
	for (const [index, label] of ['secure', 'secureValue', 'sensitiveData', 'privateValue'].entries()) {
		const sentinel = `STORED-SENSITIVE-SENTINEL-${index}`;
		const diagnostic = sanitizeStoredAdminDiagnosticDetail(
			JSON.stringify({ name: 'Error', message: `${label}=${sentinel}` })
		);
		assert.doesNotMatch(diagnostic.detail, new RegExp(sentinel), label);
		assert.match(diagnostic.detail, /redacted credential field and remainder/, label);
		assert.deepEqual(diagnostic.revealables, []);
	}
});

test('admin diagnostics are bounded across deep, wide, and oversized thrown values', () => {
	const root = new Error('y'.repeat(100_000));
	let cursor = root;
	for (let depth = 0; depth < 8; depth += 1) {
		const cause = new Error(`cause-${depth}`);
		(cursor as Error & { cause?: Error }).cause = cause;
		cursor = cause;
	}
	Object.assign(root, Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`field${index}`, 'x'.repeat(2_000)])));
	const diagnostic = captureAdminErrorDiagnostic(root);

	assert.equal(diagnostic.truncated, true);
	assert.ok(diagnostic.detail.length <= MAX_ADMIN_DIAGNOSTIC_CHARS);
	assert.match(diagnostic.detail, /truncated/);
	assert.doesNotMatch(diagnostic.detail, /field119/);
});
