import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';
const root = resolve(import.meta.dirname, '..'),
	port = 28213,
	evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-device-sync-ui')),
	require = createRequire(join(root, '../MCP/package.json'));
if (!process.env.TT_DEVICE_SYNC_UI_WORKER) {
	const dir = await mkdtemp(join(tmpdir(), 'thingtime-device-sync-ui-'));
	try {
		let source = await readFile(join(root, 'scripts/mobile-sync-editor.browser.tsx'), 'utf8');
		source = `import {ThingParentPaths,parentPathBlocks} from '../app/components/Things/ThingParentPaths';\nimport {ThingFileLocation} from '../app/components/Things/ThingFileLocation';\nimport {UnfiledAttachmentsPage} from '../app/components/Things/UnfiledAttachmentsPage';\nimport {DeviceSyncPanel,DeviceSyncBrowser} from '../app/components/Devices/DeviceSyncBrowser';\nimport {DeviceCard} from '../app/components/Devices/DeviceCard';\nimport {DeviceDetailsDrawer} from '../app/components/Devices/DeviceDetailsDrawer';\n${source}`;
		source = source.replace('element: <Fixture />', 'element: <DeviceBrowserFixture />');
		source = source
			.replace(
				"if (desktop && (taskQA || homeQA) && url.pathname === '/api/v1/webpages/resolve') {",
				"if (url.pathname === '/api/v1/webpages/resolve') {"
			)
			.replace(
				"url.origin !== location.origin || headers.get('X-Thingtime-Expected-Api-Origin') !== canonicalOrigin ||\n\t\t\theaders",
				"url.origin !== location.origin || (desktop && headers.get('X-Thingtime-Expected-Api-Origin') !== canonicalOrigin) ||\n\t\t\theaders"
			);
		source = source.replace("rows.filter((r) => r.thingtime.includes(url.searchParams.get('thingtime')))", "rows.filter((r) => !url.searchParams.get('thingtime') || r.thingtime.includes(url.searchParams.get('thingtime')))");
        source = source.replace("const method = init?.method || 'GET';", `const method = init?.method || 'GET';
          if(method==='GET'&&!url.searchParams.has('id')){
            if(!url.searchParams.get('thingtime'))(window as any).fixtureReferenceListReads=((window as any).fixtureReferenceListReads||0)+1;
            if(url.searchParams.get('thingtime')==='attachment'){
              (window as any).fixtureAttachmentPages=((window as any).fixtureAttachmentPages||0)+1;
              const matches=rows.filter(r=>r.thingtime.includes('attachment')).sort((a,b)=>a.id==='fixture-attachment'?-1:b.id==='fixture-attachment'?1:0);
              return fixtureJson({ok:true,things:url.searchParams.get('cursor')?matches.slice(1):matches.slice(0,1),nextCursor:url.searchParams.get('cursor')?null:'unfiled-second-page'});
            }
          }`);
		source += `\nfunction DeviceBrowserFixture(){parentPathBlocks[0].children.find(b=>b.id==='parent-path-actions').children.find(b=>b.id==='parent-path-scan').props['data-tt-action-inputs']=JSON.stringify({operation:'scan'});if(!rows.some(r=>r.id==='fixture-extra-attachment'))rows.push({id:'fixture-extra-attachment',thingtime:['attachment'],crystal:{name:'extra-file.txt'}});if(!rows.some(r=>r.id==='fixture-file-2'))rows.push({id:'fixture-file-2',thingtime:['file'],folderId:'cloud-backups',crystal:{name:'saved-search.svg',content:{attachmentId:'fixture-attachment'}}},{id:'cloud-backups',thingtime:['folder'],crystal:{name:'Backups'}});if(!rows.some(r=>r.id==='fixture-file'))rows.push({id:'fixture-file',thingtime:['file'],folderId:'cloud-documents',crystal:{name:'search.svg',trashed:false,content:{attachmentId:'fixture-attachment'}}},{id:'fixture-attachment',thingtime:['attachment'],folderId:null,targetId:null,crystal:{name:'search.svg',contentType:'application/octet-stream',mediaKind:'file',size:494}});const [mode,setMode]=useState('root');const [selected,setSelected]=useState(false);const summary:any={id:deviceId,name:'Test Mac',platform:'macos',serviceStatus:'stopped',pairingStatus:'paired',transportStatus:'offline',revision:1,lastSeenAt:null,capabilities:[],permissionMode:'ask'};const state:any={deviceId,summary,snapshot:null,commands:[],approvals:[],sessions:[],screenSessions:[]};return <ChakraProvider><Box maxWidth="1100px" mx="auto" p={4}><Button onClick={()=>setMode('root')}>All Things test entry</Button><Button onClick={()=>setMode('drawer')}>Open quick settings</Button><Button onClick={()=>setMode('page')}>Open settings page</Button><Button onClick={()=>setMode('sync')}>Open dedicated sync page</Button><Button onClick={()=>setMode('location')}>Open file location</Button><Button onClick={()=>setMode('origin')}>Open unpublished sync source</Button><Button onClick={()=>setMode('bound-location')}>Open recorded location</Button><Button onClick={()=>setMode('unfiled')}>Open unfiled files</Button><Button onClick={()=>setMode('parents')}>Open parent paths</Button><Text role="status">Selection: {selected?'device':'none'}</Text>{mode==='parents'?<ThingParentPaths thing={{id:'fixture-attachment',thingtime:['attachment'],crystal:{name:'search.svg'}}}/>:null}{mode==='origin'?<ThingFileLocation thing={{id:'unpublished-blob',thingtime:['attachment'],fileSyncOrigin:{version:1,deviceId,localRootId:'local-root',cloudRootId:'cloud-documents',fileId:'fixture-file',folderId:'cloud-documents',path:'Icons/search.svg'}}}/>:null}{mode==='bound-location'?<ThingFileLocation thing={{id:'bound-blob',thingtime:['attachment'],targetId:'fixture-file'}}/>:null}{mode==='sync'?<DeviceSyncPanel deviceId={deviceId} ownerId={ownerId} pairedDeviceIds={[deviceId]} ownedDeviceIds={[deviceId]}/>:mode==='location'?<ThingFileLocation thing={{id:'unbound-blob',thingtime:['attachment'],folderId:null,targetId:null,crystal:{name:'search.svg',size:494}}}/>:mode==='unfiled'?<UnfiledAttachmentsPage/>:null}{mode==='root'?<DeviceCard device={summary} selected={selected} onSelect={()=>setSelected(true)} onOpen={()=>setMode('files')} />:mode==='files'?<DeviceSyncBrowser deviceId={deviceId}/>:null}<DeviceDetailsDrawer isOpen={mode==='drawer'||mode==='page'} presentation={mode==='page'?'page':'drawer'} ownerId={ownerId} pairedDeviceIds={[deviceId]} ownedDeviceIds={[deviceId]} state={state} onClose={()=>setMode('root')}/></Box></ChakraProvider>;}\n`;
		await require('esbuild').build({
			stdin: { contents: source, loader: 'tsx', resolveDir: join(root, 'scripts') },
			bundle: true,
			format: 'esm',
			platform: 'browser',
			target: 'esnext',
			outfile: join(dir, 'fixture.js'),
			tsconfig: join(root, 'tsconfig.json'),
			define: { 'process.env.NODE_ENV': '"development"' },
			logLevel: 'error'
		});
		const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dir, TT_DEVICE_SYNC_UI_WORKER: dir };
		await verifyAccountBackupIsolation(port, env);
		const child = isolatedAccountBackupProcess(process.execPath, [import.meta.filename, evidence], { env, stdio: 'inherit' }, port, true),
			timer = setTimeout(() => child.kill('SIGTERM'), 180000);
		try {
			const [code] = await once(child, 'exit');
			assert.equal(code, 0);
		} finally {
			clearTimeout(timer);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
} else {
	const dir = process.env.TT_DEVICE_SYNC_UI_WORKER,
		bundle = await readFile(join(dir, 'fixture.js'));
	const server = createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': req.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
		res.end(
			req.url === '/fixture.js'
				? bundle
				: '<!doctype html><title>[QA] Device sync</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>'
		);
	});
	server.listen(port, '127.0.0.1');
	await once(server, 'listening');
	let context;
	const results = [],
		errors = [];
	try {
		await mkdir(evidence, { recursive: true });
		context = await require('playwright').chromium.launchPersistentContext(join(dir, 'profile'), {
			headless: true,
			downloadsPath: join(dir, 'downloads'),
			acceptDownloads: false
		});
		const page = context.pages()[0];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') console.error(m.text());
		});
		const probe = await context.newPage();
		await assert.rejects(probe.goto('http://192.0.2.1:443/blocked', { timeout: 3000 }));
		await probe.close();
		for (const [label, width, height] of [
			['desktop', 1440, 1000],
			['mobile', 375, 812]
		]) {
			if (page.url().startsWith('http://127.0.0.1:')) await page.evaluate(() => localStorage.removeItem('tt-device-drawer-layout:v1:sync-ui-device'));
			await page.setViewportSize({ width, height });
			await page.goto(`http://127.0.0.1:${port}/?home`);
			const device = page.getByRole('button', { name: 'Open Test Mac', exact: true });
			await device.waitFor();
			await device.click();
			await page.getByText('Selection: device', { exact: true }).waitFor();
			assert.equal(await page.getByRole('heading', { name: 'Device sync & backup', exact: true }).count(), 0);
			await device.dblclick();
			await page.getByRole('heading', { name: 'Device sync & backup', exact: true }).waitFor();
			const expected = await page.evaluate(
				() => window.syncInspectionFixture.savedRows().find((row) => row.thingtime?.includes('file-sync')).crystal
			);
			await page.getByRole('link', { name: expected.name, exact: true }).waitFor();
			await page.getByRole('button', { name: 'Refresh folders', exact: true }).click();
			const folder = page.getByRole('link', { name: expected.name, exact: true });
			assert.equal(new URL(await folder.getAttribute('href'), 'http://fixture').searchParams.get('folder'), expected.remoteFolderId);
			await page
				.getByText(expected.paused ? 'Saved configuration: paused' : 'Live transfer status: check this device’s sync settings', { exact: true })
				.waitFor();
			assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.captures), 0);
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			await page.screenshot({ path: join(evidence, label + '-files.png'), fullPage: true });
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
			await page.screenshot({ path: join(evidence, label + '-bottom.png') });
			await page.getByRole('button', { name: 'All Things test entry', exact: true }).click();
			await device.focus();
			await page.keyboard.press('Enter');
			await page.getByRole('heading', { name: 'Device sync & backup', exact: true }).waitFor();
			await page.getByRole('button', { name: 'Open settings page', exact: true }).click();
			await page.getByRole('button', { name: 'Expand File sync & backup', exact: true }).waitFor();
			const sections = page.locator('button[aria-expanded]');
			assert.ok((await sections.count()) > 5);
			const expanded = await sections.evaluateAll((elements) => elements.filter((e) => e.getAttribute('aria-expanded') === 'true').length);
			assert.equal(expanded, 0);
			await page.getByRole('button', { name: 'Expand File sync & backup', exact: true }).click();
			const syncLink = page.getByRole('link', { name: 'Open device sync & backup', exact: true });
			assert.equal(new URL(await syncLink.getAttribute('href'), 'http://fixture').searchParams.get('deviceView'), 'sync');
			await page.getByRole('button', { name: 'All Things test entry', exact: true }).click();
			await page.getByRole('button', { name: 'Open dedicated sync page', exact: true }).click();
			await page.getByRole('heading', { name: 'Device sync & backup', exact: true }).waitFor();
			await page.getByRole('link', { name: 'Activity manager', exact: true }).waitFor();
			const manage = page.locator('summary').filter({ hasText: 'Manage sync connections' });
			assert.equal(await manage.locator('..').evaluate((el) => el.open), false);
			await manage.click();
			assert.equal(await manage.locator('..').evaluate((el) => el.open), true);
			await manage.click();
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			await page.screenshot({ path: join(evidence, label + '-settings.png'), fullPage: true });
			assert.equal(await page.getByText('Could not load your layout.', { exact: false }).count(), 0);
			await page.getByRole('button', { name: 'Open file location', exact: true }).click();
			await page.getByText('No recorded folder location.', { exact: false }).waitFor();
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			await page.screenshot({ path: join(evidence, label + '-unbound-location.png'), fullPage: true });
            await page.getByRole('button', { name: 'Open unpublished sync source', exact: true }).click();
            await page.getByText('Original sync source path recorded before upload.', { exact: false }).waitFor();
            await page.getByRole('link', { name: 'Icons/search.svg', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.screenshot({ path: join(evidence, label + '-unpublished-source.png'), fullPage: true });
            await page.getByRole('button', { name: 'Open recorded location', exact: true }).click();
            await page.getByRole('link', { name: 'Cloud documents', exact: true }).waitFor();
            assert.equal(await page.getByRole('link', { name: 'Cloud documents', exact: true }).getAttribute('href'), '/things?folder=cloud-documents');
            await page.screenshot({ path: join(evidence, label + '-recorded-location.png'), fullPage: true });
            const referenceReads = await page.evaluate(() => window.fixtureReferenceListReads || 0);
            await page.getByRole('button', { name: 'Open parent paths', exact: true }).click();
            await page.getByRole('heading', { name: 'Referenced by · Parent paths', exact: true }).waitFor();
            await page.getByText('Additional references have not been scanned.', { exact: false }).waitFor();
            assert.equal(await page.evaluate(() => window.fixtureReferenceListReads || 0), referenceReads);
            await page.getByRole('button', { name: 'Scan / continue parent references', exact: true }).click();
            await page.getByText('owner-library scan complete', { exact: false }).waitFor({ timeout: 5000 }).catch(async error => { console.error('Parent path status:', await page.locator('[role=status]').allTextContents(), await page.getByRole('button', { name: 'Scan / continue parent references', exact: true }).evaluate(el => el.outerHTML)); await page.screenshot({ path: join(evidence, 'parent-path-failure.png'), fullPage: true }); throw error; });
            await page.getByRole('link', { name: 'Backups', exact: true }).waitFor();
            await page.getByRole('link', { name: 'Cloud documents', exact: true }).waitFor();
            assert.equal(await page.getByRole('link', { name: 'Backups', exact: true }).getAttribute('href'), '/things?folder=cloud-backups');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.screenshot({ path: join(evidence, label + '-multiple-parent-paths.png'), fullPage: true });
            const attachmentPages = await page.evaluate(() => window.fixtureAttachmentPages || 0);
            await page.getByRole('button', { name: 'Open unfiled files', exact: true }).click();
            await page.getByRole('heading', { name: 'Unfiled files', exact: true }).waitFor();
            await page.getByRole('link', { name: 'search.svg', exact: true }).waitFor();
            await page.getByText('View saved location or original sync source', { exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.fixtureAttachmentPages), attachmentPages + 1);
            await page.getByRole('button', { name: 'Load more files', exact: true }).click();
            await page.getByRole('link', { name: 'extra-file.txt', exact: true }).waitFor();
            assert.equal(await page.evaluate(() => window.fixtureAttachmentPages), attachmentPages + 2);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.screenshot({ path: join(evidence, label + '-unfiled-files.png'), fullPage: true });

			await page.evaluate(() => localStorage.removeItem('tt-device-drawer-layout:v1:sync-ui-device'));
			await page.getByRole('button', { name: 'Open quick settings', exact: true }).click();
			await page.getByRole('button', { name: 'Expand File sync & backup', exact: true }).waitFor();
			assert.equal(await page.locator('button[aria-expanded="true"]').count(), 0);
			await page.getByRole('button', { name: 'Expand File sync & backup', exact: true }).click();
			await page.screenshot({ path: join(evidence, label + '-drawer.png'), fullPage: true });
			await page.getByRole('button', { name: 'Close device details', exact: true }).click();
			results.push({
				label,
				doubleClick: true,
				keyboard: true,
				offlineSavedFolders: true,
				noTransferStarted: true,
				unfiledLegacyFilesAccessible: true,
				unboundLocationHonest: true,
				unpublishedSourceRecorded: true,
				canonicalFolderPathVerified: true,
				multipleParentPathsVerified: true,
				noReferenceScanOnMount: true,
				unfiledExplicitPagination: true,
				dedicatedSyncNavigation: true,
				allSectionsCollapsed: true,
				noOverflow: true
			});
		}
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.getByRole('button', { name: 'Open dedicated sync page', exact: true }).click();
		await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
		await page.getByRole('heading', { name: 'Device sync & backup', exact: true }).click();
		await page.getByLabel('Block text', { exact: true }).fill('My device files');
		await page.getByTestId('builder-save').click();
		await page.reload();
		await page.getByRole('button', { name: 'Open dedicated sync page', exact: true }).click();
		await page.getByRole('heading', { name: 'My device files', exact: true }).waitFor();
		await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
		await page.getByText('{item.name}', { exact: true }).click();
		await page.getByLabel('Block text', { exact: true }).fill('{item.name} · saved');
		await page.getByTestId('builder-save').click();
		await page.reload();
		await page.getByRole('button', { name: 'Open dedicated sync page', exact: true }).click();
		await page.getByRole('link', { name: 'Conflicting documents · saved', exact: true }).waitFor();
		await page.screenshot({ path: join(evidence, 'builder-saved-reloaded.png'), fullPage: true });
		results.push({ builderHeadingSaveReload: true, builderRepeatedFieldSaveReload: true });
        await page.getByRole('button', { name: 'Open recorded location', exact: true }).click();
        await page.getByRole('link', { name: 'Cloud documents', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
        await page.getByText('{item.name}', { exact: true }).click();
        await page.getByLabel('Block text', { exact: true }).fill('{item.name} · location');
        await page.getByTestId('builder-save').click();
        await page.reload();
        await page.getByRole('button', { name: 'Open recorded location', exact: true }).click();
        await page.getByRole('link', { name: 'Cloud documents · location', exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, 'builder-location-saved-reloaded.png'), fullPage: true });
        results.push({ builderLocationFieldSaveReload: true });
        await page.getByRole('button', { name: 'Open parent paths', exact: true }).click();
        await page.getByRole('button', { name: 'Scan / continue parent references', exact: true }).click();
        await page.getByRole('link', { name: 'Backups', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Edit layout', exact: true }).click();
        await page.getByText('{item.name}', { exact: true }).click();
        await page.getByLabel('Block text', { exact: true }).fill('{item.name} · linked');
        await page.getByTestId('builder-save').click();
        await page.reload();
        await page.getByRole('button', { name: 'Open parent paths', exact: true }).click();
        await page.getByRole('button', { name: 'Scan / continue parent references', exact: true }).click();
        await page.getByRole('link', { name: 'Backups · linked', exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, 'builder-parent-path-saved-reloaded.png'), fullPage: true });
        results.push({ builderParentPathNestedFieldSaveReload: true, legacyTransientJsonOverridePreserved: true });

        await page.getByRole('button', { name: 'Open dedicated sync page', exact: true }).click();

		const touchContext = await context.browser().newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
		try {
			const touch = await touchContext.newPage();
			await touch.goto(`http://127.0.0.1:${port}/?home`);
			await touch.getByRole('button', { name: 'Open Test Mac', exact: true }).tap();
			await touch.getByRole('heading', { name: 'Device sync & backup', exact: true }).waitFor();
			assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			results.push({ touchOpensDirectly: true });
		} finally {
			await touchContext.close();
		}
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.setViewportSize({ width: 812, height: 375 });
		await page.getByRole('heading', { name: 'My device files', exact: true }).waitFor();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await page.screenshot({ path: join(evidence, 'landscape-reduced-motion.png'), fullPage: true });
		assert.deepEqual(errors, []);
		await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
		console.log(JSON.stringify({ results, errors, evidence }));
	} finally {
		await context?.close();
		await new Promise((resolve) => server.close(resolve));
	}
}
