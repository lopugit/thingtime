import { randomUUID } from 'node:crypto';
import { eventFixture, entryFixture } from '../../../timeline/testFixtures';
import { splitTimelineEvent } from '../../../timeline/records';
import { timelineBranchHeadId } from '../../../timeline/branches';
import { timelineSnapshotPartId } from '../../../timeline/snapshotParts';
import { packTimelineEntry, packTimelineLink } from '../timeline/envelope';
import { timelineEventThingId, timelineLinkThingId, timelineLinkTargetKey } from '../timeline/repository';
import { timelineBranchThingId, timelineBranchHeadThingId, packTimelineBranchRecord } from '../timeline/branchEnvelope';
import { splitLargeThingSnapshot, timelineSnapshotPartThingId } from '../timeline/snapshotParts';
import { timelineNoteThingId, packTimelineNote } from '../timeline/notes';
import { timelineVersionNameThingId, packTimelineVersionName } from '../timeline/versionNames';
import { thingContentSnapshot } from '../timeline/recordMutation';
import { toBin } from '../auth/binary';

export function timelineBackupFixture(ownerId = 'owner') {
	const time = '2026-10-18T00:00:00.000Z',
		now = new Date(time),
		position = now.getTime();
	const content = thingContentSnapshot({ thingtime: ['data'], crystal: { text: 'preserved '.repeat(40_000) } })!;
	const big = thingContentSnapshot({ thingtime: ['data'], crystal: { text: '🥰'.repeat(600_000) } })!;
	const parts = splitLargeThingSnapshot(big, ownerId, 'event-two', 'after');
	const events = [
		eventFixture('event-one', { ownerId, actorId: ownerId, source: 'api', mode: 'revision', clientId: null, after: content }),
		eventFixture('event-two', {
			ownerId,
			actorId: ownerId,
			source: 'api',
			mode: 'revision',
			clientId: null,
			operation: 'update',
			parentIds: ['event-one'],
			before: content,
			after: parts.snapshot
		})
	];
	const common = { ownerId, createdAt: now, updatedAt: now, tokenAcl: 'NEVER_EXPORT', linkKey: 'NEVER_EXPORT' };
	const docs: any[] = [];
	for (const [index, event] of events.entries()) {
		const entry = entryFixture(event, position + index),
			shareId = timelineEventThingId(ownerId, event.id);
		docs.push({
			...common,
			shareId,
			thingtime: ['timeline-event'],
			targetId: event.thingId,
			createdAt: new Date(entry.receipt.position),
			...packTimelineEntry(entry)
		});
		for (const link of splitTimelineEvent(event).links)
			docs.push({
				...common,
				shareId: timelineLinkThingId(ownerId, link.id),
				thingtime: ['timeline-link'],
				targetId: shareId,
				crystal: { targetId: timelineLinkTargetKey(link), linkKind: link.relation },
				...packTimelineLink(link)
			});
	}
	for (const part of parts.parts)
		docs.push({
			...common,
			shareId: timelineSnapshotPartThingId(ownerId, part.id),
			thingtime: ['timeline-snapshot-part'],
			parentId: timelineEventThingId(ownerId, part.eventId),
			targetId: timelineEventThingId(ownerId, part.eventId),
			timelineSnapshotPartVersion: 1,
			secure: toBin(JSON.stringify(part))
		});
	const branch = { formatVersion: 1 as const, id: 'main', ownerId, name: 'Published', createdAt: time };
	docs.push({
		...common,
		shareId: timelineBranchThingId(ownerId, 'main'),
		thingtime: ['timeline-branch'],
		crystal: { name: branch.name },
		...packTimelineBranchRecord(branch)
	});
	const head = {
		formatVersion: 1 as const,
		id: timelineBranchHeadId('main', 'page-1'),
		ownerId,
		branchId: 'main',
		thingId: 'page-1',
		eventId: 'event-two',
		revision: 2,
		createdAt: time,
		updatedAt: time
	};
	docs.push({
		...common,
		shareId: timelineBranchHeadThingId(ownerId, 'main', 'page-1'),
		thingtime: ['timeline-branch-head'],
		parentId: timelineBranchThingId(ownerId, 'main'),
		targetId: 'page-1',
		branchRevision: 2,
		...packTimelineBranchRecord(head)
	});
	const note = {
		formatVersion: 1 as const,
		id: 'note-' + randomUUID(),
		ownerId,
		eventId: 'event-two',
		thingId: 'page-1',
		author: 'owner' as const,
		text: 'Keep this version',
		createdAt: time
	};
	const targetId = timelineEventThingId(ownerId, 'event-two');
	docs.push({
		...common,
		shareId: timelineNoteThingId(ownerId, note.id),
		thingtime: ['timeline-note'],
		targetId,
		crystal: { name: 'Note', targetId, linkKind: 'timeline-note' },
		...packTimelineNote(note)
	});
	const name = {
		formatVersion: 1 as const,
		id: 'event-two/name',
		ownerId,
		eventId: 'event-two',
		thingId: 'page-1',
		name: 'Saved version',
		revision: 1,
		createdAt: time,
		updatedAt: time
	};
	docs.push({
		...common,
		shareId: timelineVersionNameThingId(ownerId, 'event-two'),
		thingtime: ['timeline-version-name'],
		targetId,
		crystal: { name: 'Version name', targetId, linkKind: 'timeline-version-name' },
		nameRevision: 1,
		...packTimelineVersionName(name)
	});
	const clearedTarget = timelineEventThingId(ownerId, 'event-one');
	docs.push({
		...common,
		shareId: timelineVersionNameThingId(ownerId, 'event-one'),
		thingtime: ['timeline-version-name'],
		targetId: clearedTarget,
		crystal: { name: 'Version name', targetId: clearedTarget, linkKind: 'timeline-version-name' },
		nameRevision: 2,
		timelineVersionNameCleared: true
	});
	const legacy = entryFixture(eventFixture('legacy', { ownerId, actorId: ownerId }), position + 2);
	docs.push({
		...common,
		shareId: timelineEventThingId(ownerId, 'legacy'),
		thingtime: ['timeline-event'],
		targetId: legacy.event.thingId,
		createdAt: new Date(legacy.receipt.position),
		timelineEnvelopeVersion: 1,
		secure: toBin(JSON.stringify(legacy))
	});
	return {
		docs,
		events,
		parts: parts.parts,
		big,
		firstPartId: timelineSnapshotPartThingId(ownerId, timelineSnapshotPartId('event-two', 'after', 0))
	};
}
