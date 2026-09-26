import { BROWSER_ACTION_LEGACY_LIMITS } from './browserActions';
// Cursor pagination is authored data, shared by every browser request program.
// Paths address response data only; they never select an API destination.
export type ActionRequestPagination = {
	cursorParam: string;
	cursorPath: string;
	itemsPath: string;
	itemKey?: string;
	maxPages: number;
	maxItems: number;
};
const path = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 160 &&
	value.split('.').length <= 8 &&
	value.split('.').every((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key));
export function parseActionRequestPagination(raw: unknown): ActionRequestPagination | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const spec = raw as Record<string, unknown>;
	if (Object.keys(spec).some((key) => !['cursorParam', 'cursorPath', 'itemsPath', 'itemKey', 'maxPages', 'maxItems'].includes(key))) return null;
	if (
		!path(spec.cursorParam) ||
		spec.cursorParam.includes('.') ||
		!path(spec.cursorPath) ||
		!path(spec.itemsPath) ||
		spec.cursorPath === spec.itemsPath ||
		spec.cursorPath.startsWith(spec.itemsPath + '.') ||
		spec.itemsPath.startsWith(spec.cursorPath + '.')
	)
		return null;
	if (spec.itemKey !== undefined && !path(spec.itemKey)) return null;
	const maxPages = spec.maxPages ?? 20,
		maxItems = spec.maxItems ?? 5000;
	if (
		typeof maxPages !== 'number' ||
		!Number.isInteger(maxPages) ||
		maxPages < 1 ||
		maxPages > 100 ||
		typeof maxItems !== 'number' ||
		!Number.isInteger(maxItems) ||
		maxItems < 1 ||
		maxItems > 10000
	)
		return null;
	return {
		cursorParam: spec.cursorParam,
		cursorPath: spec.cursorPath,
		itemsPath: spec.itemsPath,
		...(spec.itemKey === undefined ? {} : { itemKey: spec.itemKey as string }),
		maxPages,
		maxItems
	};
}
const containsIndexedExpression = (value: unknown, depth = 0): boolean => {
	if (!value || typeof value !== 'object' || depth > 64) return false;
	if (!Array.isArray(value) && Array.isArray((value as any).ttExpr) && ['indexBy', 'groupBy'].includes((value as any).ttExpr[0])) return true;
	return Object.values(value).some((entry) => containsIndexedExpression(entry, depth + 1));
};
export const browserActionMinimumVersion = (program: Record<string, unknown>): '1.7.0' | '1.8.0' | '1.9.0' | '1.11.0' =>
	containsIndexedExpression(program.steps)
		? '1.11.0'
		: program.expressionLimits !== undefined || (Array.isArray(program.steps) && program.steps.some((step) => step?.op === 'each'))
		? '1.9.0'
		: (Array.isArray(program.steps) && program.steps.some((step) => step?.pagination !== undefined)) ||
		  Object.entries(BROWSER_ACTION_LEGACY_LIMITS).some(
				([key, limit]) => Number((program.limits as Record<string, unknown> | undefined)?.[key]) > limit
		  )
		? '1.8.0'
		: '1.7.0';
