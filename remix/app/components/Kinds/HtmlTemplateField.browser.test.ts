import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const playwright = process.env.TT_PLAYWRIGHT_MODULE;
test('template fields preserve drafts and multiple selections remain editable and submittable', { skip: !playwright }, async () => {
	const require = createRequire(import.meta.url);
	const { build } = await import('vite');
	const fixtureId = fileURLToPath(new URL('./__template-field-fixture.js', import.meta.url));
	const fixtureSource = `
import React from ${JSON.stringify(require.resolve('react'))};
import ReactDOM from ${JSON.stringify(require.resolve('react-dom/client'))};
import { HtmlTemplateField } from ${JSON.stringify(fileURLToPath(new URL('./HtmlTemplateField.tsx', import.meta.url)))};
import { HtmlMultipleSelect, HtmlSelectOption } from ${JSON.stringify(fileURLToPath(new URL('./HtmlMultipleSelect.tsx', import.meta.url)))};
function Harness(){
 const [version,setVersion]=React.useState(0);
 const [render,setRender]=React.useState(0);
 const [submitted,setSubmitted]=React.useState(null);
 const [projects,setProjects]=React.useState(null);
 const versions=[{language:'',text:'',checked:false},{language:'html',text:'server text',checked:true},{language:'css',text:'new text',checked:false}];
 const value=versions[Math.min(version,2)];
 const topics=[undefined,['html','css'],['css']][Math.min(version,2)];
 return React.createElement('main',null,
  React.createElement(HtmlTemplateField,{tag:'select',fieldProps:{'aria-label':'Language',defaultValue:value.language}},['','html','css','javascript'].map(v=>React.createElement('option',{key:v,value:v},v||'All'))),
  React.createElement(HtmlTemplateField,{tag:'select',fieldProps:{'aria-label':'Topics',multiple:true,defaultValue:topics}},['html','css','javascript'].map(v=>React.createElement('option',{key:v,value:v},v))),
  React.createElement(HtmlTemplateField,{tag:'select',fieldProps:{'aria-label':'Untouched topics',multiple:true,defaultValue:topics}},['html','css','javascript'].map(v=>React.createElement('option',{key:v,value:v},v))),
  React.createElement(HtmlTemplateField,{tag:'input',fieldProps:{'aria-label':'Search',defaultValue:value.text}}),
  React.createElement(HtmlTemplateField,{tag:'textarea',fieldProps:{'aria-label':'Notes',defaultValue:value.text}}),
  React.createElement(HtmlTemplateField,{tag:'input',fieldProps:{'aria-label':'Enabled',type:'checkbox',defaultChecked:value.checked}}),
  React.createElement(HtmlTemplateField,{tag:'select',fieldProps:{'aria-label':'Early edited topics',multiple:true,defaultValue:topics}},['html','css','javascript'].map(v=>React.createElement('option',{key:v,value:v},v))),
  React.createElement('button',{onClick:()=>setRender(render+1)},'Rerender'),
  React.createElement('form',{onSubmit:event=>{event.preventDefault();const fields=new FormData(event.currentTarget);setSubmitted(fields.getAll('levels'));setProjects(fields.getAll('projects'));}},
   React.createElement(HtmlMultipleSelect,{props:{name:'levels','aria-label':'Task level',required:version===1,value:version===3?undefined:version===2?'[]':'top-level'}},
    [['','All tasks'],['top-level','Top level'],['subtasks','Subtasks']].map(([value,label])=>React.createElement(HtmlSelectOption,{key:value,props:{value}},label))),
   React.createElement(HtmlMultipleSelect,{props:{name:'projects','aria-label':'Project',value:version===2?'["project,a"," project b "]':undefined}},
    React.createElement(HtmlSelectOption,{props:{value:'retired',selected:true,disabled:true}},'Retired'),
    React.createElement(HtmlSelectOption,{props:{value:'project,a',selected:true}},'Project A'),
    React.createElement(HtmlSelectOption,{props:{value:' project b '}},'Project B')),
   React.createElement(HtmlMultipleSelect,{props:{name:'draftTopics','aria-label':'Draft topics',defaultValue:topics}},
    [['html','Draft HTML'],['css','Draft CSS'],['javascript','Draft JavaScript']].map(([value,label])=>React.createElement(HtmlSelectOption,{key:value,props:{value}},label))),
   React.createElement(HtmlMultipleSelect,{props:{name:'untouchedTopics','aria-label':'Untouched filter',defaultValue:topics}},
    ['html','css','javascript'].map(value=>React.createElement(HtmlSelectOption,{key:value,props:{value}},value))),
   React.createElement('button',{type:'submit'},'Apply'),
   React.createElement('output',{id:'submitted'},JSON.stringify(submitted)),
   React.createElement('output',{id:'projects'},JSON.stringify(projects))),
  React.createElement('button',{onClick:()=>setVersion(1)},'Late response'),
  React.createElement('button',{onClick:()=>setVersion(2)},'Next response'),
  React.createElement('button',{onClick:()=>setVersion(3)},'Clear query'),
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
	const browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true });
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
		const levels = () => page.getByRole('button', { name: /^Task level:/ });
		await levels().click();
		const topLevel = page.getByRole('checkbox', { name: 'Top level', exact: true });
		const subtasks = page.getByRole('checkbox', { name: 'Subtasks', exact: true });
		assert.equal(await topLevel.isChecked(), true);
		await subtasks.check();
		assert.equal(await topLevel.isChecked(), true);
		assert.equal(await levels().getAttribute('aria-label'), 'Task level: 2 selected');
		await subtasks.press('Escape');
		assert.equal(await levels().getAttribute('aria-expanded'), 'false');
		assert.equal(await levels().evaluate(element => element === document.activeElement), true);
		await page.getByRole('button', { name: 'Apply', exact: true }).click();
		assert.equal(await page.locator('#submitted').textContent(), '["top-level","subtasks"]');
		assert.equal(await page.locator('#projects').textContent(), '["project,a"]');
		await page.getByRole('button', { name: /^Project:/ }).click();
		const retired = page.getByRole('checkbox', { name: 'Retired' });
		assert.equal(await retired.isDisabled(), true);
		assert.equal(await retired.isChecked(), true);
		assert.equal(await page.getByRole('checkbox', { name: 'Project A' }).isChecked(), true);
		await page.keyboard.press('Escape');
		await page.setViewportSize({ width: 320, height: 560 });
		await levels().press('Enter');
		const all = page.getByRole('checkbox', { name: 'All tasks', exact: true });
		const popup = await page.getByRole('group', { name: 'Task level' }).boundingBox();
		assert.ok(popup && popup.x >= 0 && popup.x + popup.width <= 320);
		await all.check();
		assert.equal(await topLevel.isChecked(), false);
		assert.equal(await subtasks.isChecked(), false);
		await all.press('Escape');
		await page.getByRole('button', { name: 'Apply', exact: true }).click();
		assert.equal(await page.locator('#submitted').textContent(), '[]');
		await page.getByLabel('Search').fill('visitor draft');
		await page.getByLabel('Notes').fill('notes draft');
		await page.getByLabel('Early edited topics', { exact: true }).selectOption(['javascript']);
		await page.getByRole('button', { name: 'Rerender', exact: true }).click();
		await page.getByRole('button', { name: 'Late response', exact: true }).click();
		await page.locator('#version').filter({ hasText: '1' }).waitFor();
		assert.equal(await page.getByLabel('Language').inputValue(), 'html');
		assert.equal(await page.getByLabel('Search').inputValue(), 'visitor draft');
		assert.equal(await page.getByLabel('Notes').inputValue(), 'notes draft');
		assert.equal(await page.getByLabel('Enabled').isChecked(), true);
		const selectedTopics = (name: string) => page.getByLabel(name, { exact: true }).evaluate((select: HTMLSelectElement) =>
			Array.from(select.selectedOptions, (option) => option.value));
		assert.deepEqual(await selectedTopics('Topics'), ['html', 'css']);
		assert.deepEqual(await selectedTopics('Early edited topics'), ['javascript'], 'a rerender without defaults does not redefine the baseline');
		await page.getByLabel('Topics', { exact: true }).selectOption(['html', 'javascript']);
		await page.getByRole('button', { name: 'Apply', exact: true }).click();
		assert.equal(await page.getByRole('alert').textContent(), 'Choose at least one option.');
		assert.equal(await levels().evaluate(element => element === document.activeElement), true);
		const submittedTopics = (name: string) => page.locator(`select[name="${name}"]`).evaluate((select: HTMLSelectElement) =>
			Array.from(select.selectedOptions, (option) => option.value));
		assert.deepEqual(await submittedTopics('draftTopics'), ['html', 'css']);
		await page.getByRole('button', { name: /^Draft topics:/ }).click();
		await page.getByRole('checkbox', { name: 'Draft JavaScript', exact: true }).check();
		await page.getByRole('checkbox', { name: 'Draft CSS', exact: true }).uncheck();
		await page.keyboard.press('Escape');
		await levels().click();
		await subtasks.check();
		await subtasks.press('Escape');
		assert.deepEqual(await submittedTopics('levels'), ['subtasks']);
		await page.getByLabel('Language').selectOption('javascript');
		await page.getByRole('button', { name: 'Next response', exact: true }).click();
		await page.locator('#version').filter({ hasText: '2' }).waitFor();
		assert.equal(await page.getByLabel('Language').inputValue(), 'javascript', 'late data preserves a changed selection');
		assert.equal(await page.getByLabel('Enabled').isChecked(), false);
		assert.deepEqual(await selectedTopics('Topics'), ['html', 'javascript'], 'the second changed selection is not erased');
		assert.deepEqual(await selectedTopics('Untouched topics'), ['css'], 'an unchanged selection adopts refreshed defaults');
		assert.equal(await levels().getAttribute('aria-label'), 'Task level: All tasks');
		assert.deepEqual(await submittedTopics('levels'), [], 'an explicit query binding resets the prior draft');
		assert.deepEqual(await submittedTopics('draftTopics'), ['html', 'javascript'], 'typed defaults preserve an edited picker');
		assert.deepEqual(await submittedTopics('untouchedTopics'), ['css'], 'an untouched picker adopts typed defaults');
		await page.getByRole('button', { name: /^Draft topics:/ }).click();
		await page.getByRole('checkbox', { name: 'Draft CSS', exact: true }).check();
		await page.keyboard.press('Escape');
		assert.deepEqual(await submittedTopics('draftTopics'), ['html', 'css', 'javascript'], 'submission follows option order');
		await page.getByRole('button', { name: 'Apply', exact: true }).click();
		assert.equal(await page.locator('#projects').textContent(), '["project,a"," project b "]');
		await levels().click();
		await subtasks.check();
		await subtasks.press('Escape');
		await page.getByRole('button', { name: 'Clear query', exact: true }).click();
		assert.deepEqual(await submittedTopics('levels'), [], 'removing the authoritative query key also resets the draft');
		assert.deepEqual(errors, []);
	} finally {
		await browser.close();
	}
});
