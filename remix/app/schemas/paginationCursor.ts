/** Transport budget for opaque pagination state, independent of record count. */
export const MAX_PAGINATION_CURSOR_CHARS = 16 * 1024;
export const INVALID_PAGINATION_CURSOR = '!pagination-cursor-too-long';
export const isPaginationCursorKey = (key: string): boolean => key === 'cursor' || /^[A-Za-z_][A-Za-z0-9_]*Cursor$/.test(key);
