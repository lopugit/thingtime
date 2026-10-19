import { syncPathKey, validSyncPath } from './reconcile';

export const DEFAULT_SYNC_IGNORE_RULES = ['node_modules/', 'bower_components/', '.venv/', 'venv/', '__pycache__/', '.gradle/', 'Pods/', '.dart_tool/', '.pub-cache/', '.pnpm-store/', '.npm/', '.yarn/cache/', '.cargo/registry/', '.cargo/git/', '.m2/repository/', '__pypackages__/', '.tox/', '.nox/', '/go/pkg/mod/', '**/vendor/bundle/'].join('\n');
export function canonicalIgnoreRules(value: unknown): string {
	if (value === undefined) return '';
	if (typeof value !== 'string' || value.includes('\0')) throw Error('Ignore rules must be text without NUL characters.');
	const text = value.replace(/\r\n/g, '\n');
	return text;
}
const bytes = (text: string) => Array.from(new TextEncoder().encode(text), n => String.fromCharCode(n)).join('');
type ClassPart = [number, number] | string;
type Token = { kind: 'literal'; byte: number } | { kind: 'any' | 'star' | 'glob' | 'glob-start' | 'glob-body' | 'never' } | { kind: 'class'; negate: boolean; parts: ClassPart[] };
type Rule = { line: number; pattern: string; negative: boolean; directory: boolean; basename: boolean; tokens: Token[] };
const classes: Record<string, (byte: number) => boolean> = {
	alnum: c => classes.alpha(c) || classes.digit(c), alpha: c => classes.lower(c) || classes.upper(c), blank: c => c === 9 || c === 32,
	cntrl: c => c < 32 || c === 127, digit: c => c >= 48 && c <= 57, graph: c => c >= 33 && c <= 126,
	lower: c => c >= 97 && c <= 122, print: c => c >= 32 && c <= 126, punct: c => classes.graph(c) && !classes.alnum(c),
	space: c => c === 32 || (c >= 9 && c <= 13), upper: c => c >= 65 && c <= 90, xdigit: c => classes.digit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
};
function compile(pattern: string): Token[] {
	const tokens: Token[] = [], p = bytes(pattern);
	for (let i = 0; i < p.length; i++) {
		const c = p[i];
		if (c === '\\') { if (++i === p.length) return [{ kind: 'never' }]; tokens.push({ kind: 'literal', byte: p.charCodeAt(i) }); }
		else if (c === '?') tokens.push({ kind: 'any' });
		else if (c === '*') {
			const start = i; while (p[i + 1] === '*') i++;
			const afterSlash = p[i + 1] === '/' ? 1 : p[i + 1] === '\\' && p[i + 2] === '/' ? 2 : 0;
			const glob = i > start && (start === 0 || p[start - 1] === '/') && (i + 1 === p.length || !!afterSlash);
			if (glob && afterSlash === 1) { tokens.push({ kind: 'glob-start' }, { kind: 'glob-body' }); i++; }
			else tokens.push({ kind: glob ? 'glob' : 'star' });
		} else if (c === '[') {
			let j = i + 1, negate = false, closed = false; const parts: ClassPart[] = [];
			if (p[j] === '!' || p[j] === '^') { negate = true; j++; }
			if (p[j] === ']') { parts.push([93, 93]); j++; }
			for (; j < p.length; j++) {
				if (p[j] === ']') { closed = true; break; }
				if (p[j] === '[' && p[j + 1] === ':') {
					const end = p.indexOf(':]', j + 2); if (end < 0 || !classes[p.slice(j + 2, end)]) return [{ kind: 'never' }];
					parts.push(p.slice(j + 2, end)); j = end + 1; continue;
				}
				if (p[j] === '\\' && ++j === p.length) return [{ kind: 'never' }];
				const from = p.charCodeAt(j); let to = from;
				if (p[j + 1] === '-' && j + 2 < p.length && p[j + 2] !== ']') {
					j += 2; if (p[j] === '\\' && ++j === p.length) return [{ kind: 'never' }]; to = p.charCodeAt(j);
				}
				parts.push([from, to < from ? from : to]);
			}
			if (!closed) return [{ kind: 'never' }];
			tokens.push({ kind: 'class', negate, parts }); i = j;
		} else tokens.push({ kind: 'literal', byte: p.charCodeAt(i) });
	}
	return tokens;
}
/** Wildcards run as an NFA over UTF-8 bytes, as Git does. State memory grows
 * with the rule length; alternating stars never create recursive backtracking. */
