import { library, type Recipe } from './types';

const numbers = [2, 4, 4, 6, 8, 10];
const people = [
	{ name: 'Maya', team: 'Design', score: 8 },
	{ name: 'Leo', team: 'Build', score: 5 },
	{ name: 'Ari', team: 'Design', score: 9 }
];
const lodash: Recipe[] = [
	['Chunk a list', { values: numbers, size: 2 }, 'return m.chunk(input.values, input.size)'],
	['Remove empty values', { values: [0, 1, false, 2, '', 3, null] }, 'return m.compact(input.values)'],
	['Find differences', { values: [1, 2, 3, 4], other: [2, 4] }, 'return m.difference(input.values, input.other)'],
	['Drop leading items', { values: numbers, count: 2 }, 'return m.drop(input.values, input.count)'],
	['Drop trailing items', { values: numbers, count: 2 }, 'return m.dropRight(input.values, input.count)'],
	['Fill a range', { values: [0, 0, 0, 0], value: 7, start: 1, end: 3 }, 'return m.fill([...input.values], input.value, input.start, input.end)'],
	['Flatten one level', { values: [1, [2, 3], [4, [5]]] }, 'return m.flatten(input.values)'],
	['Flatten deeply', { values: [1, [2, [3, [4]]]] }, 'return m.flattenDeep(input.values)'],
	['Flatten to a depth', { values: [1, [2, [3, [4]]]], depth: 2 }, 'return m.flattenDepth(input.values, input.depth)'],
	['First item', { values: numbers }, 'return m.head(input.values)'],
	['Last item', { values: numbers }, 'return m.last(input.values)'],
	['All but the last', { values: numbers }, 'return m.initial(input.values)'],
	['All but the first', { values: numbers }, 'return m.tail(input.values)'],
	['Intersect collections', { values: [1, 2, 3], other: [2, 3, 4] }, 'return m.intersection(input.values, input.other)'],
	['Join labels', { values: ['Things', 'Actions', 'Components'], separator: ' / ' }, 'return m.join(input.values, input.separator)'],
	['Read an item from the end', { values: numbers, index: -2 }, 'return m.nth(input.values, input.index)'],
	['Take a page', { values: numbers, count: 3 }, 'return m.take(input.values, input.count)'],
	['Take a list tail', { values: numbers, count: 3 }, 'return m.takeRight(input.values, input.count)'],
	['Union collections', { values: [1, 2, 3], other: [3, 4, 5] }, 'return m.union(input.values, input.other)'],
	['Deduplicate values', { values: numbers }, 'return m.uniq(input.values)'],
	['Symmetric difference', { values: [1, 2, 3], other: [2, 3, 4] }, 'return m.xor(input.values, input.other)'],
	['Zip columns', { labels: ['A', 'B', 'C'], values: [4, 8, 2] }, 'return m.zip(input.labels, input.values)'],
	['Build an object from columns', { labels: ['name', 'role'], values: ['Maya', 'Designer'] }, 'return m.zipObject(input.labels, input.values)'],
	['Group records', { people, key: 'team' }, 'return m.groupBy(input.people, input.key)'],
	['Index records', { people, key: 'name' }, 'return m.keyBy(input.people, input.key)'],
	['Count groups', { people, key: 'team' }, 'return m.countBy(input.people, input.key)'],
	['Sort records', { people, key: 'score' }, 'return m.sortBy(input.people, input.key)'],
	['Rank records descending', { people, key: 'score' }, 'return m.orderBy(input.people, [input.key], ["desc"])'],
	['Find a record', { people, name: 'Maya' }, 'return m.find(input.people, {name: input.name})'],
	['Filter a team', { people, team: 'Design' }, 'return m.filter(input.people, {team: input.team})'],
	['Split matching records', { people, team: 'Design' }, 'return m.partition(input.people, {team: input.team})'],
	['Project a column', { people, key: 'name' }, 'return m.map(input.people, input.key)'],
	['Sum a column', { people, key: 'score' }, 'return m.sumBy(input.people, input.key)'],
	['Average a column', { people, key: 'score' }, 'return m.meanBy(input.people, input.key)'],
	['Highest scoring record', { people, key: 'score' }, 'return m.maxBy(input.people, input.key)'],
	['Lowest scoring record', { people, key: 'score' }, 'return m.minBy(input.people, input.key)'],
	['Read a nested property', { value: { profile: { city: 'Melbourne' } }, path: 'profile.city' }, 'return m.get(input.value, input.path, "Unknown")'],
	['Check a nested property', { value: { profile: { city: 'Melbourne' } }, path: 'profile.city' }, 'return m.has(input.value, input.path)'],
	['Pick public fields', { value: { title: 'Note', count: 3, internal: false }, keys: ['title', 'count'] }, 'return m.pick(input.value, input.keys)'],
	['Omit a field', { value: { title: 'Note', temporary: true }, keys: ['temporary'] }, 'return m.omit(input.value, input.keys)'],
	['Object entries', { value: { red: 1, blue: 2 } }, 'return m.toPairs(input.value)'],
	[
		'Object from entries',
		{
			values: [
				['red', 1],
				['blue', 2]
			]
		},
		'return m.fromPairs(input.values)'
	],
	['Invert a dictionary', { value: { au: 'Australia', nz: 'New Zealand' } }, 'return m.invert(input.value)'],
	[
		'Default missing fields',
		{ value: { theme: 'dark' }, defaults: { theme: 'light', language: 'en' } },
		'return m.defaults({}, input.value, input.defaults)'
	],
	['Deep equality', { value: { tags: ['a', 'b'] }, other: { tags: ['a', 'b'] } }, 'return m.isEqual(input.value, input.other)'],
	['Camel case', { text: 'hello wonderful world' }, 'return m.camelCase(input.text)'],
	['Kebab case', { text: 'My New Component' }, 'return m.kebabCase(input.text)'],
	['Snake case', { text: 'My New Component' }, 'return m.snakeCase(input.text)'],
	['Start case', { text: 'helloWonderfulWorld' }, 'return m.startCase(input.text)'],
	['Remove accents', { text: 'déjà vu café' }, 'return m.deburr(input.text)'],
	['Escape HTML', { text: '<b>Tea & coffee</b>' }, 'return m.escape(input.text)'],
	['Unescape HTML', { text: '&lt;b&gt;Hello&lt;/b&gt;' }, 'return m.unescape(input.text)'],
	[
		'Truncate a sentence',
		{ text: 'A small library of wonderful things to build together.', length: 32 },
		'return m.truncate(input.text, {length: input.length, separator: " "})'
	],
	['Pad a label', { text: '7', length: 4 }, 'return m.padStart(input.text, input.length, "0")'],
	['Tokenize words', { text: 'Hello, curious world! 42 things.' }, 'return m.words(input.text)'],
	['Clamp a number', { value: 120, min: 0, max: 100 }, 'return m.clamp(input.value, input.min, input.max)'],
	['Create a number range', { start: 0, end: 12, step: 2 }, 'return m.range(input.start, input.end, input.step)'],
	['Round decimals', { value: 3.14159265, places: 3 }, 'return m.round(input.value, input.places)'],
	['Find an insertion index', { values: [10, 20, 40, 50], value: 30 }, 'return m.sortedIndex(input.values, input.value)'],
	['Remove selected values', { values: [1, 2, 3, 2, 4], remove: [2, 4] }, 'return m.without(input.values, ...input.remove)']
];

