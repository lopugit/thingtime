// Commander assignments accept data literals, not JavaScript programs. This
// keeps the ordinary path=value workflow usable under the application CSP
// without turning user input into executable source.
export const parseCommanderLiteral = (rawValue: unknown): unknown => {
	const value = typeof rawValue === 'string' ? rawValue.trim() : '';
	if (!value) return '';

	try {
		return JSON.parse(value);
	} catch {
		// JSON does not accept single-quoted strings, but Commander historically
		// did. Support that data-only convenience without evaluating the input.
		if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
			const inner = value.slice(1, -1);
			let unescaped = '';

			for (let index = 0; index < inner.length; index += 1) {
				const character = inner[index];
				const next = inner[index + 1];
				if (character === '\\' && (next === '\\' || next === "'")) {
					unescaped += next;
					index += 1;
				} else {
					unescaped += character;
				}
			}

			return unescaped;
		}

		// The old path fell back to a quoted string when JavaScript parsing
		// failed. Preserve that useful behavior for plain words and expressions.
		return value;
	}
};
