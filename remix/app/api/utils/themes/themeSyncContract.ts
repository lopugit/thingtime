import { validOptionalLibraryTitle } from '../../../utils/libraryTitle';
import { copyBoundedJson } from '../../../utils/boundedJson';
import { normalizeSavedTheme } from '../../../theme/savedTheme';
import type { TtTheme } from '../../../theme/tokens';

export const THEME_SYNC_MAX_BYTES = 64 * 1024;
export const THEME_VERSION_PREFIX = 'theme-state-v1:';
export const validThemeVersion = (value: unknown): value is string => typeof value === 'string' && /^theme-state-v1:[a-f0-9]{64}$/.test(value);
const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const fail = (): never => {
	throw new Error('Invalid theme synchronization command.');
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const focusColors = ['focusBorder', 'focusGlowStart', 'focusGlowEnd'] as const;
const focusGeneral = ['focusGlowBlur', 'focusGlowOpacity'] as const;
type FocusColor = typeof focusColors[number];
type FocusGeneral = typeof focusGeneral[number];
/** Frozen commands can predate focus tokens. Missing fields remain absent;
 * ordinary saved-theme writers may apply current defaults after admission. */
export type ThemeWriteTheme = Omit<TtTheme, 'colors' | 'general'> & {
	colors: Omit<TtTheme['colors'], FocusColor> & Partial<Pick<TtTheme['colors'], FocusColor>>;
	general: Omit<TtTheme['general'], FocusGeneral> & Partial<Pick<TtTheme['general'], FocusGeneral>>;
};
export type ThemeWrite = { id: string; writeId: string; expectedVersion: string | null } & (
	| { action: 'save'; name: string; theme: ThemeWriteTheme; visibility: 'private' | 'public'; folderId?: string | null; title?: string | null }
	| { action: 'delete'; expectedVersion: string }
);
export type ThemeWriteAcknowledgment = {
	id: string;
	writeId: string;
	action: 'save' | 'delete';
	expectedVersion: string | null;
	resultVersion: string | null;
};

/** Shared lossless JSON boundary before canonical token normalization. IDs are
 * operation identities only; they grant no ownership or publication authority. */
export function parseThemeWrite(input: unknown): ThemeWrite {
	const value = copyBoundedJson(input, { maxBytes: THEME_SYNC_MAX_BYTES, maxDepth: 10, maxNodes: 4096, sortKeys: true });
	if (
		!object(value) ||
		!identity(value.id) ||
		!identity(value.writeId) ||
		value.writeId.length > 160 ||
		value.id.startsWith('timeline-') ||
		(value.expectedVersion !== null && !validThemeVersion(value.expectedVersion))
	)
		return fail();
	// New identities cannot occupy reserved system namespaces; updates still accept historical stored IDs.
	if (value.expectedVersion === null && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.id)) return fail();
	const base = { id: value.id, writeId: value.writeId, expectedVersion: value.expectedVersion as string | null };
	if (value.action === 'delete') {
		if (value.expectedVersion === null || Object.keys(value).some((key) => !['id', 'writeId', 'expectedVersion', 'action'].includes(key)))
			return fail();
		return { ...base, expectedVersion: value.expectedVersion as string, action: 'delete' };
	}
	if (
		value.action !== 'save' ||
		!['private', 'public'].includes(String(value.visibility)) ||
		Object.keys(value).some((key) => !['id', 'writeId', 'expectedVersion', 'action', 'name', 'theme', 'visibility', 'folderId', 'title'].includes(key)) ||
		('title' in value && !validOptionalLibraryTitle(value.title)) ||
		('folderId' in value &&
			value.folderId !== null &&
			(!identity(value.folderId) || value.folderId === value.id || value.folderId.startsWith('timeline-')))
	)
		return fail();
	const normalized = normalizeSavedTheme({ name: value.name, theme: value.theme });
	if (!normalized.ok) return fail();
	// Receipts hash this canonical command with the existing v1 algorithm.
	// Do not grow a frozen pre-upgrade request by injecting newly added defaults,
	// including when transport/server validation reparses an already queued command.
	// Explicit fields are retained, even when equal to a current default: their
	// presence is different request content and cannot replay an older receipt.
	const source = object(value.theme) ? value.theme : {};
	const colors = object(source.colors) ? source.colors : {};
	const general = object(source.general) ? source.general : {};
	const theme: ThemeWriteTheme = { ...normalized.theme, colors: { ...normalized.theme.colors }, general: { ...normalized.theme.general } };
	for (const key of focusColors) if (!Object.prototype.hasOwnProperty.call(colors, key)) delete theme.colors[key];
	for (const key of focusGeneral) if (!Object.prototype.hasOwnProperty.call(general, key)) delete theme.general[key];
	return {
		...base,
		action: 'save',
		name: normalized.name,
		theme,
		visibility: value.visibility as 'private' | 'public',
		...('title' in value ? { title: value.title as string | null } : {}),
		...('folderId' in value ? { folderId: value.folderId as string | null } : {})
	};
}
export function parseThemeWriteAcknowledgment(input: unknown): ThemeWriteAcknowledgment {
	if (
		!object(input) ||
		Object.keys(input).length !== 5 ||
		Object.keys(input).some((key) => !['id', 'writeId', 'action', 'expectedVersion', 'resultVersion'].includes(key)) ||
		!identity(input.id) ||
		!identity(input.writeId) ||
		input.writeId.length > 160 ||
		input.id.startsWith('timeline-') ||
		!['save', 'delete'].includes(String(input.action)) ||
		(input.expectedVersion !== null && !validThemeVersion(input.expectedVersion)) ||
		(input.action === 'delete' ? input.expectedVersion === null || input.resultVersion !== null : !validThemeVersion(input.resultVersion))
	)
		return fail();
	if (input.expectedVersion === null && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.id)) return fail();
	return {
		id: input.id,
		writeId: input.writeId,
		action: input.action as 'save' | 'delete',
		expectedVersion: input.expectedVersion as string | null,
		resultVersion: input.resultVersion as string | null
	};
}
