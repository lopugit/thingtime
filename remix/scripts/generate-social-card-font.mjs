#!/usr/bin/env node

// Regenerates app/api/utils/meta/socialCardFontData.ts from Liberation Sans.
//
// The social card is rasterised by resvg-js, which in 2.6 can only load a font
// from a filesystem PATH — there is no fontBuffers option — and the deployed
// Vercel Node runtime has no fonts installed. Embedding the face in the bundle
// is the only form that cannot be lost by Nitro bundling or Vercel dependency
// tracing, and it means the unit tests exercise the same bytes production does.
//
// Pass the directory holding LiberationSans-{Regular,Bold}.ttf, or rely on the
// usual Debian/Ubuntu location (the `fonts-liberation` package).
//
//   node scripts/generate-social-card-font.mjs [fontDir]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fontDir = process.argv[2] || '/usr/share/fonts/truetype/liberation';
const faces = ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf'];
const target = 'app/api/utils/meta/socialCardFontData.ts';

const chunk = (value, size) => {
	const parts = [];
	for (let index = 0; index < value.length; index += size) parts.push(value.slice(index, index + size));
	return parts;
};

const entries = faces
	.map((file) => {
		const base64 = readFileSync(join(fontDir, file)).toString('base64');
		const lines = chunk(base64, 200)
			.map((line) => `\t\t\t'${line}'`)
			.join(' +\n');
		return `\t{\n\t\tfile: '${file}',\n\t\tbase64:\n${lines}\n\t}`;
	})
	.join(',\n');

const source = `// GENERATED FILE — do not hand-edit.
//
// Liberation Sans, embedded as base64 so the social-card renderer always has
// a face to draw with. Regenerate with scripts/generate-social-card-font.mjs.
//
// Why the bytes live in a JS module rather than beside it on disk: resvg-js
// 2.6 can only load fonts from a filesystem PATH (there is no fontBuffers
// option), and the deployed Vercel Node runtime ships no fonts at all — so
// \`font-family="Arial, sans-serif"\` resolved to nothing and every card came
// out with its artwork drawn and not one glyph on it. A sibling .ttf would
// have to survive Nitro bundling AND Vercel dependency tracing to be there at
// runtime; bytes inside the bundle simply cannot go missing, and the unit
// tests then exercise the exact code path production uses.
//
// Liberation Sans is metric-compatible with Arial, which is what the card was
// designed and measured against (see socialTextWidth).
//
// SIL Open Font License 1.1 — see ./LICENSE-Liberation.txt.

export const SOCIAL_CARD_FONT_FAMILY = 'Liberation Sans';

export const SOCIAL_CARD_FONTS: ReadonlyArray<{ file: string; base64: string }> = [
${entries}
];
`;

writeFileSync(target, source);
console.log(`[fonts] wrote ${target} from ${fontDir} (${faces.join(', ')}).`);
