import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { isProtectedThingtime, PROTECTED_THINGTIME, projectBuiltinSchemaCrystal, thingtimeSchemas, validateThingtimeCrystal } from './registry.ts';

// The congruence alarm for builtin-schema seeding (seed-builtin-schemas in
// api/utils/migrations/migrations.ts): every builtin crystal schema must
// project onto the schema-thing grammar AND clear validateThingtimeCrystal
// (['schema']) — the exact write gate user-published schemas pass. If the
// registry or the grammar evolves apart, this fails HERE instead of seeding an
// invalid thing (or silently dropping a builtin from the seed).

const crystalSchemas = thingtimeSchemas.filter((schema) => schema.kind === 'crystal');

const fieldNames = (crystal: Record<string, unknown>): string[] => (crystal.fields as Array<{ name: string }>).map((field) => field.name);

// Pinned projections. A diff here is a REVIEW PROMPT, not necessarily a bug:
// a new registry field should appear (or be knowingly dropped as a record/
// reserved name) and the pin updated in the same change.
const EXPECTED_PROJECTED_FIELDS: Record<string, string[]> = {
	attachment: ['name', 'filenamePreview', 'title', 'description', 'size', 'contentType', 'mediaKind', 'detectedContentType'],
  post: ['type', 'text', 'images', 'listing'], // thing: record → dropped
  comment: ['text'],
  reaction: ['emoji'],
  share: [], // marker schema — the thingtime tag is the payload
  data: [], // '*' is a record; 'schema' is a reserved top-level name
  schema: ['name', 'description', 'forkOf'], // fields + render: records → dropped
  // args + savedArgs + render: records → dropped
  component: ['name', 'description', 'library', 'category', 'componentKey', 'familyKey', 'version', 'forkOf', 'previewBg'],
  // inputs + steps + capabilities + limits: records → dropped
  action: ['name', 'description', 'actionKey', 'category', 'version', 'forkOf'],
  // inputs + result + trace: records → dropped
  'action-run': ['status', 'startedAt', 'durationMs', 'opsUsed', 'depthUsed', 'childActionsUsed', 'error'],
  save: [], // marker schema
  vote: ['optionIndex', 'voteKey'],
  folder: ['name', 'icon', 'description'],
  app: [
    'clientId',
    'name',
    'origins',
    'nativeRedirectUris',
    'subscriptionTier',
    'subscriptionTierVersionId',
    'subscriptionTierVersion',
    'storageAllowanceBytes',
    'storageAllowanceOverrideBytes',
    'storageUsedBytes',
    'userStorageAllowanceBytes',
    'storageAccountingVersion'
  ],
  'app-data': ['appId', 'key'], // value: record → dropped
  'subscription-tier': [
    'quotaKind',
    'tierId',
    'version',
    'status',
    'title',
    'tagline',
    'emoji',
    'bannerImageUrl',
    'sortOrder',
    'metered',
    'currency',
    'discountFormulaVersion',
    'sourceVersionId',
    'createdBy',
    'updatedBy',
    'publishedAt',
    'archivedAt'
  ], // pricing/inclusions/quotas: records → dropped
	subscription: [
		'quotaKind',
		'subjectType',
		'subjectId',
		'tier',
		'tierVersionId',
		'tierVersion',
		'note',
		'updatedBy',
		'storageUsedBytes',
		'storageAccountingVersion',
		'storageLedgerStatus',
		'storageReconciledAt'
	], // snapshots/overrides: records → dropped
  'app-storage': ['quotaKind', 'appId', 'usedBytes', 'storageAllowanceBytes'],
	'service-quota': ['quotaKind', 'quotaVersion', 'key', 'dayKey', 'dailyUsed', 'permitIds', 'releasedIds'], // policy + state records → dropped
	'migration-diagnostic': ['diagnosticVersion', 'migrationId', 'mode', 'status', 'outcome', 'summary', 'capturedAt'],
  'ci-repository': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-automation': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-feature': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-feature-stack': ['title', 'repository', 'autoDecideBranches', 'revision', 'status', 'archived', 'createdBy', 'updatedBy', 'lastDispatchId', 'lastRunAt'],
  'ci-feature-stack-entry': ['repository', 'revision', 'entryType', 'position', 'prNumber', 'branch'],
  'ci-branch': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-pull-request': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-workflow-run': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-deployment': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-preview': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-preview-policy': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-dispatch': ['provider', 'repository', 'externalId', 'entityKey', 'title', 'status', 'url', 'sourceUpdatedAt'],
  'ci-event': ['provider', 'repository', 'deliveryId', 'eventType', 'action', 'actor', 'statusFrom', 'statusTo', 'occurredAt'], // data: record → dropped
  friend: ['status', 'friendKey'],
  notification: ['type', 'actorId', 'actorName', 'postId', 'preview'],
  passkey: ['nickname', 'description', 'providerName', 'aaguid', 'deviceType', 'backedUp', 'transports', 'lastUsedAt', 'lastUsedOrigin', 'revokedAt'],
  'passkey-app-link': ['linkKey', 'appKey', 'appName', 'firstUsedAt', 'lastUsedAt', 'usageCount'],
  'account-link': ['linkKind', 'userId', 'targetId', 'role', 'createdBy'],
	'ai-connection': [
		'sourceType',
		'provider',
		'sourceId',
		'deviceId',
		'connectorId',
		'label',
		'connectors',
		'capabilities',
		'status',
		'readOnly',
		'lastSyncAt'
	],
  community: ['name', 'description'],
  'community-member': ['memberKey', 'role'],
  'community-invite': ['inviteCode', 'uses', 'maxUses', 'expiresAt', 'revoked'],
  'chat-section': ['name', 'order'],
  chat: ['name', 'topic', 'chatType', 'communityId', 'sectionId', 'channelVisibility', 'dmKey'],
  'chat-member': ['memberKey', 'role', 'nickname', 'state', 'requestOrigin', 'lastReadMessageId', 'lastReadAt', 'muted'],
  'chat-message': ['text', 'threadRootId', 'replyToId', 'editedAt', 'deletedAt', 'systemType'],
	device: ['deviceKey', 'name', 'platform', 'model', 'osVersion', 'appVersion', 'capabilities', 'pairedAt'],
	'device-state': ['deviceStateKey', 'revision', 'stateHash', 'snapshotHash', 'observedAt'], // state: record → dropped
	'device-connector': ['deviceConnectorKey', 'revision', 'connectorHash'], // connector: record → dropped
	'device-command': [
		'deviceCommandKey',
		'requestId',
		'kind',
		'requiresApproval',
		'approvalState',
		'status',
		'controlBytes',
		'inputTextHash',
		'inputRedactedAt',
		'expiresAt'
	], // input: record → dropped
	'device-command-event': [
		'deviceEventKey',
		'deviceControlEventScopeKey',
		'liveControlEventScopeKey',
		'retainedBytes',
		'liveEventSequenceKey',
		'liveEventHash',
		'liveActivityHash',
		'eventType',
		'resourceId',
		'revision',
		'expiresAt'
	], // payload: record → dropped
	'device-ai-live-state': ['deviceAiLiveStateKey', 'connectorId', 'sessionId', 'lastSequence', 'lastObservedAt'],
	'device-approval': ['deviceApprovalKey', 'commandId', 'requestId', 'kind', 'prompt', 'status'],
	'device-screen-session': ['deviceScreenKey', 'requestId', 'status', 'viewOnly', 'startedAt', 'endedAt'],
  'custom-emoji': ['name', 'emojiKey', 'image', 'animated'],
  follow: ['followKey'],
  user: ['username', 'ttid', 'displayName', 'bio', 'avatarUrl', 'bannerUrl'],
  theme: ['name'], // theme: record → dropped
  'feed-algorithm': ['name', 'emoji', 'parentId', 'eventCount', 'lastTrainedAt'], // weights: record → dropped
  waitlist: [] // marker schema — email lives in the secure root field
};

