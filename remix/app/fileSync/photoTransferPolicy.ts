import { capabilitySatisfies } from '~/api/utils/capabilities/capabilityContract';
import type { FolderCapabilities } from './mobileFolders.client';
export const supportsNativeUploadPolicy = (capabilities?: { platform?: string; fileUploadPolicyVersion?: string; filePhotoAutomationVersion?: string; fileResourceLimitsVersion?: string }) =>
 capabilities?.platform === 'ios' && capabilitySatisfies(capabilities.fileUploadPolicyVersion ?? '', '1.1.0');
export type PhotoTransferPolicy = { uploadBytesPerSecond?: number; uploadBytesPerHour?: number };
export const supportsNativePhotoTransferPolicy = (capabilities?: FolderCapabilities) =>
 capabilities?.platform === 'ios' && capabilitySatisfies(capabilities.filePhotoAutomationVersion ?? '', '1.6.0');
export function parsePhotoTransferPolicy(value: unknown): PhotoTransferPolicy {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'uploadBytesPerSecond' && key !== 'uploadBytesPerHour'))
  throw Error('The device returned an invalid Photos transfer policy.');
 const policy: PhotoTransferPolicy = {};
 for (const key of ['uploadBytesPerSecond', 'uploadBytesPerHour'] as const) {
  const n = (value as PhotoTransferPolicy)[key];
  if (n !== undefined) {
   if (!Number.isSafeInteger(n) || n <= 0) throw Error('Photos transfer limits must be positive whole bytes.');
   policy[key] = n;
  }
 }
 return policy;
}
/** This is a display projection. Native admission also enforces shared usage. */
export function effectivePhotoTransferPolicy(...policies: Array<PhotoTransferPolicy | undefined>): PhotoTransferPolicy {
 const result: PhotoTransferPolicy = {};
 for (const key of ['uploadBytesPerSecond', 'uploadBytesPerHour'] as const) {
  const values = policies.flatMap(policy => policy?.[key] === undefined ? [] : [policy[key]!]);
  if (values.length) result[key] = Math.min(...values);
 }
 return result;
}
