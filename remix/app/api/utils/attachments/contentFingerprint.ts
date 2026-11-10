import { createHash } from 'node:crypto';
import { contentPartPlan, EMPTY_CONTENT_SHA256, type ContentFingerprint } from '../../../fileSync/contentFingerprint';
import type { AttachmentObjectHead } from './privateS3';

/** Only an exact-version, size/attachment-identity-verified storage HEAD may
 * enter this function. Never accept a client-provided checksum as evidence. */
export function fingerprintFromVerifiedHead(head: AttachmentObjectHead): ContentFingerprint | null {
    if (head.sizeBytes === 0) {
        if (head.checksumType !== 'FULL_OBJECT' || head.checksumSha256 !== Buffer.from(EMPTY_CONTENT_SHA256, 'hex').toString('base64')) return null;
        return { algorithm: 'sha256-parts-v1', ...contentPartPlan(0), sha256: EMPTY_CONTENT_SHA256 };
    }
	if (head.checksumType !== 'COMPOSITE' || typeof head.checksumSha256 !== 'string') return null;
	const match = /^([A-Za-z0-9+/]{43}=)-([1-9][0-9]{0,4})$/.exec(head.checksumSha256);
	if (!match) return null;
	const digest = Buffer.from(match[1], 'base64');
	if (digest.length !== 32 || digest.toString('base64') !== match[1]) return null;
	try {
		const plan = contentPartPlan(head.sizeBytes);
		if (Number(match[2]) !== plan.partCount) return null;
		return { algorithm: 'sha256-parts-v1', ...plan, sha256: digest.toString('hex') };
	} catch { return null; }
}

export const attachmentContentVersion = (id: string, objectKey: string, versionId: string): string => createHash('sha256').update('thingtime-file-content-v1\0').update(id).update('\0').update(objectKey).update('\0').update(versionId).digest('hex');
