import { library, type Recipe } from './types';

const validator: Recipe[] = [
	...Object.entries({
		Email: 'hello@example.com',
		URL: 'https://example.com',
		UUID: '550e8400-e29b-41d4-a716-446655440000',
		IP: '192.0.2.1',
		FQDN: 'example.com',
		MACAddress: '00:1B:44:11:3A:B7',
		ISO8601: '2026-03-14T12:30:00Z',
		JSON: '{"hello":"world"}',
		JWT: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk',
		HexColor: '#ff8800',
		RgbColor: 'rgb(255, 128, 0)',
		HSL: 'hsl(120, 100%, 50%)',
		Int: '42',
		Float: '3.14',
		Decimal: '12.34',
		Numeric: '12345',
		Alpha: 'Hello',
		Alphanumeric: 'Hello123',
		Ascii: 'hello world',
		Base64: 'SGVsbG8=',
		Boolean: 'true',
		CreditCard: '4111111111111111',
		Currency: '$12.50',
		DataURI: 'data:text/plain;base64,SGVsbG8=',
		Empty: '',
		Hexadecimal: 'deadbeef',
		Lowercase: 'hello',
		Uppercase: 'HELLO',
		MongoId: '507f1f77bcf86cd799439011',
		Port: '443',
		SemVer: '1.2.3',
		Slug: 'hello-world',
		StrongPassword: 'Demo-Only!1234',
		ISSN: '0378-5955',
		ISBN: '9780140328721',
		EAN: '4006381333931',
		BIC: 'DEUTDEFF',
		IBAN: 'DE89370400440532013000',
		LatLong: '-37.8136, 144.9631',
		MimeType: 'image/png'
	}).map(([fn, text]) => [`Validate ${fn}`, { text }, `return m.default.is${fn}(input.text)`] as Recipe),
	['Normalize email', { text: 'Example.User+tag@gmail.com' }, 'return m.default.normalizeEmail(input.text)'],
	['Escape markup', { text: '<script>alert("hello")</script>' }, 'return m.default.escape(input.text)'],
	['Strip selected characters', { text: 'hello123', characters: '0-9' }, 'return m.default.blacklist(input.text,input.characters)'],
	['Retain selected characters', { text: 'hello123', characters: 'a-z' }, 'return m.default.whitelist(input.text,input.characters)'],
	['Validate length', { text: 'Hello Thingtime', min: 5, max: 30 }, 'return m.default.isLength(input.text,{min:input.min,max:input.max})']
];
const semver: Recipe[] = [
	['Validate a version', { version: '1.2.3' }, 'return m.default.valid(input.version)'],
	['Clean a version', { version: ' =v1.2.3 ' }, 'return m.default.clean(input.version)'],
	['Extract major', { version: '2.3.4' }, 'return m.default.major(input.version)'],
	['Extract minor', { version: '2.3.4' }, 'return m.default.minor(input.version)'],
	['Extract patch', { version: '2.3.4' }, 'return m.default.patch(input.version)'],
	['Read prerelease', { version: '2.0.0-beta.3' }, 'return m.default.prerelease(input.version)'],
	['Compare versions', { a: '2.1.0', b: '2.0.9' }, 'return m.default.compare(input.a,input.b)'],
	['Satisfy a range', { version: '1.5.2', range: '^1.2.0' }, 'return m.default.satisfies(input.version,input.range)'],
	[
		'Minimum matching version',
		{ versions: ['1.0.0', '1.4.0', '2.0.0'], range: '^1.0.0' },
		'return m.default.minSatisfying(input.versions,input.range)'
	],
	[
		'Maximum matching version',
		{ versions: ['1.0.0', '1.4.0', '2.0.0'], range: '^1.0.0' },
		'return m.default.maxSatisfying(input.versions,input.range)'
	],
	['Intersect ranges', { a: '^1.0.0', b: '>=1.5.0 <2.0.0' }, 'return m.default.intersects(input.a,input.b)'],
	['Find version difference', { a: '1.2.3', b: '2.0.0' }, 'return m.default.diff(input.a,input.b)'],
	['Coerce a version', { text: 'release 42.6' }, 'return m.default.coerce(input.text)?.version'],
	['Sort releases', { versions: ['2.0.0', '1.9.0', '1.10.0', '2.0.0-beta.1'] }, 'return m.default.sort(input.versions)'],
	...['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'].map(
		(release) => [`Increment ${release}`, { version: '1.2.3' }, `return m.default.inc(input.version,"${release}","beta")`] as Recipe
	)
];
const colors: Recipe[] = [
	[
		'Colour palette',
		{ start: '#6366f1', end: '#f472b6', count: 7 },
		'return m.default.scale([input.start,input.end]).mode("lch").colors(input.count)'
	],
	['Accessible contrast', { foreground: '#333333', background: '#ffffff' }, 'return m.default.contrast(input.foreground,input.background)'],
	['RGB channels', { color: '#8b5cf6' }, 'return m.default(input.color).rgb()'],
	['HSL channels', { color: '#8b5cf6' }, 'return m.default(input.color).hsl()'],
	['LAB channels', { color: '#8b5cf6' }, 'return m.default(input.color).lab()'],
	['LCH channels', { color: '#8b5cf6' }, 'return m.default(input.color).lch()'],
	['CMYK channels', { color: '#8b5cf6' }, 'return m.default(input.color).cmyk()'],
	['CSS colour string', { color: '#8b5cf6' }, 'return m.default(input.color).css()'],
	['Darken a colour', { color: '#8b5cf6', amount: 1 }, 'return m.default(input.color).darken(input.amount).hex()'],
	['Brighten a colour', { color: '#8b5cf6', amount: 1 }, 'return m.default(input.color).brighten(input.amount).hex()'],
	['Saturate a colour', { color: '#8b5cf6', amount: 1 }, 'return m.default(input.color).saturate(input.amount).hex()'],
	['Desaturate a colour', { color: '#8b5cf6', amount: 1 }, 'return m.default(input.color).desaturate(input.amount).hex()'],
	['Set opacity', { color: '#8b5cf6', alpha: 0.5 }, 'return m.default(input.color).alpha(input.alpha).css()'],
	['Relative luminance', { color: '#8b5cf6' }, 'return m.default(input.color).luminance()'],
	['Mix colours', { a: '#ef4444', b: '#3b82f6', ratio: 0.5 }, 'return m.default.mix(input.a,input.b,input.ratio,"lab").hex()'],
	['Average colours', { colors: ['#ef4444', '#22c55e', '#3b82f6'] }, 'return m.default.average(input.colors).hex()'],
	['Blend colours', { a: '#f472b6', b: '#60a5fa', mode: 'multiply' }, 'return m.default.blend(input.a,input.b,input.mode).hex()'],
	['Colour distance', { a: '#ef4444', b: '#f97316' }, 'return m.default.distance(input.a,input.b)'],
	['Perceptual delta E', { a: '#ef4444', b: '#f97316' }, 'return m.default.deltaE(input.a,input.b)'],
	['Validate colour', { color: 'rebeccapurple' }, 'return m.default.valid(input.color)'],
	['Temperature colour', { kelvin: 6500 }, 'return m.default.temperature(input.kelvin).hex()'],
	['Bezier palette', { colors: ['#fff7ed', '#fb923c', '#7c2d12'], count: 9 }, 'return m.default.bezier(input.colors).scale().colors(input.count)']
];
const zod: Recipe[] = [
	[
		'Validate a contact',
		{ value: { name: 'Maya', email: 'maya@example.com' } },
		'return m.z.object({name:m.z.string().min(1),email:m.z.string().email()}).safeParse(input.value)'
	],
	[
		'Validate a product',
		{ value: { title: 'Notebook', price: 12.5, inStock: true } },
		'return m.z.object({title:m.z.string(),price:m.z.number().nonnegative(),inStock:m.z.boolean()}).safeParse(input.value)'
	],
	['Validate a URL', { value: 'https://example.com' }, 'return m.z.string().url().safeParse(input.value)'],
	['Validate a UUID', { value: '550e8400-e29b-41d4-a716-446655440000' }, 'return m.z.string().uuid().safeParse(input.value)'],
	['Coerce a number', { value: '42' }, 'return m.z.coerce.number().safeParse(input.value)'],
	['Default a missing value', {}, 'return m.z.string().default("Untitled").parse(input.value)'],
	['Validate an enum', { value: 'draft' }, 'return m.z.enum(["draft","published","archived"]).safeParse(input.value)'],
	['Validate an array', { value: ['a', 'b', 'c'] }, 'return m.z.array(m.z.string()).min(1).max(10).safeParse(input.value)'],
	[
		'Validate a tuple',
		{ value: ['Melbourne', -37.8136, 144.9631] },
		'return m.z.tuple([m.z.string(),m.z.number(),m.z.number()]).safeParse(input.value)'
	],
	['Accept nullable values', { value: null }, 'return m.z.string().nullable().safeParse(input.value)'],
	['Transform text', { value: '  hello world  ' }, 'return m.z.string().trim().toUpperCase().parse(input.value)'],
	[
		'Refine password confirmation',
		{ value: { password: 'example', confirm: 'example' } },
		'return m.z.object({password:m.z.string(),confirm:m.z.string()}).refine(x=>x.password===x.confirm,{message:"Passwords must match"}).safeParse(input.value)'
	],
	['Validate a union', { value: 42 }, 'return m.z.union([m.z.string(),m.z.number()]).safeParse(input.value)'],
	['Reject unknown fields', { value: { name: 'Maya', extra: true } }, 'return m.z.object({name:m.z.string()}).strict().safeParse(input.value)'],
	[
		'Parse a nested form',
		{ value: { address: { city: 'Melbourne', postcode: '3000' } } },
		'return m.z.object({address:m.z.object({city:m.z.string(),postcode:m.z.string().regex(/^\\d{4}$/)})}).safeParse(input.value)'
	]
];
const luxon: Recipe[] = [
	[
		'Convert time zone',
		{ date: '2026-03-14T12:30:00Z', zone: 'Australia/Melbourne' },
		'return m.DateTime.fromISO(input.date).setZone(input.zone).toISO()'
	],
	[
		'Localized date',
		{ date: '2026-03-14', locale: 'fr' },
		'return m.DateTime.fromISO(input.date).setLocale(input.locale).toLocaleString(m.DateTime.DATE_FULL)'
	],
	[
		'Time zone offset',
		{ date: '2026-03-14', zone: 'America/New_York' },
		'const d=m.DateTime.fromISO(input.date,{zone:input.zone}); return {offsetMinutes:d.offset,zone:d.zoneName,daylightSaving:d.isInDST}'
	],
	[
		'Interval length',
		{ start: '2026-03-01', end: '2026-04-01', unit: 'days' },
		'return m.Interval.fromDateTimes(m.DateTime.fromISO(input.start),m.DateTime.fromISO(input.end)).length(input.unit)'
	],
	[
		'Split interval',
		{ start: '2026-03-01', end: '2026-03-08', days: 2 },
		'return m.Interval.fromDateTimes(m.DateTime.fromISO(input.start),m.DateTime.fromISO(input.end)).splitBy({days:input.days}).map(x=>x.toISO())'
	],
	['Duration conversion', { hours: 2, minutes: 30 }, 'return m.Duration.fromObject(input).as("minutes")'],
	['Human duration', { hours: 2, minutes: 30 }, 'return m.Duration.fromObject(input).toHuman()'],
	['Parse a SQL date', { text: '2026-03-14 12:30:00' }, 'return m.DateTime.fromSQL(input.text,{zone:"utc"}).toISO()'],
	['RFC 2822 timestamp', { date: '2026-03-14T12:30:00Z' }, 'return m.DateTime.fromISO(input.date,{zone:"utc"}).toRFC2822()'],
	[
		'Calendar information',
		{ date: '2026-03-14' },
		'const d=m.DateTime.fromISO(input.date);return {weekday:d.weekdayLong,ordinal:d.ordinal,week:d.weekNumber,daysInMonth:d.daysInMonth}'
	]
];
const formats: Recipe[] = Object.entries({
	Thousands: '0,0',
	Decimals: '0,0.00',
	Currency: '$0,0.00',
	Abbreviated: '0.0a',
	Percentage: '0.0%',
	Ordinal: '0o',
	Bytes: '0.0 b',
	Time: '00:00:00',
	Signed: '+0,0',
	Padded: '000000'
}).map(([title, format]) => [
	title,
	{ value: title === 'Percentage' ? 0.425 : 12345.678, format },
	'return m.default(input.value).format(input.format)'
]);

