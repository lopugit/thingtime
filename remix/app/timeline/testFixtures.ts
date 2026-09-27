import type { TimelineEvent, TimelineEntry } from './contract.ts';

export const eventFixture = (id = 'event-1', overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
	formatVersion: 1, id, ownerId: 'user-1', thingId: 'page-1', branchId: 'main', parentIds: [], operationId: `operation-${id}`,
	actorId: 'user-1', source: 'client', clientId: 'browser-1', occurredAt: '2026-09-27T05:00:00.000Z', mode: 'draft', operation: 'create',
	label: 'Add page', before: null, after: { adapter: 'thing', version: 1, value: { title: 'Hello', blocks: [] } }, dependencies: [], ...overrides
});

export const entryFixture = (event: TimelineEvent, position = 1): TimelineEntry => ({ event, receipt: { formatVersion: 1, eventId: event.id, ownerId: event.ownerId, position, acceptedAt: '2026-09-27T05:01:00.000Z' } });