function match(tokens: Token[], path: string): boolean {
	const close = (states: Set<number>) => {
		for (const i of states) {
			const token = tokens[i];
			if (token?.kind === 'star' || token?.kind === 'glob') states.add(i + 1);
			else if (token?.kind === 'glob-start') states.add(i + 2);
		}
		return states;
	};
	let states = close(new Set([0]));
	for (const char of bytes(path)) {
		const c = char.charCodeAt(0), next = new Set<number>();
		for (const i of states) {
			const token = tokens[i]; if (!token) continue;
			if (token.kind === 'literal' && token.byte === c || token.kind === 'any' && c !== 47) next.add(i + 1);
			else if (token.kind === 'star' && c !== 47 || token.kind === 'glob') next.add(i);
			else if (token.kind === 'glob-start') next.add(c === 47 ? i : i + 1);
			else if (token.kind === 'glob-body') next.add(c === 47 ? i - 1 : i);
			else if (token.kind === 'class' && c !== 47) {
				const found = token.parts.some(part => typeof part === 'string' ? classes[part](c) : c >= part[0] && c <= part[1]);
				if (found !== token.negate) next.add(i + 1);
			}
		}
		if (!next.size) return false; states = close(next);
	}
	return close(states).has(tokens.length);
}
function parse(text: string): Rule[] {
	return text.split('\n').flatMap((original, index) => {
		let pattern = original.endsWith('\r') ? original.slice(0, -1) : original;
		if (index === 0 && pattern.startsWith('\uFEFF')) pattern = pattern.slice(1);
		while (pattern.endsWith(' ')) {
			let escapes = 0; for (let i = pattern.length - 2; i >= 0 && pattern[i] === '\\'; i--) escapes++;
			if (escapes % 2) break; pattern = pattern.slice(0, -1);
		}
		if (!pattern || pattern[0] === '#') return [];
		const negative = pattern[0] === '!'; if (negative) pattern = pattern.slice(1);
		if (!pattern) return [];
		const directory = pattern.endsWith('/'); if (directory) pattern = pattern.slice(0, -1);
		const anchored = pattern.startsWith('/'); if (anchored) pattern = pattern.slice(1);
		return [{ line: index + 1, pattern: original, negative, directory, basename: !anchored && !pattern.includes('/'), tokens: compile(pattern) }];
	});
}
export type SyncIgnoreExplanation = { ignored: boolean; source: 'exact' | 'rule' | 'none'; path: string; rule?: string; line?: number; parent?: string };
export function createSyncIgnorePolicy(ignoreRules?: string, excludedPaths: readonly string[] = []) {
	const text = canonicalIgnoreRules(ignoreRules), rules = parse(text), exact = excludedPaths.map(syncPathKey);
	const explain = (path: string, kind: 'file' | 'folder' = 'file'): SyncIgnoreExplanation => {
		if (!validSyncPath(path)) throw Error('Test a relative path inside the selected folder.');
		const key = syncPathKey(path), hard = exact.find(prefix => key === prefix || key.startsWith(prefix + '/'));
		if (hard) return { ignored: true, source: 'exact', path, rule: excludedPaths[exact.indexOf(hard)] };
		if (!rules.length) return { ignored: false, source: 'none', path };
		const parts = path.split('/'); let result: SyncIgnoreExplanation = { ignored: false, source: 'none', path };
		for (let n = 1; n <= parts.length; n++) {
			const current = parts.slice(0, n).join('/'), directory = n < parts.length || kind === 'folder';
			let winner: Rule | undefined;
			for (const rule of rules) if ((!rule.directory || directory) && match(rule.tokens, rule.basename ? parts[n - 1] : current)) winner = rule;
			if (winner) result = { ignored: !winner.negative, source: 'rule', path, rule: winner.pattern, line: winner.line, ...(n < parts.length ? { parent: current } : {}) };
			else result = { ignored: false, source: 'none', path };
			// Git cannot reinclude a child while its parent directory is ignored.
			if (result.ignored && directory) return result;
		}
		return result;
	};
	return { text, explain, ignored: (path: string, kind: 'file' | 'folder' = 'file') => explain(path, kind).ignored };
}
