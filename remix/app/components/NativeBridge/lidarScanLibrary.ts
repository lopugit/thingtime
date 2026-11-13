import type { ThingsThing } from '../Things/thingsCore';
import type { ThingContextMenuModel } from '../Thingtime/ContextMenu/contextMenuModel';
import type { LidarScanItem } from './lidarScanBridge';
import { formatAttachmentBytes } from '../Attachments/attachmentUiCore';

export function lidarScanThing(scan: LidarScanItem, ownerId: string): ThingsThing {
	const placement = scan.fileThingId ? 'Cloud' : scan.deviceSaved ? 'Device only' : 'Not saved to Thingtime';
	return {
		id: scan.scanId, thingtime: ['file'], author: { id: ownerId, username: '', displayName: null, avatarUrl: null },
		visibility: 'private', acl: [], targetId: null, folderId: null, extended: null,
		createdAt: scan.createdAt, updatedAt: scan.createdAt, libraryArchivePresentation: 'metadata',
		tags: [placement, formatAttachmentBytes(scan.byteCount), ...(scan.isPartial ? ['Partial'] : [])],
		crystal: { name: `LiDAR scan · ${new Date(scan.createdAt).toLocaleString()}`, size: scan.byteCount,
			contentType: 'application/x-tar', placement, scanId: scan.scanId }
	};
}

export function lidarSaveMenu(scan: LidarScanItem, busy: boolean, choicesOnly = false): ThingContextMenuModel {
	const choices = [{ id: 'lidar-save-choices', actions: [
		{ id: 'device', command: 'lidar-device', label: 'Device only', icon: '📱', lucide: 'smartphone',
			hint: 'Keep the scan and its Thing on this device. Nothing is uploaded.', disabled: busy || !scan.available || scan.deviceSaved || !!scan.fileThingId },
		{ id: 'cloud', command: 'lidar-cloud', label: 'Cloud', icon: '☁️', lucide: 'cloud-upload',
			hint: 'Upload a private copy to your Thingtime account. Keep the device original.', disabled: busy || !scan.available || !!scan.fileThingId }
	] }];
	return { sections: choicesOnly ? choices : [{ id: 'scan', actions: [
		{ id: 'save', label: 'Save to Thingtime', icon: '💾', lucide: 'save', submenu: { title: 'Save to Thingtime', sections: choices } },
		...(scan.fileThingId ? [{ id: 'open', command: 'open', label: 'Open saved scan', icon: '↗', lucide: 'external-link', href: `/thing/${encodeURIComponent(scan.fileThingId)}?from=things` }] : [])
	] }] };
}