test('the builtin crystal-schema set matches the pinned projection table', () => {
  assert.deepEqual(crystalSchemas.map((schema) => schema.id).sort(), Object.keys(EXPECTED_PROJECTED_FIELDS).sort());
});

test('registered server-owned Things are protected from generic Thing CRUD', () => {
	assert.ok(PROTECTED_THINGTIME.includes('attachment'));
	assert.ok(PROTECTED_THINGTIME.includes('app'));
	assert.ok(PROTECTED_THINGTIME.includes('migration-diagnostic'));
	assert.ok(PROTECTED_THINGTIME.includes('moderationFlag'));
	assert.ok(PROTECTED_THINGTIME.includes('ci-pull-request'));
	assert.ok(PROTECTED_THINGTIME.includes('ci-preview-policy'));
	assert.ok(PROTECTED_THINGTIME.includes('ci-event'));
	assert.ok(PROTECTED_THINGTIME.includes('device'));
	assert.ok(PROTECTED_THINGTIME.includes('device-command'));
	assert.ok(PROTECTED_THINGTIME.includes('device-ai-live-state'));
	assert.equal(isProtectedThingtime(['app']), true);
	assert.equal(isProtectedThingtime(['attachment']), true);
	assert.equal(isProtectedThingtime(['migration-diagnostic']), true);
	assert.equal(isProtectedThingtime(['moderationFlag']), true);
	assert.equal(isProtectedThingtime(['ci-workflow-run']), true);
	assert.equal(isProtectedThingtime(['data', 'app']), true);
	assert.equal(isProtectedThingtime(['user']), true);
});