export const MORE_PACKAGE_EXAMPLES = [
	...library('validator', '13.15.15', 'Validation', 'https://github.com/validatorjs/validator.js', validator),
	...library('semver', '7.7.2', 'Developer tools', 'https://github.com/npm/node-semver', semver),
	...library('chroma-js', '3.1.2', 'Colour & design', 'https://gka.github.io/chroma.js/', colors),
	...library('zod', '3.25.76', 'Validation', 'https://zod.dev/', zod),
	...library('luxon', '3.7.2', 'Dates & time', 'https://moment.github.io/luxon/#/tour', luxon),
	...library('numeral', '2.0.6', 'Numbers & formatting', 'http://numeraljs.com/', formats),
	...library('papaparse', '5.5.3', 'Files & text', 'https://www.papaparse.com/docs', [
		['CSV to records', { text: 'name,score\nMaya,8\nLeo,5' }, 'return m.default.parse(input.text,{header:true,dynamicTyping:true})'],
		[
			'Records to CSV',
			{
				rows: [
					{ name: 'Maya', score: 8 },
					{ name: 'Leo', score: 5 }
				]
			},
			'return m.default.unparse(input.rows)'
		],
		['Tab separated data', { text: 'name\tscore\nMaya\t8' }, 'return m.default.parse(input.text,{header:true,delimiter:"\\t"})'],
		['CSV with quoted fields', { text: 'title,note\n"Hello, world","two, commas"' }, 'return m.default.parse(input.text,{header:true})'],
		['Skip empty CSV rows', { text: 'name,score\nMaya,8\n\nLeo,5\n' }, 'return m.default.parse(input.text,{header:true,skipEmptyLines:true})']
	]),
	...library('json5', '2.2.3', 'Files & text', 'https://json5.org/', [
		['Parse JSON with comments', { text: '{ // a note\n title: "Hello", count: 3, }' }, 'return m.default.parse(input.text)'],
		['Write readable JSON5', { value: { title: 'Hello', count: 3 } }, 'return m.default.stringify(input.value,null,2)'],
		['Parse hexadecimal numbers', { text: '{red: 0xff, green: 0x80}' }, 'return m.default.parse(input.text)']
	]),
	...library('yaml', '2.8.1', 'Files & text', 'https://eemeli.org/yaml/', [
		['YAML to JSON', { text: 'name: Maya\ntags:\n  - design\n  - build' }, 'return m.parse(input.text)'],
		['JSON to YAML', { value: { name: 'Maya', tags: ['design', 'build'] } }, 'return m.stringify(input.value)'],
		['Multi document YAML', { text: 'name: First\n---\nname: Second' }, 'return m.parseAllDocuments(input.text).map(d=>d.toJSON())'],
		['Read YAML errors', { text: 'items: [a, b' }, 'return m.parseDocument(input.text).errors.map(e=>e.message)']
	]),
	...library('qs', '6.14.0', 'Developer tools', 'https://github.com/ljharb/qs', [
		['Parse query string', { text: 'page=2&filter[team]=design' }, 'return m.default.parse(input.text)'],
		['Build query string', { value: { page: 2, tags: ['design', 'build'] } }, 'return m.default.stringify(input.value,{arrayFormat:"repeat"})'],
		['Parse repeated parameters', { text: 'tags=design&tags=build' }, 'return m.default.parse(input.text)'],
		['Encode nested filters', { value: { filter: { status: 'active', min: 10 } } }, 'return m.default.stringify(input.value)']
	]),
	...library('fuse.js', '7.1.0', 'Search', 'https://www.fusejs.io/', [
		[
			'Fuzzy search names',
			{ items: ['Maya', 'Leo', 'Aria', 'Maria'], query: 'Mya' },
			'return new m.default(input.items,{includeScore:true}).search(input.query)'
		],
		[
			'Search structured records',
			{
				items: [
					{ title: 'Blue sky', tag: 'nature' },
					{ title: 'City lights', tag: 'urban' }
				],
				query: 'sky'
			},
			'return new m.default(input.items,{keys:["title","tag"],includeScore:true}).search(input.query)'
		],
		[
			'Weighted search fields',
			{
				items: [
					{ title: 'Notebook', description: 'A blue book' },
					{ title: 'Blue', description: 'A pen' }
				],
				query: 'blue'
			},
			'return new m.default(input.items,{keys:[{name:"title",weight:2},{name:"description",weight:1}]}).search(input.query)'
		],
		[
			'Strict fuzzy threshold',
			{ items: ['cat', 'cart', 'coat', 'dog'], query: 'cat', threshold: 0.2 },
			'return new m.default(input.items,{threshold:input.threshold,includeScore:true}).search(input.query)'
		],
		[
			'Search with match locations',
			{ items: ['Thingtime library', 'Time to build'], query: 'time' },
			'return new m.default(input.items,{includeMatches:true}).search(input.query)'
		]
	]),
	...library('uuid', '11.1.0', 'Identifiers', 'https://github.com/uuidjs/uuid', [
		['Random UUID', {}, 'return m.v4()'],
		['Time ordered UUID', {}, 'return m.v7()'],
		['Deterministic URL UUID', { url: 'https://thingtime.com' }, 'return m.v5(input.url,m.v5.URL)'],
		['Validate UUID', { value: '550e8400-e29b-41d4-a716-446655440000' }, 'return m.validate(input.value)'],
		['Read UUID version', { value: '550e8400-e29b-41d4-a716-446655440000' }, 'return m.version(input.value)'],
		['UUID bytes', { value: '550e8400-e29b-41d4-a716-446655440000' }, 'return Array.from(m.parse(input.value))']
	]),
	...library('nanoid', '5.1.5', 'Identifiers', 'https://github.com/ai/nanoid', [
		['Short random ID', { size: 12 }, 'return m.nanoid(input.size)'],
		['Custom alphabet ID', { alphabet: '0123456789abcdef', size: 16 }, 'return m.customAlphabet(input.alphabet,input.size)()']
	]),
	...library(
		'change-case',
		'5.4.4',
		'Files & text',
		'https://github.com/blakeembrey/change-case',
		[
			'camelCase',
			'capitalCase',
			'constantCase',
			'dotCase',
			'kebabCase',
			'noCase',
			'pascalCase',
			'pascalSnakeCase',
			'pathCase',
			'sentenceCase',
			'snakeCase',
			'trainCase'
		].map((fn) => [fn, { text: 'Hello wonderful world' }, `return m.${fn}(input.text)`] as Recipe)
	),
	...library('he', '1.2.0', 'Files & text', 'https://github.com/mathiasbynens/he', [
		['Encode HTML entities', { text: 'Tea & coffee <3 ☀' }, 'return m.default.encode(input.text)'],
		['Decode HTML entities', { text: 'Tea &amp; coffee &lt;3 &#x2600;' }, 'return m.default.decode(input.text)'],
		['Escape attribute text', { text: '"Hello" & <world>' }, 'return m.default.escape(input.text)']
	])
];

MORE_PACKAGE_EXAMPLES.push(
	...library('dayjs', '1.11.13', 'Dates & time', 'https://day.js.org/docs/en/installation/installation', [
		['Compact date format', { date: '2026-03-14T12:30:00Z', format: 'YYYY-MM-DD HH:mm' }, 'return m.default(input.date).format(input.format)'],
		['Add calendar months', { date: '2026-01-31', amount: 1 }, 'return m.default(input.date).add(input.amount,"month").format("YYYY-MM-DD")'],
		['Compare timestamps', { date: '2026-03-14', other: '2026-04-01' }, 'return m.default(input.date).isBefore(input.other)'],
		['Month length', { date: '2028-02-01' }, 'return m.default(input.date).daysInMonth()'],
		['Unix timestamp', { date: '2026-03-14T12:30:00Z' }, 'return m.default(input.date).unix()'],
		['Days between dates', { date: '2026-03-14', other: '2026-03-01' }, 'return m.default(input.date).diff(input.other,"day")']
	])
);
