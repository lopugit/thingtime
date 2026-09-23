import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const playwright = process.env.TT_PLAYWRIGHT_MODULE;
test('late template defaults update untouched fields without erasing drafts', { skip: !playwright }, async () => {
	const require = createRequire(import.meta.url);
	const { build } = await import('vite');
	const fixtureId = fileURLToPath(new URL('./__template-field-fixture.js', import.meta.url));
	const fixtureSource = `
import React from ${JSON.stringify(require.resolve('react'))};
import ReactDOM from ${JSON.stringify(require.resolve('react-dom/client'))};
import { HtmlTemplateField } from ${JSON.stringify(fileURLToPath(new URL('./HtmlTemplateField.tsx', import.meta.url)))};
function Harness(){
 const [version,setVersion]=React.useState(0);
 const versions=[{language:'',text:'',checked:false},{language:'html',text:'server text',checked:true},{language:'css',text:'new text',checked:false}];
 const value=versions[version];
 return React.createElement('main',null,
  React.createElement(HtmlTemplateField,{tag:'select',fieldProps:{'aria-label':'Language',defaultValue:value.language}},['','html','css','javascript'].map(v=>React.createElement('option',{key:v,value:v},v||'All'))),
  React.createElement(HtmlTemplateField,{tag:'input',fieldProps:{'aria-label':'Search',defaultValue:value.text}}),
  React.createElement(HtmlTemplateField,{tag:'textarea',fieldProps:{'aria-label':'Notes',defaultValue:value.text}}),
  React.createElement(HtmlTemplateField,{tag:'input',fieldProps:{'aria-label':'Enabled',type:'checkbox',defaultChecked:value.checked}}),
  React.createElement('button',{onClick:()=>setVersion(1)},'Late response'),
  React.createElement('button',{onClick:()=>setVersion(2)},'Next response'),
  React.createElement('p',{id:'version'},version));
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;
	const bundle = await build({
		configFile: false,
		logLevel: 'error',
		define: { 'process.env.NODE_ENV': JSON.stringify('production') },
		plugins: [
			{
				name: 'template-field-fixture',
				enforce: 'pre',
				resolveId(id) {
					if (id === fixtureId) return '\0' + id;
				},
				load(id) {
					if (id === '\0' + fixtureId) return fixtureSource;
				}
			}
		],
		build: { write: false, minify: false, lib: { entry: fixtureId, name: 'TemplateFieldFixture', formats: ['iife'] } }
	});
	const output = (Array.isArray(bundle) ? bundle[0] : bundle) as { output: Array<{ type: string; code?: string }> };
	const code = output.output.find((item) => item.type === 'chunk')?.code;
	assert.ok(code);
	const { chromium } = await import(playwright!);
	const browser = await chromium.launch({ channel: 'chrome', headless: true });
	try {
		const page = await browser.newPage();
		page.setDefaultTimeout(60000);
		const errors: string[] = [];
		page.on('pageerror', (error: Error) => {
			errors.push(error.message);
			console.error('Template field fixture:', error.message);
		});
		await page.route('**/__template-fields.js', (route: any) => route.fulfill({ contentType: 'text/javascript', body: code }));
		await page.route('**/__template-fields', (route: any) =>
			route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div><script src="/__template-fields.js"></script>' })
		);
		await page.goto('http://127.0.0.1/__template-fields', { waitUntil: 'domcontentloaded' });
		await page.getByLabel('Search').fill('visitor draft');
		await page.getByLabel('Notes').fill('notes draft');
		await page.getByRole('button', { name: 'Late response', exact: true }).click();
		await page.locator('#version').filter({ hasText: '1' }).waitFor();
		assert.equal(await page.getByLabel('Language').inputValue(), 'html');
		assert.equal(await page.getByLabel('Search').inputValue(), 'visitor draft');
		assert.equal(await page.getByLabel('Notes').inputValue(), 'notes draft');
		assert.equal(await page.getByLabel('Enabled').isChecked(), true);
		await page.getByLabel('Language').selectOption('javascript');
		await page.getByRole('button', { name: 'Next response', exact: true }).click();
		await page.locator('#version').filter({ hasText: '2' }).waitFor();
		assert.equal(await page.getByLabel('Language').inputValue(), 'javascript', 'late data preserves a changed selection');
		assert.equal(await page.getByLabel('Enabled').isChecked(), false);
		assert.deepEqual(errors, []);
	} finally {
		await browser.close();
	}
});
