import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConditionRow } from '../Search/searchTypes.ts';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  adminFilterValueForOperatorChange,
  applyAdminRowQuery,
  createAdminRowQuery,
  filterAdminRows,
  readAdminRowFieldValues,
  sortAdminRows,
  type AdminRowField
} from './adminRowQuery.ts';

type FixtureRow = {
  id: string;
  username: string;
  createdAt: string | null;
  subscription: { tier: 'free' | 'plus' | 'pro' };
  counts: { apps: number };
  isAdmin: boolean;
  origins: string[];
  managers: Array<{ username: string }>;
};

const rows: FixtureRow[] = [
  {
    id: 'a',
    username: 'alpha',
    createdAt: '2026-08-04T23:59:59.999Z',
    subscription: { tier: 'free' },
    counts: { apps: 2 },
    isAdmin: false,
    origins: ['https://alpha.example'],
    managers: [{ username: 'mira' }]
  },
  {
    id: 'b',
    username: 'beta',
    createdAt: '2026-08-05T00:00:00.000Z',
    subscription: { tier: 'plus' },
    counts: { apps: 12 },
    isAdmin: true,
    origins: ['https://beta.example'],
    managers: [{ username: 'rhea' }]
  },
  {
    id: 'c',
    username: 'charlie',
    createdAt: '2026-08-05T23:59:59.999Z',
    subscription: { tier: 'pro' },
    counts: { apps: 4 },
    isAdmin: true,
    origins: ['https://charlie.example'],
    managers: [{ username: 'mira' }]
  },
  {
    id: 'd',
    username: 'delta',
    createdAt: '2026-08-06T08:30:00.000Z',
    subscription: { tier: 'plus' },
    counts: { apps: 4 },
    isAdmin: false,
    origins: ['https://gamma.example', 'https://secondary.example'],
    managers: [{ username: 'kai' }, { username: 'noa' }]
  },
  {
    id: 'e',
    username: 'empty',
    createdAt: null,
    subscription: { tier: 'free' },
    counts: { apps: 0 },
    isAdmin: false,
    origins: [],
    managers: []
  }
];

const fields: AdminRowField<FixtureRow>[] = [
  { id: 'username', label: 'Username', kind: 'string' },
  { id: 'createdAt', label: 'Created', kind: 'date' },
  {
    id: 'tier',
    label: 'Tier',
    kind: 'enum',
    path: 'subscription.tier',
    options: [
      { value: 'free', label: 'Free' },
      { value: 'plus', label: 'Plus' },
      { value: 'pro', label: 'Pro' }
    ]
  },
  { id: 'apps', label: 'Apps', kind: 'number', path: 'counts.apps' },
  { id: 'isAdmin', label: 'Admin', kind: 'boolean' },
  { id: 'origins', label: 'Origins', kind: 'string' },
  { id: 'manager', label: 'Manager', kind: 'string', path: 'managers.username' }
];

const condition = (field: string, op: string, value = '', value2 = ''): ConditionRow => ({
  id: `${field}-${op}-${value}-${value2}`,
  field,
  op,
  value,
  value2,
  valueType: 'auto'
});

const ids = (selected: readonly FixtureRow[]) => selected.map((row) => row.id);

test('date filters treat a YYYY-MM-DD value as the complete locally displayed created day', () => {
  const localRows: FixtureRow[] = [
    { ...rows[0], createdAt: new Date(2026, 7, 4, 23, 59, 59, 999).toISOString() },
    { ...rows[1], createdAt: new Date(2026, 7, 5, 0, 0, 0, 0).toISOString() },
    { ...rows[2], createdAt: new Date(2026, 7, 5, 23, 59, 59, 999).toISOString() },
    { ...rows[3], createdAt: new Date(2026, 7, 6, 8, 30, 0, 0).toISOString() },
    rows[4]
  ];
  assert.deepEqual(
    ids(filterAdminRows(localRows, fields, { search: '', filters: [condition('createdAt', 'eq', '2026-08-05')] })),
    ['b', 'c']
  );
  assert.deepEqual(
    ids(filterAdminRows(localRows, fields, { search: '', filters: [condition('createdAt', 'gt', '2026-08-05')] })),
    ['d']
  );
  assert.deepEqual(
    ids(filterAdminRows(localRows, fields, { search: '', filters: [condition('createdAt', 'between', '2026-08-05', '2026-08-06')] })),
    ['b', 'c', 'd']
  );
  assert.deepEqual(
    ids(filterAdminRows(localRows, fields, { search: '', filters: [condition('createdAt', 'between', 'not-a-date', '2026-08-06')] })),
    []
  );
});