test('managed attachment, moderation, user, and emoji fields are closed server-owned root fields', () => {
	const root = thingtimeSchemas.find((schema) => schema.id === 'thing')!;
	const fields = new Map(root.fields.map((field) => [field.name, field]));
	for (const name of ['attachmentPurpose', 'attachmentProfileSlot', 'moderation', 'avatarAttachmentId', 'bannerAttachmentId', 'emojiAttachmentId']) {
		assert.equal(fields.get(name)?.system, true, name);
		assert.equal(fields.get(name)?.required, false, name);
	}
	assert.deepEqual(fields.get('attachmentPurpose')?.values, ['post', 'comment', 'message', 'profile', 'emoji']);
	assert.deepEqual(fields.get('attachmentProfileSlot')?.values, ['avatar', 'banner']);
});

test('attachment metadata is normalized but its Thingtime kind remains protected from generic CRUD', () => {
	const validated = validateThingtimeCrystal(['attachment'], {
		name: '  clip.MP4 ',
		size: 123,
		contentType: 'VIDEO/MP4',
		mediaKind: 'file'
	});
	assert.equal(validated.ok, true);
	if (validated.ok !== true) return;
	assert.deepEqual(validated.crystal, {
		name: 'clip.MP4',
		size: 123,
		contentType: 'video/mp4',
		mediaKind: 'video'
	});
	assert.equal(isProtectedThingtime(validated.thingtime), true);
});

test('post attachment preflight allows attachment-only posts without weakening ordinary post validation', () => {
  const emptyText = { type: 'text', text: '', images: [], listing: null, thing: null };
  assert.equal(validateThingtimeCrystal(['post'], emptyText).ok, false);
  assert.equal(
    validateThingtimeCrystal(['post'], emptyText, {
      postAttachments: { hasAny: true, hasVisual: false }
    }).ok,
    true
  );

  const emptyImage = { type: 'image', text: '', images: [], listing: null, thing: null };
  assert.equal(
    validateThingtimeCrystal(['post'], emptyImage, {
      postAttachments: { hasAny: true, hasVisual: false }
    }).ok,
    false
  );
  assert.equal(
    validateThingtimeCrystal(['post'], emptyImage, {
      postAttachments: { hasAny: true, hasVisual: true }
    }).ok,
    true
  );
});

test('server attachment preflight enables attachment-only rich comments', () => {
  const emptyComment = { type: 'text', text: '', images: [], listing: null, thing: null };
  assert.equal(
    validateThingtimeCrystal(['post', 'comment'], emptyComment, {
      postAttachments: { hasAny: true, hasVisual: true }
    }).ok,
		true
  );
});