const date = '2026-03-14T12:30:00Z';
const dates: Recipe[] = [
	['Format a date', { date, format: 'EEEE, d MMMM yyyy' }, 'return m.format(new Date(input.date), input.format)'],
	['Format an ISO timestamp', { date }, 'return m.formatISO(new Date(input.date))'],
	[
		'Format a relative interval',
		{ date, other: '2026-03-17T12:30:00Z' },
		'return m.formatDistanceStrict(new Date(input.date), new Date(input.other))'
	],
	['Compare dates', { date, other: '2026-04-01T00:00:00Z' }, 'return m.compareAsc(new Date(input.date), new Date(input.other))'],
	[
		'Parse a custom date',
		{ text: '14/03/2026', format: 'dd/MM/yyyy' },
		'return m.parse(input.text, input.format, new Date("2000-01-01")).toISOString()'
	],
	['Days in a month', { date }, 'return m.getDaysInMonth(new Date(input.date))'],
	['Days in a year', { date }, 'return m.getDaysInYear(new Date(input.date))'],
	['ISO week number', { date }, 'return m.getISOWeek(new Date(input.date))'],
	['Day of year', { date }, 'return m.getDayOfYear(new Date(input.date))'],
	['Calendar quarter', { date }, 'return m.getQuarter(new Date(input.date))'],
	['Is a weekend', { date }, 'return m.isWeekend(new Date(input.date))'],
	['Is a leap year', { date: '2028-02-01' }, 'return m.isLeapYear(new Date(input.date))'],
	[
		'Is within an interval',
		{ date, start: '2026-03-01', end: '2026-04-01' },
		'return m.isWithinInterval(new Date(input.date), {start: new Date(input.start), end: new Date(input.end)})'
	],
	[
		'List days in an interval',
		{ start: '2026-03-01', end: '2026-03-07' },
		'return m.eachDayOfInterval({start: new Date(input.start), end: new Date(input.end)}).map(d => m.format(d,"yyyy-MM-dd"))'
	],
	['List weekends in a month', { date }, 'return m.eachWeekendOfMonth(new Date(input.date)).map(d => m.format(d,"yyyy-MM-dd"))'],
	[
		'List month boundaries',
		{ start: '2026-01-01', end: '2026-06-30' },
		'return m.eachMonthOfInterval({start:new Date(input.start),end:new Date(input.end)}).map(d=>m.format(d,"yyyy-MM-dd"))'
	],
	[
		'Find closest date',
		{ date, values: ['2026-03-01', '2026-03-15', '2026-04-01'] },
		'return m.closestTo(new Date(input.date), input.values.map(x=>new Date(x)))'
	],
	['Earliest date', { values: ['2026-03-01', '2025-12-25', '2026-04-01'] }, 'return m.min(input.values.map(x=>new Date(x)))'],
	['Latest date', { values: ['2026-03-01', '2025-12-25', '2026-04-01'] }, 'return m.max(input.values.map(x=>new Date(x)))'],
	['Format a duration', { hours: 2, minutes: 35 }, 'return m.formatDuration(input)'],
	...['Days', 'Weeks', 'Months', 'Years', 'Hours', 'Minutes', 'BusinessDays', 'Quarters'].map(
		(unit) =>
			[
				`Add ${unit.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`,
				{ date, amount: 3 },
				`return m.add${unit}(new Date(input.date), input.amount)`
			] as Recipe
	),
	...['Days', 'Weeks', 'Months', 'Years', 'Hours', 'Minutes'].map(
		(unit) => [`Subtract ${unit.toLowerCase()}`, { date, amount: 2 }, `return m.sub${unit}(new Date(input.date), input.amount)`] as Recipe
	),
	...['Day', 'Week', 'Month', 'Quarter', 'Year', 'Hour', 'Minute', 'ISOWeek'].map(
		(unit) => [`Start of ${unit.toLowerCase()}`, { date }, `return m.startOf${unit}(new Date(input.date))`] as Recipe
	),
	...['Day', 'Week', 'Month', 'Quarter', 'Year', 'Hour', 'Minute', 'ISOWeek'].map(
		(unit) => [`End of ${unit.toLowerCase()}`, { date }, `return m.endOf${unit}(new Date(input.date))`] as Recipe
	),
	...['Days', 'Weeks', 'Months', 'Years', 'Hours', 'Minutes', 'BusinessDays', 'CalendarDays'].map(
		(unit) =>
			[
				`Difference in ${unit.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`,
				{ date, other: '2025-11-02T09:00:00Z' },
				`return m.differenceIn${unit}(new Date(input.date), new Date(input.other))`
			] as Recipe
	)
];