test('switching a boolean filter away from exists keeps its visible true value active', () => {
  for (const nextOp of ['eq', 'ne']) {
    const value = adminFilterValueForOperatorChange('boolean', 'exists', nextOp, 'false');
    assert.equal(value, 'true');
    assert.deepEqual(
      ids(filterAdminRows(rows, fields, { search: '', filters: [condition('isAdmin', nextOp, value)] })),
      nextOp === 'eq' ? ['b', 'c'] : ['a', 'd', 'e']
    );
  }
  assert.equal(adminFilterValueForOperatorChange('string', 'exists', 'eq', 'true'), '');
});

test('enum tier filters use stable values and multiple clauses are ANDed', () => {
  const query = createAdminRowQuery();
  query.filters = [
    condition('tier', 'eq', 'plus'),
    condition('apps', 'gte', '4'),
    condition('isAdmin', 'eq', 'false')
  ];
  assert.deepEqual(ids(filterAdminRows(rows, fields, query)), ['d']);
});

test('numeric filters compare numbers instead of their string representations', () => {
  assert.deepEqual(
    ids(filterAdminRows(rows, fields, { search: '', filters: [condition('apps', 'between', '3', '10')] })),
    ['c', 'd']
  );
  assert.deepEqual(
    ids(filterAdminRows(rows, fields, { search: '', filters: [condition('apps', 'gt', '9')] })),
    ['b']
  );
  assert.deepEqual(
    ids(filterAdminRows(rows, fields, { search: '', filters: [condition('apps', 'between', 'not-a-number', '10')] })),
    []
  );
  assert.deepEqual(
    ids(filterAdminRows(rows, fields, { search: '', filters: [condition('apps', 'in', '2, 12')] })),
    ['a', 'b']
  );
  assert.deepEqual(
    ids(filterAdminRows(rows, fields, { search: '', filters: [condition('apps', 'nin', '2, 12')] })),
    ['c', 'd', 'e']
  );
});

test('boolean filters preserve false as a real typed value', () => {
  assert.deepEqual(
    ids(filterAdminRows(rows, fields, { search: '', filters: [condition('isAdmin', 'eq', 'false')] })),
    ['a', 'd', 'e']
  );
  assert.deepEqual(
    ids(filterAdminRows(rows, fields, { search: '', filters: [condition('isAdmin', 'ne', 'true')] })),
    ['a', 'd', 'e']
  );
});

test('exists follows path presence, so null is present and a missing property is absent', () => {
  const missingCreatedAt = {
    id: 'missing-created-at',
    username: 'missing',
    subscription: { tier: 'free' as const },
    counts: { apps: 0 },
    isAdmin: false,
    origins: [],
    managers: []
  } as FixtureRow;
  const candidates = [rows[4], missingCreatedAt];

  assert.deepEqual(
    ids(filterAdminRows(candidates, fields, { search: '', filters: [condition('createdAt', 'exists', 'true')] })),
    ['e']
  );
  assert.deepEqual(
    ids(filterAdminRows(candidates, fields, { search: '', filters: [condition('createdAt', 'exists', 'false')] })),
    ['missing-created-at']
  );
  assert.deepEqual(
    ids(filterAdminRows([rows[4]], fields, { search: '', filters: [condition('origins', 'exists', 'true')] })),
    ['e']
  );
  assert.deepEqual(
    ids(filterAdminRows([rows[4]], fields, { search: '', filters: [condition('manager', 'exists', 'false')] })),
    ['e']
  );
});

test('nested and list paths flatten for both typed filters and free-text search', () => {
  const managerField = fields.find((field) => field.id === 'manager');
  assert.ok(managerField);
  assert.deepEqual(readAdminRowFieldValues(rows[3], managerField), ['kai', 'noa']);

  assert.deepEqual(
    ids(
      filterAdminRows(rows, fields, {
        search: 'gamma kai',
        filters: [condition('origins', 'contains', 'secondary.example')]
      })
    ),
    ['d']
  );
  assert.deepEqual(
    ids(filterAdminRows(rows, fields, { search: '', filters: [condition('manager', 'eq', 'mira')] })),
    ['a', 'c']
  );
});

test('sorts are deterministic, use row ids for ties, and leave missing values last', () => {
  const reversed = [...rows].reverse();
  const ascending = { field: 'apps', direction: 'asc' } as const;
  const descending = { field: 'apps', direction: 'desc' } as const;
  assert.deepEqual(ids(sortAdminRows(rows, fields, ascending, (row) => row.id)), ['e', 'a', 'c', 'd', 'b']);
  assert.deepEqual(ids(sortAdminRows(reversed, fields, ascending, (row) => row.id)), ['e', 'a', 'c', 'd', 'b']);
  assert.deepEqual(ids(sortAdminRows(rows, fields, descending, (row) => row.id)), ['b', 'c', 'd', 'a', 'e']);

  const byCreated = applyAdminRowQuery(
    rows,
    fields,
    { search: '', filters: [], sort: { field: 'createdAt', direction: 'desc' } },
    (row) => row.id
  );
  assert.deepEqual(ids(byCreated), ['d', 'c', 'b', 'a', 'e']);
});
