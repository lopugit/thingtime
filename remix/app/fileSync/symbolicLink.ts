import { fingerprintSource, type ContentFingerprint } from './contentFingerprint';

/** Inert POSIX readlink bytes. Never resolve, normalize or fetch this target. */
export type SymbolicLink = { format: 'posix-symlink-v1'; targetBase64: string };
export function symbolicLinkBytes(value: unknown): Uint8Array<ArrayBuffer> {
 const link = value as SymbolicLink;
 if (!link || typeof link !== 'object' || Array.isArray(link) || Object.keys(link).length !== 2 || Object.keys(link).some(key => !['format', 'targetBase64'].includes(key)) || link.format !== 'posix-symlink-v1' || typeof link.targetBase64 !== 'string' || !link.targetBase64) throw Error('Invalid symbolic link metadata.');
 let binary: string;
 try { binary = atob(link.targetBase64); } catch { throw Error('Invalid symbolic link target encoding.'); }
 if (!binary.length || binary.includes('\0') || btoa(binary) !== link.targetBase64) throw Error('Invalid symbolic link target encoding.');
 return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export function parseSymbolicLink(value: unknown): SymbolicLink {
 symbolicLinkBytes(value); const link = value as SymbolicLink;
 return { format: link.format, targetBase64: link.targetBase64 };
}
export function validSymbolicLink(value: unknown, size: number): value is SymbolicLink {
 try { return symbolicLinkBytes(value).byteLength === size; } catch { return false; }
}
export const sameSymbolicLink = (a: SymbolicLink | undefined, b: SymbolicLink | undefined): boolean => a === undefined || b === undefined ? a === b : a.format === b.format && a.targetBase64 === b.targetBase64;
export function symbolicLinkFingerprint(value: unknown): Promise<ContentFingerprint> {
 const bytes = symbolicLinkBytes(value);
 return fingerprintSource({ size: bytes.byteLength, read: async (offset, length) => bytes.slice(offset, offset + length), check() {} });
}