const math: Recipe[] = [
	['Evaluate an expression', { expression: 'sqrt(3^2 + 4^2)' }, 'return m.evaluate(input.expression)'],
	['Convert units', { value: 42, from: 'km', to: 'mile' }, 'return m.unit(input.value,input.from).to(input.to).toString()'],
	['Convert temperature', { value: 23, from: 'degC', to: 'degF' }, 'return m.unit(input.value,input.from).to(input.to).toString()'],
	['Exact fractions', { numerator: 2, denominator: 3 }, 'return m.fraction(input.numerator,input.denominator).toFraction()'],
	['Complex multiplication', { a: '2 + 3i', b: '4 - i' }, 'return m.multiply(m.complex(input.a),m.complex(input.b)).toString()'],
	[
		'Matrix multiplication',
		{
			a: [
				[1, 2],
				[3, 4]
			],
			b: [
				[2, 0],
				[1, 2]
			]
		},
		'return m.multiply(input.a,input.b)'
	],
	[
		'Matrix inverse',
		{
			a: [
				[4, 7],
				[2, 6]
			]
		},
		'return m.inv(input.a)'
	],
	[
		'Matrix determinant',
		{
			a: [
				[4, 7],
				[2, 6]
			]
		},
		'return m.det(input.a)'
	],
	[
		'Transpose rows',
		{
			a: [
				[1, 2, 3],
				[4, 5, 6]
			]
		},
		'return m.transpose(input.a)'
	],
	[
		'Solve linear equations',
		{
			a: [
				[2, 1],
				[1, -1]
			],
			b: [5, 1]
		},
		'return m.lusolve(input.a,input.b)'
	],
	['Symbolic derivative', { expression: 'x^3 + 2*x', variable: 'x' }, 'return m.derivative(input.expression,input.variable).toString()'],
	['Simplify algebra', { expression: '2*x + 3*x + 0' }, 'return m.simplify(input.expression).toString()'],
	['Cross product', { a: [1, 0, 0], b: [0, 1, 0] }, 'return m.cross(input.a,input.b)'],
	['Dot product', { a: [1, 2, 3], b: [4, 5, 6] }, 'return m.dot(input.a,input.b)'],
	['Vector norm', { values: [3, 4] }, 'return m.norm(input.values)'],
	['Precision decimal addition', { a: '0.1', b: '0.2' }, 'return m.add(m.bignumber(input.a),m.bignumber(input.b)).toString()'],
	['Format scientific notation', { value: 1234567, precision: 4 }, 'return m.format(input.value,{notation:"exponential",precision:input.precision})'],
	['Combinations', { n: 10, k: 3 }, 'return m.combinations(input.n,input.k)'],
	['Permutations', { n: 10, k: 3 }, 'return m.permutations(input.n,input.k)'],
	['Greatest common divisor', { a: 48, b: 18 }, 'return m.gcd(input.a,input.b)'],
	['Least common multiple', { a: 12, b: 18 }, 'return m.lcm(input.a,input.b)'],
	['Hypotenuse', { a: 3, b: 4 }, 'return m.hypot(input.a,input.b)'],
	['Logarithm in a base', { value: 1024, base: 2 }, 'return m.log(input.value,input.base)'],
	['Modulo', { value: -7, divisor: 5 }, 'return m.mod(input.value,input.divisor)'],
	['Power', { value: 2, exponent: 10 }, 'return m.pow(input.value,input.exponent)'],
	...[
		['abs', -42],
		['ceil', 3.2],
		['floor', 3.8],
		['round', 3.6],
		['sqrt', 81],
		['cbrt', 27],
		['exp', 2],
		['log10', 1000],
		['log2', 256],
		['sin', 0.5],
		['cos', 0.5],
		['tan', 0.5],
		['asin', 0.5],
		['acos', 0.5],
		['atan', 1],
		['sign', -12],
		['factorial', 7]
	].map(([fn, value]) => [`Calculate ${fn}`, { value }, `return m.${fn}(input.value)`] as Recipe),
	...['sum', 'mean', 'median', 'mode', 'std', 'variance', 'min', 'max', 'prod'].map(
		(fn) => [`Calculate ${fn} of a list`, { values: numbers }, `return m.${fn}(input.values)`] as Recipe
	)
];

