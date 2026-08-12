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
  post: ['type', 'text', 'images', 'listing'], // thing: record → dropped
  comment: ['text'],
  reaction: ['emoji'],
  share: [], // marker schema — the thingtime tag is the payload
  data: [], // '*' is a record; 'schema' is a reserved top-level name
  schema: ['name', 'description', 'forkOf'], // fields + render: records → dropped
  save: [], // marker schema
  app: [
    'clientId',
    'name',
    'origins',
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
  follow: ['follow'],
  friend: ['status', 'friendKey'],
  notification: ['type', 'actorId', 'actorName', 'postId', 'preview'],
  'account-link': ['linkKind', 'userId', 'targetId', 'role', 'createdBy'],
  user: ['username', 'ttid', 'displayName', 'bio', 'avatarUrl', 'bannerUrl'],
  theme: ['name'], // theme: record → dropped
  'feed-algorithm': ['name', 'emoji', 'parentId', 'eventCount', 'lastTrainedAt'], // weights: record → dropped
  waitlist: [] // marker schema — email lives in the secure root field
};

test('the builtin crystal-schema set matches the pinned projection table', () => {
  assert.deepEqual(crystalSchemas.map((schema) => schema.id).sort(), Object.keys(EXPECTED_PROJECTED_FIELDS).sort());
});

test('registered app control Things are protected from generic Thing CRUD', () => {
	assert.ok(PROTECTED_THINGTIME.includes('app'));
	assert.ok(PROTECTED_THINGTIME.includes('migration-diagnostic'));
	assert.equal(isProtectedThingtime(['app']), true);
	assert.equal(isProtectedThingtime(['migration-diagnostic']), true);
	assert.equal(isProtectedThingtime(['data', 'app']), true);
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
