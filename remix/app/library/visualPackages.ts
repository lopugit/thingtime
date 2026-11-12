import { library, type Recipe } from './types';

const chart = (type: string, options = {}, dataset = {}) =>
	`const canvas=document.createElement("canvas");root.append(canvas);new m.Chart(canvas,{type:${JSON.stringify(
		type
	)},data:{labels:input.labels,datasets:[{label:input.label,data:input.values,backgroundColor:["#6366f1","#a78bfa","#f472b6","#2dd4bf","#fbbf24"],borderColor:"#6366f1",...${JSON.stringify(
		dataset
	)}}]},options:{responsive:true,maintainAspectRatio:false,animation:false,...${JSON.stringify(options)}}});return {points:input.values.length}`;
const chartInput = { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], values: [12, 19, 7, 15, 22], label: 'Activity' };
const charts: Recipe[] = [
	['Bar chart', chartInput, chart('bar')],
	['Horizontal bars', chartInput, chart('bar', { indexAxis: 'y' })],
	['Line chart', chartInput, chart('line', {}, { tension: 0.3 })],
	['Area chart', chartInput, chart('line', {}, { fill: true, tension: 0.3 })],
	['Stepped line', chartInput, chart('line', {}, { stepped: true })],
	['Doughnut chart', chartInput, chart('doughnut', { cutout: '65%' })],
	['Pie chart', chartInput, chart('pie')],
	['Polar area chart', chartInput, chart('polarArea')],
	['Radar chart', chartInput, chart('radar')],
	[
		'Scatter plot',
		{
			labels: [],
			label: 'Samples',
			values: [
				{ x: 1, y: 2 },
				{ x: 2, y: 5 },
				{ x: 3, y: 3 },
				{ x: 4, y: 8 }
			]
		},
		chart('scatter')
	],
	[
		'Bubble chart',
		{
			labels: [],
			label: 'Samples',
			values: [
				{ x: 1, y: 2, r: 8 },
				{ x: 2, y: 5, r: 14 },
				{ x: 3, y: 3, r: 10 }
			]
		},
		chart('bubble')
	],
	['Logarithmic scale', { ...chartInput, values: [1, 10, 100, 1000, 10000] }, chart('line', { scales: { y: { type: 'logarithmic' } } })],
	['Rounded bars', chartInput, chart('bar', {}, { borderRadius: 10 })],
	[
		'Floating bars',
		{
			labels: ['Design', 'Build', 'Test'],
			label: 'Schedule',
			values: [
				[1, 4],
				[3, 8],
				[7, 10]
			]
		},
		chart('bar', { indexAxis: 'y' })
	],
	['Half doughnut', { labels: ['Used', 'Free'], label: 'Capacity', values: [65, 35] }, chart('doughnut', { rotation: -90, circumference: 180 })]
];
const diagrams: Recipe[] = [
	['Flowchart', { text: 'flowchart LR\n A[Idea] --> B[Build]\n B --> C[Test]\n C --> D[Share]' }],
	[
		'Sequence diagram',
		{ text: 'sequenceDiagram\n Browser->>Server: Request\n Server->>Provider: Fetch\n Provider-->>Server: Data\n Server-->>Browser: Result' }
	],
	['State machine', { text: 'stateDiagram-v2\n [*] --> Draft\n Draft --> Published\n Published --> Archived' }],
	['Entity relationship', { text: 'erDiagram\n USER ||--o{ POST : writes\n POST ||--o{ COMMENT : contains' }],
	['Class diagram', { text: 'classDiagram\n class Thing {\n +String id\n +String title\n +save()\n }\n Thing <|-- Component' }],
	['Pie diagram', { text: 'pie title Time spent\n "Build" : 55\n "Design" : 30\n "Test" : 15' }],
	[
		'Gantt schedule',
		{ text: 'gantt\n title A small project\n dateFormat YYYY-MM-DD\n section Work\n Design :a1, 2026-03-01, 3d\n Build :after a1, 5d' }
	],
	[
		'User journey',
		{ text: 'journey\n title First visit\n section Browse\n Find an example: 5: Visitor\n Run the demo: 5: Visitor\n Save a copy: 4: Visitor' }
	],
	['Git history', { text: 'gitGraph\n commit\n branch feature\n checkout feature\n commit\n checkout main\n merge feature' }],
	['Mind map', { text: 'mindmap\n root((Library))\n  Things\n  Actions\n  Components' }]
].map(
	([title, input]) =>
		[
			title,
			input,
			'm.default.initialize({startOnLoad:false,securityLevel:"strict",theme:"neutral"});const {svg}=await m.default.render("diagram",input.text);root.innerHTML=svg;return "Diagram rendered"'
		] as Recipe
);
const markdown: Recipe[] = [
	['Markdown headings', { text: '# Hello\n## A smaller heading\nA paragraph.' }],
	['Markdown lists', { text: '- Things\n- Actions\n- Components\n\n1. Browse\n2. Run\n3. Reuse' }],
	['Markdown table', { text: '| Library | Purpose |\n|---|---|\n| D3 | Charts |\n| Zod | Validation |' }],
	['Markdown code', { text: '```js\nconst message = "Hello";\n```' }],
	['Markdown links', { text: 'Read the [Thingtime library](https://thingtime.com/library).' }],
	['Markdown quote', { text: '> Small pieces, composed together.\n\n**Make** something *useful*.' }]
].map(
	([title, input]) => [title, input, 'root.innerHTML=m.marked.parse(input.text);return "Markdown rendered inside the isolated preview"'] as Recipe
);
export const VISUAL_EXAMPLES = [
	...library('chart.js/auto', '4.5.0', 'Charts & statistics', 'https://www.chartjs.org/docs/latest/', charts, true).map((x) => ({
		...x,
		provider: 'Chart.js',
		module: 'https://esm.sh/chart.js@4.5.0/auto?bundle'
	})),
	...library('mermaid', '11.9.0', 'Diagrams', 'https://mermaid.js.org/intro/', diagrams, true),
	...library('marked', '16.2.1', 'Files & text', 'https://marked.js.org/', markdown, true),
	...library(
		'qrcode',
		'1.5.4',
		'Media & graphics',
		'https://github.com/soldair/node-qrcode',
		[
			[
				'Website QR code',
				{ text: 'https://thingtime.com' },
				'const canvas=document.createElement("canvas");root.append(canvas);await m.default.toCanvas(canvas,input.text,{width:240});return "Scan to open the website"'
			],
			[
				'Contact QR code',
				{ text: 'BEGIN:VCARD\nVERSION:3.0\nFN:Maya Example\nEMAIL:maya@example.com\nEND:VCARD' },
				'const canvas=document.createElement("canvas");root.append(canvas);await m.default.toCanvas(canvas,input.text,{width:240});return "Contact card encoded"'
			],
			[
				'WiFi QR code',
				{ text: 'WIFI:T:WPA;S:Example Network;P:example-password;;' },
				'const canvas=document.createElement("canvas");root.append(canvas);await m.default.toCanvas(canvas,input.text,{width:240});return "Use sample credentials only in this demo"'
			],
			[
				'Coloured QR code',
				{ text: 'Hello Thingtime', dark: '#4338ca', light: '#eef2ff' },
				'const canvas=document.createElement("canvas");root.append(canvas);await m.default.toCanvas(canvas,input.text,{width:240,color:{dark:input.dark,light:input.light}});return "QR code rendered"'
			]
		],
		true
	),
	...library(
		'three',
		'0.179.1',
		'3D & graphics',
		'https://threejs.org/docs/',
		['Box', 'Sphere', 'Torus', 'Cone', 'Cylinder', 'TorusKnot', 'Icosahedron', 'Octahedron', 'Dodecahedron', 'Tetrahedron'].map(
			(shape) =>
				[
					`${shape} in 3D`,
					{ rotation: 0.5 },
					`const scene=new m.Scene();scene.background=new m.Color("#f6f6f8");const camera=new m.PerspectiveCamera(50,root.clientWidth/280,0.1,100);camera.position.z=4;const renderer=new m.WebGLRenderer({antialias:true});renderer.setSize(root.clientWidth,280);root.append(renderer.domElement);const geometry=new m.${shape}Geometry();const material=new m.MeshNormalMaterial();const mesh=new m.Mesh(geometry,material);mesh.rotation.set(input.rotation,input.rotation,0);scene.add(mesh);renderer.render(scene,camera);return {vertices:geometry.attributes.position.count}`
				] as Recipe
		),
		true
	),
	...library('d3-scale', '4.0.2', 'Charts & statistics', 'https://d3js.org/d3-scale', [
		[
			'Linear scale',
			{ domain: [0, 100], range: [0, 640], values: [0, 25, 50, 75, 100] },
			'const s=m.scaleLinear(input.domain,input.range);return input.values.map(value=>({value,pixel:s(value)}))'
		],
		[
			'Log scale',
			{ domain: [1, 1000], range: [0, 600], values: [1, 10, 100, 1000] },
			'const s=m.scaleLog(input.domain,input.range);return input.values.map(value=>({value,pixel:s(value)}))'
		],
		[
			'Square root scale',
			{ domain: [0, 100], range: [0, 50], values: [0, 25, 50, 100] },
			'const s=m.scaleSqrt(input.domain,input.range);return input.values.map(value=>({value,radius:s(value)}))'
		],
		[
			'Ordinal colours',
			{ labels: ['Design', 'Build', 'Test'], colors: ['#6366f1', '#f472b6', '#2dd4bf'] },
			'const s=m.scaleOrdinal(input.labels,input.colors);return input.labels.map(label=>({label,color:s(label)}))'
		],
		[
			'Band positions',
			{ labels: ['A', 'B', 'C'], width: 600 },
			'const s=m.scaleBand(input.labels,[0,input.width]).padding(0.1);return input.labels.map(label=>({label,x:s(label),width:s.bandwidth()}))'
		],
		[
			'Quantize thresholds',
			{ domain: [0, 100], labels: ['low', 'medium', 'high'], values: [12, 42, 87] },
			'const s=m.scaleQuantize(input.domain,input.labels);return input.values.map(value=>({value,group:s(value)}))'
		],
		[
			'Threshold labels',
			{ thresholds: [18, 65], labels: ['child', 'adult', 'senior'], values: [10, 35, 80] },
			'const s=m.scaleThreshold(input.thresholds,input.labels);return input.values.map(value=>({value,group:s(value)}))'
		],
		['Invert pixel position', { domain: [0, 100], range: [0, 640], pixel: 320 }, 'return m.scaleLinear(input.domain,input.range).invert(input.pixel)']
	])
];