const arrays: Recipe[] = [
	...['min', 'max', 'extent', 'sum', 'mean', 'median', 'mode', 'variance', 'deviation', 'cumsum', 'ascending', 'descending']
		.filter((x) => !['ascending', 'descending'].includes(x))
		.map((fn) => [`Summarize ${fn}`, { values: numbers }, `return m.${fn}(input.values)`] as Recipe),
	['Quantiles', { values: numbers, p: 0.75 }, 'return m.quantile(input.values,input.p)'],
	['Numeric range', { start: 0, end: 1, step: 0.1 }, 'return m.range(input.start,input.end,input.step)'],
	['Chart ticks', { start: 0, end: 97, count: 5 }, 'return m.ticks(input.start,input.end,input.count)'],
	['Tick spacing', { start: 0, end: 97, count: 5 }, 'return m.tickStep(input.start,input.end,input.count)'],
	[
		'Histogram bins',
		{ values: [1, 1, 2, 3, 4, 5, 5, 8, 9, 10], thresholds: 4 },
		'return m.bin().thresholds(input.thresholds)(input.values).map(b=>({from:b.x0,to:b.x1,count:b.length}))'
	],
	['Adjacent pairs', { values: [1, 4, 9, 16] }, 'return m.pairs(input.values)'],
	['Cartesian product', { a: ['S', 'M', 'L'], b: ['black', 'white'] }, 'return m.cross(input.a,input.b)'],
	[
		'Transpose a table',
		{
			rows: [
				[1, 2, 3],
				[4, 5, 6]
			]
		},
		'return m.transpose(input.rows)'
	],
	['Merge arrays', { rows: [[1, 2], [3, 4], [5]] }, 'return m.merge(input.rows)'],
	['Group by category', { people }, 'return Array.from(m.group(input.people,d=>d.team))'],
	['Roll up totals', { people }, 'return Array.from(m.rollup(input.people,v=>m.sum(v,d=>d.score),d=>d.team))'],
	['Sort by score', { people }, 'return m.sort(input.people,d=>d.score)'],
	['Rank scores', { values: [50, 10, 30, 30] }, 'return Array.from(m.rank(input.values))'],
	['Least record', { people }, 'return m.least(input.people,d=>d.score)'],
	['Greatest record', { people }, 'return m.greatest(input.people,d=>d.score)'],
	['Set union', { a: [1, 2], b: [2, 3] }, 'return Array.from(m.union(input.a,input.b))'],
	['Set intersection', { a: [1, 2], b: [2, 3] }, 'return Array.from(m.intersection(input.a,input.b))'],
	['Set difference', { a: [1, 2, 3], b: [2] }, 'return Array.from(m.difference(input.a,input.b))'],
	['Superset check', { a: [1, 2, 3], b: [1, 2] }, 'return m.superset(input.a,input.b)'],
	['Disjoint check', { a: [1, 2], b: [3, 4] }, 'return m.disjoint(input.a,input.b)']
];

export const PACKAGE_EXAMPLES = [
	...library('lodash-es', '4.17.21', 'Data & collections', 'https://lodash.com/docs/4.17.21', lodash),
	...library('date-fns', '4.1.0', 'Dates & time', 'https://date-fns.org/docs/Getting-Started', dates),
	...library('mathjs', '14.8.1', 'Math & science', 'https://mathjs.org/docs/reference/functions.html', math),
	...library('d3-array', '3.2.4', 'Charts & statistics', 'https://d3js.org/d3-array', arrays)
];