test('post image URLs require parsed credential-free absolute http(s) URLs', () => {
	const validateImage = (url: string) =>
		validateThingtimeCrystal(['post'], {
			type: 'image',
			text: '',
			images: [url],
			listing: null,
			thing: null
		});
	assert.equal(validateImage('https://images.example/photo.jpg').ok, true);
	assert.equal(validateImage('http://localhost:9999/photo.jpg').ok, true);
	for (const unsafe of [
		'https://user:secret@images.example/photo.jpg',
		'https://images.example/a b.jpg',
		'https://images.example/a\u202Eb.jpg',
		'https:\\images.example\\photo.jpg',
		'https://',
		'//images.example/photo.jpg',
		'data:image/png;base64,AAAA',
		['java', 'script:alert(1)'].join('')
	]) {
		const result = validateImage(unsafe);
		assert.equal(result.ok, false, unsafe);
		if (!result.ok) assert.equal(result.error, 'Images must be http(s) URLs');
	}
});

for (const schema of crystalSchemas) {
  test(`builtin '${schema.id}' projects and validates through the schema-thing write gate`, () => {
    const projected = projectBuiltinSchemaCrystal(schema);
    const validated = validateThingtimeCrystal(['schema'], projected);
    assert.equal(validated.ok, true, `expected ok, got: ${JSON.stringify(validated)}`);
    if (validated.ok !== true) return;

    assert.deepEqual(validated.thingtime, ['schema']);
    assert.equal(validated.crystal.name, schema.title);
    assert.deepEqual(fieldNames(validated.crystal), EXPECTED_PROJECTED_FIELDS[schema.id]);

    // Normalization is a fixed point: re-validating the stored crystal must
    // reproduce it exactly, or the migration's drift comparison (stored vs
    // freshly validated projection) would refresh forever.
    const revalidated = validateThingtimeCrystal(['schema'], validated.crystal);
    assert.equal(revalidated.ok, true);
    if (revalidated.ok === true) assert.deepEqual(revalidated.crystal, validated.crystal);
  });
}

test("post.listing carries sanitizePostCrystal's real shape, not an opaque object", () => {
  const projected = projectBuiltinSchemaCrystal(crystalSchemas.find((schema) => schema.id === 'post')!);
  const validated = validateThingtimeCrystal(['schema'], projected);
  assert.equal(validated.ok, true);
  if (validated.ok !== true) return;

  const listing = (validated.crystal.fields as Array<Record<string, any>>).find((field) => field.name === 'listing')!;
  assert.equal(listing.type, 'object');
  assert.deepEqual(
    listing.children.map((child: { name: string }) => child.name),
    ['title', 'price', 'currency', 'category', 'condition', 'location', 'sold']
  );
  const byName = Object.fromEntries(listing.children.map((child: { name: string }) => [child.name, child]));
  assert.equal(byName.title.required, true);
  assert.equal(byName.title.maxLength, 120);
  assert.equal(byName.price.required, true);
  assert.equal(byName.price.min, 0);
  assert.equal(byName.price.max, 1_000_000_000);
  assert.deepEqual(byName.condition.values, ['new', 'used']);
});

test('id fields project as string (ids are strings on the wire)', () => {
  const projected = projectBuiltinSchemaCrystal(crystalSchemas.find((schema) => schema.id === 'app')!);
  const clientId = (projected.fields as Array<Record<string, any>>).find((field) => field.name === 'clientId')!;
  assert.equal(clientId.type, 'string');
});

test('non-default max units never project (reaction max counts emoji, not chars)', () => {
  const projected = projectBuiltinSchemaCrystal(crystalSchemas.find((schema) => schema.id === 'reaction')!);
  const emoji = (projected.fields as Array<Record<string, any>>).find((field) => field.name === 'emoji')!;
  // a maxLength of 12 UTF-16 chars would reject legal 7-emoji tokens (14+ units)
  assert.equal(emoji.maxLength, undefined);
});

// The grammar changes that make marker builtins seedable are user-facing too —
// pin both sides so the intent can't silently regress.
test('zero-field marker schemas are valid at the top level, but childless objects still fail', () => {
  const marker = validateThingtimeCrystal(['schema'], { name: 'Marker', description: '', fields: [] });
  assert.equal(marker.ok, true);

  const childless = validateThingtimeCrystal(['schema'], {
    name: 'Broken',
    fields: [{ name: 'shape', type: 'object', children: [] }]
  });
  assert.equal(childless.ok, false);
});
