import { attachmentContentPath } from './attachmentContentUrl';

export type ProfileMediaSlot = 'avatar' | 'banner';

const fieldValue = (record: any, field: string): unknown => {
	if (record && Object.prototype.hasOwnProperty.call(record, field)) return record[field];
	return record?.crystal?.[field];
};

export const profileAttachmentIdFromRecord = (record: any, slot: ProfileMediaSlot): string | null => {
	const value = fieldValue(record, `${slot}AttachmentId`);
	return typeof value === 'string' && value ? value : null;
};

// The linked URL is the user-authored fallback stored in the public profile
// crystal (or on a legacy user). Managed attachment paths are never persisted
// into this field, so editors can switch away from managed media without
// losing the underlying external URL.
export const linkedProfileMediaUrl = (record: any, slot: ProfileMediaSlot): string | null => {
	const value = fieldValue(record, `${slot}Url`);
	return typeof value === 'string' ? value : null;
};

export const effectiveProfileMediaUrl = (record: any, slot: ProfileMediaSlot): string | null => {
	const attachmentId = profileAttachmentIdFromRecord(record, slot);
	return attachmentId ? attachmentContentPath(attachmentId) : linkedProfileMediaUrl(record, slot);
};

// Browser projections intentionally use a same-origin relative managed path.
// Third-party OAuth/app-data consumers need that one server-owned path made
// absolute against Thingtime's canonical issuer, while already-absolute
// external links (and legacy data:image values) retain their exact spelling.
export const absoluteThirdPartyProfileMediaUrl = (value: string | null | undefined, canonicalBaseUrl: string): string | null => {
	if (typeof value !== 'string' || !value) return null;
	if (!value.startsWith('/api/v1/attachments/content?')) {
		if (/^data:image\//i.test(value)) return value;
		if (/[\p{Cc}\p{Cf}\p{Cs}\s]/u.test(value) || value.includes('\\')) return null;
		try {
			const external = new URL(value);
			return (external.protocol === 'http:' || external.protocol === 'https:') && !!external.hostname && !external.username && !external.password
				? value
				: null;
		} catch {
			return null;
		}
	}
	try {
		const base = new URL(canonicalBaseUrl);
		if ((base.protocol !== 'http:' && base.protocol !== 'https:') || !base.hostname || base.username || base.password) return null;
		return new URL(value, `${base.origin}/`).toString();
	} catch {
		return null;
	}
};
