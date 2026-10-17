package com.thingtime.mobile;
import org.junit.Test;
import org.junit.Assume;
import static org.junit.Assert.*;
import androidx.test.platform.app.InstrumentationRegistry;
import android.content.Context;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Opt-in, local-only test. Fixture is supplied to the debug app's private storage; never packaged. */
public class DeviceLiveTest {
    static String evaluate(android.webkit.WebView web,String js) throws Exception {
        java.util.concurrent.ArrayBlockingQueue<String> result=new java.util.concurrent.ArrayBlockingQueue<>(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->web.evaluateJavascript(js,result::offer));
        String value=result.poll(30,java.util.concurrent.TimeUnit.SECONDS); assertNotNull("WebView evaluation timed out after 30 seconds",value); return value;
    }
    static void awaitTrue(android.webkit.WebView web,String js) throws Exception {
        awaitTrue(web,js,60000);
    }
    static void awaitTrue(android.webkit.WebView web,String js,long timeout) throws Exception {
        long end=System.currentTimeMillis()+timeout;
        while(System.currentTimeMillis()<end) { if("true".equals(evaluate(web,js))) return; Thread.sleep(250); }
        fail("Installed WebView did not satisfy: "+js);
    }
    static void verifyPageLayout(android.webkit.WebView web) throws Exception {
        String measure="(()=>{const h=Array.from(document.querySelectorAll('h1')).find(e=>e.textContent==='Things');if(!h)return null;const column=h.parentElement.parentElement;return Array.from(column.children).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent.slice(0,55),top:r.top,bottom:r.bottom,height:r.height,shrink:getComputedStyle(e).flexShrink}}).filter(r=>r.height>0)})()";
        JSONArray rows=new JSONArray(new JSONTokener(evaluate(web,"JSON.stringify("+measure+")")).nextValue().toString());
        assertTrue("Things page content must be rendered",rows.length()>3);
        for(int i=1;i<rows.length();i++)assertTrue("Things page sections overlap: "+rows,rows.getJSONObject(i-1).getDouble("bottom")<=rows.getJSONObject(i).getDouble("top")+1);
        assertEquals("true",evaluate(web,"document.documentElement.scrollWidth<=window.innerWidth+1"));
        System.out.println("THINGS_LAYOUT_QA_PASS: "+rows);
    }
    static JSONObject folderRequest(android.webkit.WebView web,DeviceScope scope,JSONObject request) throws Exception {
        JSONObject result=folderReply(web,scope,request);assertFalse(result.optString("error"),result.has("error"));return result;
    }
    static JSONObject folderReply(android.webkit.WebView web,DeviceScope scope,JSONObject request) throws Exception {
        String id=java.util.UUID.randomUUID().toString();request.put("requestId",id).put("ownerId",scope.owner).put("origin",scope.origin);
        evaluate(web,"window.__folderTestReply=null;window.__folderTestListener=e=>{if(e.detail?.type==='mobile-files-result'&&e.detail?.payload?.requestId==="+JSONObject.quote(id)+"){window.__folderTestReply=e.detail.payload;window.removeEventListener('thingtime:native-message',window.__folderTestListener)}};window.addEventListener('thingtime:native-message',window.__folderTestListener);window.thingtimeNativeBridge.postMessage("+new JSONObject().put("type","mobile-files").put("payload",request)+");");
        awaitTrue(web,"window.__folderTestReply !== null",request.optString("action").equals("write-approve")?300000:60000);
        return new JSONObject(new JSONTokener(evaluate(web,"JSON.stringify(window.__folderTestReply)")).nextValue().toString());
    }
    private static void verifyOfflineFolder(android.webkit.WebView web,Context context,DeviceScope scope) throws Exception {
        File confirmed=new File(context.getFilesDir(),"offline-files-confirmed");Files.deleteIfExists(confirmed.toPath());
        FolderStore grants=new FolderStore(context);assertEquals("Use a disposable account without selected folders",0,grants.list(scope).length());
        boolean download="true".equals(InstrumentationRegistry.getArguments().getString("offlineDownload"));
        String expectedName=download?"Thingtime offline":"ThingtimeOfflineQA";
        System.out.println("OFFLINE_CREATE_QA_NAME: "+expectedName);
        System.out.println("OFFLINE_CREATE_QA_READY: Cancel one creation, then create "+expectedName+" through Choose folder > New offline folder and select it in Files.");
        long deadline=System.currentTimeMillis()+300000;String grantId=null;
        while(System.currentTimeMillis()<deadline) {
            JSONArray roots=grants.list(scope);
            for(int i=0;i<roots.length();i++)if(roots.getJSONObject(i).getString("name").equals(expectedName))grantId=roots.getJSONObject(i).getString("id");
            if(grantId!=null)break;Thread.sleep(500);
        }
        assertNotNull("Create and select the synthetic offline folder",grantId);
        android.net.Uri selected=grants.grant(scope,grantId);assertEquals(OfflineDocumentsProvider.authority(context),selected.getAuthority());
        String root=android.provider.DocumentsContract.getTreeDocumentId(selected);
        // Prove this is empty before entering cleanup that owns this test root.
        // A mistakenly selected existing folder must never be deleted on failure.
        try(ManagedFileStore store=new ManagedFileStore(context,()->{})) {
            store.requireFilesRoot(scope,root);assertEquals(0,store.scan(scope,root).length());
        }
        ManagedFileStoreTest fixture=new ManagedFileStoreTest();fixture.before();
        fixture.managed=new File(context.getNoBackupFilesDir(),"ManagedFiles-v1");fixture.root=root;fixture.fixture.owner=scope;fixture.fixture.grant=grantId;
        try {
            if(download)verifyOfflineDownload(web,context,scope,grantId,root,fixture);
            else {
            fixture.folder("nested");byte[] bytes=new byte[8*1024*1024+17];java.util.Arrays.fill(bytes,(byte)13);
            JSONObject receipt=fixture.publish(fixture.request("nested/original.bin",bytes,true),bytes);String document=root+":"+receipt.getJSONObject("entry").getString("id");
            try(android.os.ParcelFileDescriptor fd=context.getContentResolver().openFileDescriptor(OfflineDocumentsProvider.rootUri(context,document),"r");
                InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(fd)) {
                assertArrayEquals(bytes,input.readAllBytes());
            }
            JSONObject scan=folderRequest(web,scope,new JSONObject().put("action","scan").put("rootId",grantId));assertTrue(scan.getBoolean("complete"));assertEquals(2,scan.getJSONArray("entries").length());
            assertFalse(scan.toString().contains("content://"));assertFalse(scan.toString().contains("/data/"));
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Check folder')?.click()");
            awaitTrue(web,"document.body.innerText.includes('1 file checked')");
            }
            if("true".equals(InstrumentationRegistry.getArguments().getString("nativeTrash"))) {
                assertFalse("Recovery acceptance uses the original synthetic fixture",download);
                NativeTrashAcceptance.run(web,context,scope,grantId,fixture);
            }
            android.content.Intent browse=new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT).setType("*/*")
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,OfflineDocumentsProvider.rootUri(context,root));
            context.startActivity(browse);
            System.out.println("OFFLINE_FILES_QA_READY: Inspect "+expectedName+"/nested/"+(download?"sample.bin":"original.bin")+" in Android Files, return to Thingtime, then create files/offline-files-confirmed in the debug app.");
            deadline=System.currentTimeMillis()+300000;while(!confirmed.exists() && System.currentTimeMillis()<deadline)Thread.sleep(500);
            assertTrue("Confirm the rendered Files inspection",confirmed.exists());Files.delete(confirmed.toPath());
            folderRequest(web,scope,new JSONObject().put("action","remove").put("rootId",grantId));
            assertEquals(0,grants.list(scope).length());
            try(ManagedFileStore store=fixture.store()){assertEquals(download?("true".equals(InstrumentationRegistry.getArguments().getString("twoWaySync"))?4:3):2,store.scan(scope,root).length());assertEquals(root,store.document(root).id);}
            System.out.println("OFFLINE_FILES_QA_PASS: native creation, actual Files selection, scoped grant, nested provider bytes, bridge scan and non-destructive access removal.");
        } finally {
            grants.remove(scope,grantId);Files.deleteIfExists(confirmed.toPath());
            java.util.List<String> blobs=new java.util.ArrayList<>();
            try(android.database.sqlite.SQLiteDatabase db=android.database.sqlite.SQLiteDatabase.openDatabase(new File(fixture.managed,"catalog.sqlite").getPath(),null,0)) {
                db.beginTransaction();try {
                    try(android.database.Cursor rows=db.rawQuery("SELECT blob FROM entries WHERE root=? AND blob IS NOT NULL",new String[]{root})) {while(rows.moveToNext())blobs.add(rows.getString(0));}
                    for(String table:new String[]{"trash_receipts","receipts","retained","entries"})db.delete(table,"root=?",new String[]{root});
                    db.delete("roots","id=?",new String[]{root});db.setTransactionSuccessful();
                }finally{db.endTransaction();}
            }
            for(String blob:blobs){assertEquals(blob,java.util.UUID.fromString(blob).toString());Files.deleteIfExists(new File(new File(fixture.managed,"blobs"),blob).toPath());}
            OfflineDocumentsProvider.changed(context);fixture.after();
        }
    }
    private static void verifyOfflineDownload(android.webkit.WebView web,Context context,DeviceScope scope,String grantId,String root,ManagedFileStoreTest fixture) throws Exception {
        File source=new File(context.getFilesDir(),"download-test-cloud.json");JSONObject cloud=new JSONObject(new String(Files.readAllBytes(source.toPath()),StandardCharsets.UTF_8));Files.delete(source.toPath());
        assertEquals(scope.owner,cloud.getString("ownerId"));assertEquals(scope.origin,cloud.getString("origin"));
        assertFalse(cloud.optBoolean("cleaned"));String connection=null;JSONObject uploaded=null;
        boolean twoWay="true".equals(InstrumentationRegistry.getArguments().getString("twoWaySync"));
        boolean syncDeletion="true".equals(InstrumentationRegistry.getArguments().getString("syncDeletion"));
        assertFalse("Deletion acceptance requires two-way sync",syncDeletion&&!twoWay);
        String button=twoWay?"Sync now":"Download now";
        boolean binary=androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER);
        if(binary) {
            assertEquals("\"1.1.0\"",evaluate(web,"window.thingtimeNativeBridge.fileStagingVersion"));
            evaluate(web,"window.__rangeQA={ranges:0,frames:0,bytes:0,appends:0,lastAction:null};window.__rangeQAPost=window.thingtimeNativeBridge.postMessage;window.__rangeQAFrame=window.thingtimeNativeBridge.postFileFrame;window.thingtimeNativeBridge.postMessage=m=>{if(m.type==='mobile-files'){window.__rangeQA.lastAction=m.payload.action;if(m.payload.action==='stage-range')window.__rangeQA.ranges++;if(m.payload.action==='stage-append')window.__rangeQA.appends++}return window.__rangeQAPost(m)};window.thingtimeNativeBridge.postFileFrame=f=>{if(!(f instanceof ArrayBuffer)||f.byteLength<36||f.byteLength>65572)throw Error('Invalid binary frame');if(f.byteLength>36){window.__rangeQA.frames++;window.__rangeQA.bytes+=f.byteLength-36;}return window.__rangeQAFrame(f)};");
        }

        byte[] localBytes=new byte[257];java.util.Arrays.fill(localBytes,(byte)41);
        if(twoWay)fixture.publish(fixture.request("from-device.bin",localBytes,true),localBytes);
        try {
            String device=new KeystoreDeviceStore(context).load(scope).getString("deviceId");
            JSONObject config=new JSONObject().put("configurationVersion",1).put("name","Android cloud download acceptance").put("deviceId",device).put("localRootId",grantId).put("remoteFolderId",cloud.getString("rootId"))
                .put("mode",twoWay?"two-way":"download").put("paused",false).put("propagateDeletes",false).put("network","any").put("chargingOnly",false).put("excludedPaths",new JSONArray());
            connection=webApi(web,"/api/v1/things","POST",new JSONObject().put("thingtime",new JSONArray().put("file-sync")).put("crystal",config)).getJSONObject("thing").getString("id");
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Refresh'&&!b.disabled).click()");
            awaitTrue(web,"document.body.innerText.includes('Android cloud download acceptance') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='"+button+"'&&!b.disabled)");
            if(syncDeletion) SyncDeletionAcceptance.consent(context,"Allow downloads to Thingtime offline?","Cancel",()->{
                NativeTrashAcceptance.click(web,button);awaitTrue(web,"document.body.innerText.includes('Download approval cancelled')");
            });
            else {
                evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='"+button+"'&&!b.disabled).click()");
                System.out.println("OFFLINE_DOWNLOAD_CANCEL: Cancel the native Allow downloads dialog.");
                awaitTrue(web,"document.body.innerText.includes('Download approval cancelled')",300000);
            }
            try(ManagedFileStore store=new ManagedFileStore(context,()->{})){assertEquals(twoWay?1:0,store.scan(scope,root).length());}
            if(syncDeletion) SyncDeletionAcceptance.consent(context,"Allow downloads to Thingtime offline?","Allow downloads",()->{
                NativeTrashAcceptance.click(web,"Retry transfer");awaitDownload(web);
            });
            else {
                evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Retry transfer'&&!b.disabled).click()");
                System.out.println("OFFLINE_DOWNLOAD_ALLOW: Allow downloads in the native dialog.");
                awaitDownload(web);
            }
            JSONArray expected=new JSONArray(cloud.getJSONArray("files").toString());
            if(twoWay) {
                uploaded=verifyUploadedBytes(web,cloud.getString("rootId"),localBytes);
                expected.put(expectedFile("from-device.bin",localBytes));
            }
            JSONArray before=verifyCloudBytes(context,scope,root,expected);
            if(binary) {
                long downloaded=0;for(int i=0;i<cloud.getJSONArray("files").length();i++)downloaded+=cloud.getJSONArray("files").getJSONObject(i).getLong("size");
                assertEquals("true",evaluate(web,"window.__rangeQA.appends===0 && window.__rangeQA.ranges>0 && window.__rangeQA.frames>window.__rangeQA.ranges && window.__rangeQA.bytes==="+downloaded));
                System.out.println("ANDROID_BINARY_RANGE_PASS: "+evaluate(web,"JSON.stringify(window.__rangeQA)"));
            }
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='"+button+"'&&!b.disabled).click()");
            awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Stop transfer')");
            awaitDownload(web);
            JSONArray after=verifyCloudBytes(context,scope,root,expected);assertEquals(before.length(),after.length());
            for(int i=0;i<before.length();i++)assertEquals(SyncStaging.canonical(before.getJSONObject(i)),SyncStaging.canonical(after.getJSONObject(i)));
            if(syncDeletion) {
                SyncDeletionAcceptance.run(web,context,scope,grantId,root,connection,cloud,expected,fixture);
                return;
            }
            if(twoWay) {
                // Independent native fixture edit; this is test setup, never a fake bridge response.
                JSONObject entry=null;for(int i=0;i<after.length();i++)if(after.getJSONObject(i).getString("path").equals("from-device.bin"))entry=after.getJSONObject(i);
                assertNotNull(entry);byte[] edited=new byte[513];java.util.Arrays.fill(edited,(byte)73);
                JSONObject edit=fixture.request("from-device.bin",edited,true);edit.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",entry);fixture.publish(edit,edited);
                File changed=new File(context.getFilesDir(),"two-way-cloud-updated.json");Files.deleteIfExists(changed.toPath());
                System.out.println("TWO_WAY_EDIT_READY: Replace nested/sample.bin through the cloud fixture script, then copy its updated state into files/two-way-cloud-updated.json.");
                long until=System.currentTimeMillis()+300000;while(!changed.exists()&&System.currentTimeMillis()<until)Thread.sleep(500);
                assertTrue("Supply updated cloud fixture",changed.exists());
                JSONObject updated=new JSONObject(new String(Files.readAllBytes(changed.toPath()),StandardCharsets.UTF_8));Files.delete(changed.toPath());
                assertEquals(scope.owner,updated.getString("ownerId"));assertEquals(scope.origin,updated.getString("origin"));assertEquals(cloud.getString("rootId"),updated.getString("rootId"));
                expected=new JSONArray(updated.getJSONArray("files").toString());expected.put(expectedFile("from-device.bin",edited));
                evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Sync now'&&!b.disabled).click()");
                awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Stop transfer')");awaitDownload(web);
                JSONObject replaced=verifyUploadedBytes(web,cloud.getString("rootId"),edited);
                assertEquals(uploaded.getString("id"),replaced.getString("id"));assertNotEquals(uploaded.getString("revision"),replaced.getString("revision"));uploaded=replaced;
                JSONArray replacedEntries=verifyCloudBytes(context,scope,root,expected);
                evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Sync now'&&!b.disabled).click()");
                awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Stop transfer')");awaitDownload(web);
                JSONArray repeated=verifyCloudBytes(context,scope,root,expected);assertEquals(replacedEntries.length(),repeated.length());
                for(int i=0;i<repeated.length();i++)assertEquals(SyncStaging.canonical(replacedEntries.getJSONObject(i)),SyncStaging.canonical(repeated.getJSONObject(i)));
                assertEquals(uploaded.getString("revision"),verifyUploadedBytes(web,cloud.getString("rootId"),edited).getString("revision"));
                if("true".equals(InstrumentationRegistry.getArguments().getString("conflictReview")))
                    expected=verifyFileConflicts(web,context,scope,root,fixture,expected,cloud.getString("rootId"),edited);
                verifySettingsReapproval(web,context,scope,connection,root,expected,cloud.getString("rootId"));
                System.out.println("TWO_WAY_SYNC_PASS: mixed cloud/native creates and independent edits, stable uploaded identity, exact downloaded and uploaded hashes, repeated convergence.");
            }
            System.out.println("OFFLINE_DOWNLOAD_PASS: actual Download now, native Cancel/Allow, cloud nested bytes, independent hashes and unchanged repeated transfer.");
        }catch(Exception|AssertionError failure) {
            // Keep the original failure visible if an unresponsive WebView also
            // prevents the cleanup requests below from completing.
            System.out.println("OFFLINE_DOWNLOAD_FAILURE: "+failure);failure.printStackTrace(System.out);throw failure;
        }finally {
            if(binary)System.out.println("ANDROID_BINARY_RANGE_DIAGNOSTICS: "+evaluate(web,"JSON.stringify(window.__rangeQA)"));
            if(binary)evaluate(web,"if(typeof window.__rangeQAPost==='function'){window.thingtimeNativeBridge.postMessage=window.__rangeQAPost;window.thingtimeNativeBridge.postFileFrame=window.__rangeQAFrame;delete window.__rangeQAPost;delete window.__rangeQAFrame;}");
            if(twoWay) {
                // Only the explicitly named synthetic local fixture belongs to this test.
                JSONArray nodes=webApi(web,"/api/v1/files?rootId="+cloud.getString("rootId"),"GET",null).getJSONObject("inventory").getJSONArray("nodes");
                for(int i=0;i<nodes.length();i++)if(nodes.getJSONObject(i).getString("path").equals("from-device.bin")) {
                    JSONObject f=nodes.getJSONObject(i).getJSONObject("file"),c=f.getJSONObject("content");
                    webApi(web,"/api/v1/files","POST",new JSONObject().put("id",f.getString("id")).put("operationId",java.util.UUID.randomUUID().toString()).put("expectedRevision",f.getString("revision")).put("name",f.getString("name")).put("folderId",f.get("folderId")).put("attachmentId",c.getString("attachmentId")).put("contentVersion",c.getString("version")).put("trashed",true));
                }
            }
            if(connection!=null)webApi(web,"/api/v1/things?id="+connection,"DELETE",null);
        }
    }
    private static void assertSameEntries(JSONArray before,JSONArray after) throws Exception {
        assertEquals(before.length(),after.length());
        for(int i=0;i<before.length();i++)assertEquals(SyncStaging.canonical(before.getJSONObject(i)),SyncStaging.canonical(after.getJSONObject(i)));
    }
    private static JSONArray verifyFileConflicts(android.webkit.WebView web,Context context,DeviceScope scope,String root,ManagedFileStoreTest fixture,JSONArray expected,String cloudRoot,byte[] uploadedBytes) throws Exception {
        for(int round=1;round<=2;round++) {
            JSONArray initial=verifyCloudBytes(context,scope,root,expected);JSONObject old=null;
            for(int i=0;i<initial.length();i++)if(initial.getJSONObject(i).getString("path").equals("hello.txt"))old=initial.getJSONObject(i);
            assertNotNull(old);byte[] local=new byte[64+round];java.util.Arrays.fill(local,(byte)(91+round));
            JSONObject edit=fixture.request("hello.txt",local,true);edit.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",old);fixture.publish(edit,local);
            File changed=new File(context.getFilesDir(),"conflict-cloud-updated.json");Files.deleteIfExists(changed.toPath());
            System.out.println("CONFLICT_CLOUD_EDIT_READY_"+round+": Run the cloud fixture conflict action and copy updated state into files/conflict-cloud-updated.json.");
            long until=System.currentTimeMillis()+300000;while(!changed.exists()&&System.currentTimeMillis()<until)Thread.sleep(500);
            assertTrue("Supply conflicting cloud bytes",changed.exists());JSONObject updated=new JSONObject(new String(Files.readAllBytes(changed.toPath()),StandardCharsets.UTF_8));Files.delete(changed.toPath());
            assertEquals(scope.owner,updated.getString("ownerId"));assertEquals(scope.origin,updated.getString("origin"));assertEquals(cloudRoot,updated.getString("rootId"));
            JSONArray cloudExpected=updated.getJSONArray("files"), localExpected=new JSONArray();
            for(int i=0;i<cloudExpected.length();i++)localExpected.put(cloudExpected.getJSONObject(i).getString("path").equals("hello.txt")?expectedFile("hello.txt",local):cloudExpected.getJSONObject(i));
            localExpected.put(expectedFile("from-device.bin",uploadedBytes));
            JSONArray before=verifyCloudBytes(context,scope,root,localExpected);
            String cloudBefore=inventorySignature(webApi(web,"/api/v1/files?rootId="+cloudRoot,"GET",null).getJSONObject("inventory"));
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Sync now'&&!b.disabled).click()");
            awaitTrue(web,"!!document.querySelector('[aria-label=\"Review sync conflicts\"]')");
            if(round==1) {
                System.out.println("CONFLICT_REVIEW_CANCEL: Cancel review in the actual sync controls.");
                awaitTrue(web,"document.body.innerText.includes('Conflict review cancelled')",300000);
                assertEquals(cloudBefore,inventorySignature(webApi(web,"/api/v1/files?rootId="+cloudRoot,"GET",null).getJSONObject("inventory")));
                JSONArray after=verifyCloudBytes(context,scope,root,localExpected);
                assertSameEntries(before,after);
                evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Retry transfer'&&!b.disabled).click()");
                awaitTrue(web,"!!document.querySelector('[aria-label=\"Review sync conflicts\"]')");
            }
            System.out.println("CONFLICT_REVIEW_"+(round==1?"CLOUD":"DEVICE")+": Choose Keep "+(round==1?"cloud":"device")+" version for hello.txt and Apply choices and sync.");
            awaitDownload(web);
            expected=round==1?new JSONArray(cloudExpected.toString()).put(expectedFile("from-device.bin",uploadedBytes)):localExpected;
            JSONArray resolved=verifyCloudBytes(context,scope,root,expected);
            JSONObject current=null;JSONArray nodes=webApi(web,"/api/v1/files?rootId="+cloudRoot,"GET",null).getJSONObject("inventory").getJSONArray("nodes");
            for(int i=0;i<nodes.length();i++)if(nodes.getJSONObject(i).getString("path").equals("hello.txt"))current=nodes.getJSONObject(i).getJSONObject("file");
            assertNotNull(current);JSONObject expectedHello=null;for(int i=0;i<expected.length();i++)if(expected.getJSONObject(i).getString("path").equals("hello.txt"))expectedHello=expected.getJSONObject(i);
            evaluate(web,"window.__conflictHash=null;fetch('/api/v1/attachments/content?id='+encodeURIComponent("+JSONObject.quote(current.getJSONObject("content").getString("attachmentId"))+")+ '&cache=bytes',{credentials:'same-origin'}).then(r=>{if(!r.ok)throw Error('read failed');return r.arrayBuffer()}).then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>window.__conflictHash=Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join(''))");
            awaitTrue(web,"window.__conflictHash!==null");assertEquals(expectedHello.getString("sha256"),new JSONTokener(evaluate(web,"window.__conflictHash")).nextValue());
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Sync now'&&!b.disabled).click()");
            awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Stop transfer')");awaitDownload(web);
            assertSameEntries(resolved,verifyCloudBytes(context,scope,root,expected));
            System.out.println("CONFLICT_REVIEW_PASS_"+round+": native and cloud hashes agree after explicit choice; repeated sync preserves native entries.");
        }
        return expected;
    }
    private static void verifySettingsReapproval(android.webkit.WebView web,Context context,DeviceScope scope,String connection,String root,JSONArray expected,String remoteRoot) throws Exception {
        JSONArray before=verifyCloudBytes(context,scope,root,expected);
        String inventory=inventorySignature(webApi(web,"/api/v1/files?rootId="+remoteRoot,"GET",null).getJSONObject("inventory"));
        JSONObject saved=webApi(web,"/api/v1/things?id="+connection,"GET",null).getJSONObject("thing");
        JSONObject config=new JSONObject(saved.getJSONObject("crystal").toString());
        config.put("name","Android two-way settings reapproval").put("excludedPaths",new JSONArray().put("not-selected"));
        // Simulate settings saved elsewhere through the canonical revision-guarded API.
        JSONObject changed=webApi(web,"/api/v1/things","PATCH",new JSONObject().put("id",connection)
            .put("expectedUpdatedAt",saved.getString("updatedAt")).put("crystal",config)).getJSONObject("thing");
        assertNotEquals(saved.getString("updatedAt"),changed.getString("updatedAt"));
        evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Refresh'&&!b.disabled).click()");
        awaitTrue(web,"document.body.innerText.includes('Android two-way settings reapproval') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Sync now'&&!b.disabled)");
        evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Sync now'&&!b.disabled).click()");
        System.out.println("TWO_WAY_REAPPROVAL_CANCEL: Changed settings must show fresh native consent. Cancel it.");
        awaitTrue(web,"document.body.innerText.includes('Download approval cancelled')",300000);
        JSONArray cancelled=verifyCloudBytes(context,scope,root,expected);
        assertEquals(before.length(),cancelled.length());
        for(int i=0;i<before.length();i++)assertEquals(SyncStaging.canonical(before.getJSONObject(i)),SyncStaging.canonical(cancelled.getJSONObject(i)));
        assertEquals(inventory,inventorySignature(webApi(web,"/api/v1/files?rootId="+remoteRoot,"GET",null).getJSONObject("inventory")));
        evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Retry transfer'&&!b.disabled).click()");
        System.out.println("TWO_WAY_REAPPROVAL_ALLOW: Allow the revised connection in the native dialog.");
        awaitDownload(web);
        JSONArray approved=verifyCloudBytes(context,scope,root,expected);
        assertEquals(before.length(),approved.length());
        for(int i=0;i<before.length();i++)assertEquals(SyncStaging.canonical(before.getJSONObject(i)),SyncStaging.canonical(approved.getJSONObject(i)));
        assertEquals(inventory,inventorySignature(webApi(web,"/api/v1/files?rootId="+remoteRoot,"GET",null).getJSONObject("inventory")));
        System.out.println("TWO_WAY_REAPPROVAL_PASS: revised saved settings require fresh native consent; cancellation and approved convergence preserve cloud revisions, native identities and bytes.");
    }
    private static String inventorySignature(JSONObject inventory) throws Exception {
        JSONObject metadata=new JSONObject(inventory.toString());
        JSONArray nodes=metadata.getJSONArray("nodes");metadata.remove("nodes");
        java.util.List<String> entries=new java.util.ArrayList<>();
        for(int i=0;i<nodes.length();i++)entries.add(SyncStaging.canonical(nodes.getJSONObject(i)));
        java.util.Collections.sort(entries);
        return SyncStaging.canonical(metadata)+"\n"+new JSONArray(entries).toString();
    }
    private static JSONObject expectedFile(String path,byte[] bytes) throws Exception {
        return new JSONObject().put("path",path).put("size",bytes.length).put("sha256",FolderReader.hex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes)));
    }
    private static JSONObject verifyUploadedBytes(android.webkit.WebView web,String root,byte[] expected) throws Exception {
        JSONArray nodes=webApi(web,"/api/v1/files?rootId="+root,"GET",null).getJSONObject("inventory").getJSONArray("nodes");
        JSONObject file=null;int count=0;
        for(int i=0;i<nodes.length();i++)if(nodes.getJSONObject(i).getString("path").equals("from-device.bin")){file=nodes.getJSONObject(i).getJSONObject("file");count++;}
        assertEquals(1,count);assertNotNull(file);assertEquals(expected.length,file.getJSONObject("content").getLong("size"));
        String attachment=file.getJSONObject("content").getString("attachmentId");
        evaluate(web,"window.__syncHash=null;(async()=>{try{const r=await fetch("+JSONObject.quote("/api/v1/attachments/content?id="+attachment+"&cache=bytes")+");if(!r.ok)throw Error('download');const digest=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());window.__syncHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}catch(e){window.__syncHash='error'}})()");
        awaitTrue(web,"window.__syncHash!==null");assertEquals(expectedFile("from-device.bin",expected).getString("sha256"),new JSONTokener(evaluate(web,"window.__syncHash")).nextValue());return file;
    }
    static void awaitDownload(android.webkit.WebView web) throws Exception {
        awaitTrue(web,"document.body.innerText.includes('Last transfer finished.') || Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Retry transfer'&&!b.disabled)",300000);
        assertEquals("Cloud download failed: "+evaluate(web,"Array.from(document.querySelectorAll('[role=status]')).map(e=>e.textContent).join(' | ').slice(0,1000)"), "true",evaluate(web,"document.body.innerText.includes('Last transfer finished.')"));
    }
    static JSONArray verifyCloudBytes(Context context,DeviceScope scope,String root,JSONArray expected) throws Exception {
        try(ManagedFileStore store=new ManagedFileStore(context,()->{})) {
            JSONArray entries=store.scan(scope,root);assertEquals(expected.length()+1,entries.length());
            for(int i=0;i<expected.length();i++) {
                JSONObject file=expected.getJSONObject(i),entry=null;
                for(int j=0;j<entries.length();j++)if(entries.getJSONObject(j).getString("path").equals(file.getString("path")))entry=entries.getJSONObject(j);
                assertNotNull(entry);assertEquals(file.getLong("size"),entry.getLong("size"));
                try(InputStream input=context.getContentResolver().openInputStream(OfflineDocumentsProvider.rootUri(context,root+":"+entry.getString("id")))) {
                    java.security.MessageDigest hash=java.security.MessageDigest.getInstance("SHA-256");byte[] buffer=new byte[65536];long size=0;int n;
                    while((n=input.read(buffer))!=-1){hash.update(buffer,0,n);size+=n;}assertEquals(file.getLong("size"),size);assertEquals(file.getString("sha256"),FolderReader.hex(hash.digest()));
                }
            }
            return entries;
        }
    }
    private static void verifySelectedFolder(android.webkit.WebView web,Context context,DeviceScope scope) throws Exception {
        awaitTrue(web,"window.thingtimeNativeBridge?.fileAccessVersion==='"+(androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)?"1.4.0":"1.3.0")+"' && document.body.innerText.includes('Folder access') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Choose folder'&&!b.disabled)");
        assertNotNull(folderRequest(web,scope,new JSONObject().put("action","list")).getJSONArray("roots"));
        JSONObject conditions=folderRequest(web,scope,new JSONObject().put("action","conditions")).getJSONObject("conditions");
        assertTrue(java.util.Arrays.asList("wifi","cellular","ethernet","offline","unknown").contains(conditions.getString("network")));
        assertTrue(conditions.isNull("charging") || conditions.get("charging") instanceof Boolean);
        awaitTrue(web,"window.thingtimeNativeBridge?.fileStagingVersion==='"+(androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)?"1.1.0":"1.0.0")+"' && window.thingtimeNativeBridge.filePublicationVersion==='1.1.0'");
        // A full 64 KiB base64 envelope must reach the real handler, then fail
        // on its missing native grant. This is not successful picker acceptance.
        JSONObject denied=folderReply(web,scope,new JSONObject().put("action","stage-append")
            .put("rootId",java.util.UUID.randomUUID().toString()).put("offset",0).put("transfer",new JSONObject())
            .put("data",java.util.Base64.getEncoder().encodeToString(new byte[FolderReader.MAX_READ])));
        assertEquals("Folder access is unavailable. Choose it again.",denied.getString("error"));
        assertFalse(denied.toString().contains("content://"));
        if("true".equals(InstrumentationRegistry.getArguments().getString("offlineSelection"))) {verifyOfflineFolder(web,context,scope);return;}
        if(!"true".equals(InstrumentationRegistry.getArguments().getString("folderSelection"))) return;
        System.out.println("FOLDER_QA_READY: Choose folder and select Documents/ThingtimeSyncQA in the system picker.");
        long deadline=System.currentTimeMillis()+300000;
        while(System.currentTimeMillis()<deadline && !"true".equals(evaluate(web,"document.body.innerText.includes('ThingtimeSyncQA')"))) Thread.sleep(500);
        assertEquals("true",evaluate(web,"document.body.innerText.includes('ThingtimeSyncQA')"));
        FolderStore store=new FolderStore(context);JSONArray roots=store.list(scope);String id=null;
        for(int i=0;i<roots.length();i++) if(roots.getJSONObject(i).getString("name").equals("ThingtimeSyncQA")) id=roots.getJSONObject(i).getString("id");
        assertNotNull(id);final String rootId=id;
        DeviceScope other=new DeviceScope("folder-isolation-"+java.util.UUID.randomUUID(),scope.origin,true);
        assertEquals(0,store.list(other).length());assertThrows(Exception.class,()->store.grant(other,rootId));
        android.net.Uri uri=store.grant(scope,id);
        try {
            assertEquals(uri,new FolderStore(context).grant(scope,id));
            JSONObject scan=folderRequest(web,scope,new JSONObject().put("action","scan").put("rootId",id));assertTrue(scan.getBoolean("complete"));
            JSONArray entries=scan.getJSONArray("entries");assertEquals("Select only the documented synthetic fixture",1,entries.length());JSONObject file=null;
            for(int i=0;i<entries.length();i++) if(entries.getJSONObject(i).getString("path").equals("original.bin")) file=entries.getJSONObject(i);
            assertNotNull(file);assertEquals(8*1024*1024+17,file.getLong("size"));assertEquals(2,file.getJSONObject("fingerprint").getInt("partCount"));
            java.security.MessageDigest part=java.security.MessageDigest.getInstance("SHA-256"), composite=java.security.MessageDigest.getInstance("SHA-256");
            byte[] first=new byte[8*1024*1024],tail=new byte[17];java.util.Arrays.fill(first,(byte)13);java.util.Arrays.fill(tail,(byte)13);composite.update(part.digest(first));composite.update(part.digest(tail));
            assertEquals(FolderReader.hex(composite.digest()),file.getJSONObject("fingerprint").getString("sha256"));
            JSONObject read=folderRequest(web,scope,new JSONObject().put("action","read").put("rootId",id).put("path","original.bin").put("version",file.getString("version")).put("offset",8*1024*1024).put("length",65536).put("verifiedChunks",true));
            assertArrayEquals(tail,java.util.Base64.getDecoder().decode(read.getJSONObject("chunk").getString("data")));
            if("true".equals(InstrumentationRegistry.getArguments().getString("folderApproval"))) verifyWriteApproval(web,context,scope,id,uri);
            if("true".equals(InstrumentationRegistry.getArguments().getString("folderDescriptor"))) inspectSelectedDirectoryDescriptor(context,uri);
            if("true".equals(InstrumentationRegistry.getArguments().getString("folderUpload"))) verifySelectedUpload(web,context,scope,id);
            store.add(other,uri,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,"ThingtimeSyncQA");
            folderRequest(web,scope,new JSONObject().put("action","remove").put("rootId",id));
            assertThrows(Exception.class,()->store.grant(scope,rootId));
            assertTrue(context.getContentResolver().getPersistedUriPermissions().stream().anyMatch(p->p.getUri().equals(uri)&&p.isReadPermission()));
            String second=store.list(other).getJSONObject(0).getString("id");store.remove(other,second);
            assertFalse(context.getContentResolver().getPersistedUriPermissions().stream().anyMatch(p->p.getUri().equals(uri)&&p.isReadPermission()));
            System.out.println("FOLDER_QA_PASS: system picker, persisted scoped grants, real provider multipart fingerprint/read, isolation and shared-grant removal.");
        } finally {
            store.remove(scope,rootId);JSONArray otherRoots=store.list(other);for(int i=0;i<otherRoots.length();i++) store.remove(other,otherRoots.getJSONObject(i).getString("id"));
        }
    }
    private static void verifyWriteApproval(android.webkit.WebView web,Context context,DeviceScope scope,String id,android.net.Uri uri) throws Exception {
        FolderStore store=new FolderStore(context);
        WriteApproval approval=new WriteApproval(new JSONObject().put("scope",new JSONObject().put("ownerId",scope.owner).put("origin",scope.origin).put("dataPlane","home")
            .put("rootId","native-approval-qa").put("deviceId",new KeystoreDeviceStore(context).load(scope).getString("deviceId")))
            .put("configurationRevision","1").put("configurationHash","a".repeat(64)),scope);
        JSONObject request=new JSONObject().put("action","write-approve").put("rootId",id).put("approval",approval.json());
        assertFalse(store.isWriteApproved(scope,id,approval));
        System.out.println("WRITE_APPROVAL_QA_CANCEL: Cancel the native download approval dialog.");
        JSONObject cancelled=folderReply(web,scope,new JSONObject(request.toString()));
        assertEquals("Download approval cancelled. No new folder write permission was granted.",cancelled.getString("error"));
        assertFalse(store.isWriteApproved(scope,id,approval));
        assertFalse(context.getContentResolver().getPersistedUriPermissions().stream().anyMatch(p->p.getUri().equals(uri)&&p.isWritePermission()));
        System.out.println("WRITE_APPROVAL_QA_ALLOW: Continue to Files, select the same ThingtimeSyncQA folder, then allow its access.");
        JSONObject accepted=folderRequest(web,scope,new JSONObject(request.toString()));
        assertTrue(approval.matches(new WriteApproval(accepted.getJSONObject("writeApproval"),scope)));
        assertFalse(accepted.toString().contains("content://"));assertTrue(new FolderStore(context).isWriteApproved(scope,id,approval));
        // Identical retry must return without a second dialog.
        folderRequest(web,scope,new JSONObject(request.toString()));
        WriteApproval revised=new WriteApproval(approval.json().put("configurationRevision","2"),scope);
        assertFalse(store.isWriteApproved(scope,id,revised));
        System.out.println("WRITE_APPROVAL_QA_REVISION: Cancel the new approval dialog for changed configuration.");
        JSONObject denied=folderReply(web,scope,new JSONObject(request.toString()).put("approval",revised.json()));
        assertTrue(denied.has("error"));assertFalse(store.isWriteApproved(scope,id,revised));assertTrue(store.isWriteApproved(scope,id,approval));
        // A real native re-selection invalidates the old configuration binding.
        store.add(scope,uri,android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,"ThingtimeSyncQA");
        assertFalse(store.isWriteApproved(scope,id,approval));
        assertFalse(context.getContentResolver().getPersistedUriPermissions().stream().anyMatch(p->p.getUri().equals(uri)&&p.isWritePermission()));
        assertEquals("true",evaluate(web,"window.thingtimeNativeBridge.fileStagingVersion==='"+(androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)?"1.1.0":"1.0.0")+"' && window.thingtimeNativeBridge.filePublicationVersion==='1.1.0'"));
        System.out.println("WRITE_APPROVAL_QA_PASS: native cancellation, real OS write grant, encrypted reload, exact retry, configuration change, reselection invalidation; generic provider publication remains disabled.");
    }
    private static void inspectSelectedDirectoryDescriptor(Context context,android.net.Uri tree) throws Exception {
        JSONObject result=new JSONObject().put("directoryDescriptor",false).put("relativeRead",false);
        android.net.Uri root=android.provider.DocumentsContract.buildDocumentUriUsingTree(tree,android.provider.DocumentsContract.getTreeDocumentId(tree));
        try(android.os.ParcelFileDescriptor descriptor=context.getContentResolver().openFileDescriptor(root,"r")) {
            assertNotNull(descriptor);
            boolean directory=android.system.OsConstants.S_ISDIR(android.system.Os.fstat(descriptor.getFileDescriptor()).st_mode);
            result.put("directoryDescriptor",directory);
            if(directory) {
                java.io.FileDescriptor file=android.system.Os.open("/proc/self/fd/"+descriptor.getFd()+"/original.bin",android.system.OsConstants.O_RDONLY|android.system.OsConstants.O_NOFOLLOW,0);
                try { byte[] bytes=new byte[32];assertEquals(32,android.system.Os.pread(file,bytes,0,32,0));for(byte value:bytes)assertEquals(13,value);result.put("relativeRead",true); }
                finally { android.system.Os.close(file); }
            }
        } catch(java.io.FileNotFoundException | android.system.ErrnoException unsupported) {
            result.put("failureType",unsupported.getClass().getSimpleName());
            if(unsupported instanceof android.system.ErrnoException)result.put("errno",((android.system.ErrnoException)unsupported).errno);
        }
        System.out.println("DIRECTORY_DESCRIPTOR_RESULT: "+result);
    }
    static JSONObject webApi(android.webkit.WebView web,String path,String method,JSONObject body) throws Exception {
        evaluate(web,"window.__syncQA=null;(async()=>{try{const r=await fetch("+JSONObject.quote(path)+",{method:"+JSONObject.quote(method)+",headers:{'Content-Type':'application/json'},"+(body==null?"":"body:"+JSONObject.quote(body.toString())+",")+"redirect:'error'});const value=await r.json();window.__syncQA=r.ok?{ok:true,value}:{ok:false,status:r.status};}catch(e){window.__syncQA={ok:false,error:String(e)}}})()");
        awaitTrue(web,"window.__syncQA!==null");
        JSONObject result=new JSONObject(new JSONTokener(evaluate(web,"JSON.stringify(window.__syncQA)")).nextValue().toString());
        assertTrue("Acceptance API failed: "+path+" "+result,result.getBoolean("ok"));return result.getJSONObject("value");
    }
    private static void verifySelectedUpload(android.webkit.WebView web,Context context,DeviceScope scope,String localRootId) throws Exception {
        String remoteRoot=null,connectionId=null;
        String connectionName="Android upload acceptance "+java.util.UUID.randomUUID();
        boolean binary=androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER);
        if(binary)evaluate(web,"window.__uploadQA={ranges:0,legacyBytes:0,frames:0,bytes:0,requests:0,replies:0,lastAction:null,lastError:null};window.__uploadPost=window.thingtimeNativeBridge.postMessage;window.thingtimeNativeBridge.postMessage=m=>{if(m.type==='mobile-files'){window.__uploadQA.requests++;window.__uploadQA.lastAction=m.payload.action;if(m.payload.action==='read-range')window.__uploadQA.ranges++;if(m.payload.action==='read'&&m.payload.length>1)window.__uploadQA.legacyBytes+=m.payload.length}return window.__uploadPost(m)};window.__uploadFrames=e=>{if(e.detail?.type==='mobile-files-result'){window.__uploadQA.replies++;window.__uploadQA.lastError=e.detail.payload?.error||null}if(e.detail?.type==='mobile-files-read-frame'){const b=e.detail.payload.frame;if(!(b instanceof ArrayBuffer)||b.byteLength<77||b.byteLength>65612)throw Error('Invalid upload frame');window.__uploadQA.frames++;window.__uploadQA.bytes+=b.byteLength-76}};window.addEventListener('thingtime:native-message',window.__uploadFrames);");
        try {
            remoteRoot=webApi(web,"/api/v1/things","POST",new JSONObject().put("thingtime",new JSONArray().put("folder")).put("crystal",new JSONObject().put("name","Android upload acceptance "+java.util.UUID.randomUUID()))).getJSONObject("thing").getString("id");
            String deviceId=new KeystoreDeviceStore(context).load(scope).getString("deviceId");
            JSONObject config=new JSONObject().put("configurationVersion",1).put("name",connectionName).put("deviceId",deviceId).put("localRootId",localRootId).put("remoteFolderId",remoteRoot).put("mode","backup").put("paused",false).put("propagateDeletes",false).put("network","any").put("chargingOnly",false).put("excludedPaths",new JSONArray());
            connectionId=webApi(web,"/api/v1/things","POST",new JSONObject().put("thingtime",new JSONArray().put("file-sync")).put("crystal",config)).getJSONObject("thing").getString("id");
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Refresh'&&!b.disabled).click()");
            String card="Array.from(document.querySelectorAll('p')).find(e=>e.textContent==="+JSONObject.quote(connectionName)+")?.parentElement?.parentElement";
            awaitTrue(web,"Array.from(("+card+")?.querySelectorAll('button')||[]).some(b=>b.textContent.trim()==='Upload now'&&!b.disabled)");
            evaluate(web,"Array.from(("+card+").querySelectorAll('button')).find(b=>b.textContent.trim()==='Upload now'&&!b.disabled).click()");
            long uploadDeadline=System.currentTimeMillis()+240000,nextDiagnostic=0;
            while(!"true".equals(evaluate(web,"("+card+")?.querySelector('[role=status]')?.textContent==='Last transfer finished.'"))) {
                if(binary && System.currentTimeMillis()>=nextDiagnostic) {
                    System.out.println("ANDROID_UPLOAD_PROGRESS: "+evaluate(web,"JSON.stringify(window.__uploadQA)"));
                    System.out.println("ANDROID_UPLOAD_STATUS: "+evaluate(web,"("+card+")?.querySelector('[role=status]')?.textContent"));
                    nextDiagnostic=System.currentTimeMillis()+10000;
                }
                if(System.currentTimeMillis()>=uploadDeadline)fail("Installed upload did not finish within four minutes.");
                Thread.sleep(250);
            }
            JSONArray nodes=webApi(web,"/api/v1/files?rootId="+remoteRoot,"GET",null).getJSONObject("inventory").getJSONArray("nodes");JSONObject file=null;
            for(int i=0;i<nodes.length();i++){JSONObject n=nodes.getJSONObject(i);if(n.getString("path").equals("original.bin"))file=n.getJSONObject("file");}
            assertNotNull(file);assertEquals(8*1024*1024+17,file.getJSONObject("content").getLong("size"));
            String attachment=file.getJSONObject("content").getString("attachmentId");
            evaluate(web,"window.__syncHash=null;(async()=>{try{const r=await fetch("+JSONObject.quote("/api/v1/attachments/content?id="+attachment+"&cache=bytes")+");if(!r.ok)throw Error('download');const digest=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());window.__syncHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}catch(e){window.__syncHash='error'}})()");
            awaitTrue(web,"window.__syncHash!==null");
            byte[] expected=new byte[8*1024*1024+17];java.util.Arrays.fill(expected,(byte)13);
            String hash=FolderReader.hex(java.security.MessageDigest.getInstance("SHA-256").digest(expected));
            assertEquals(hash,new JSONTokener(evaluate(web,"window.__syncHash")).nextValue());
            if(binary){
                assertEquals("true",evaluate(web,"window.__uploadQA.ranges>0 && window.__uploadQA.frames>window.__uploadQA.ranges && window.__uploadQA.legacyBytes===0 && window.__uploadQA.bytes>=8388625"));
                System.out.println("ANDROID_BINARY_UPLOAD_PASS: "+evaluate(web,"JSON.stringify(window.__uploadQA)"));
            }
            System.out.println("FOLDER_UPLOAD_PASS: installed Android WebView control, real SAF bytes, configured executor, cloud multipart publication, independent downloaded-byte SHA-256.");
        } finally {
            if(binary)evaluate(web,"window.thingtimeNativeBridge.postMessage=window.__uploadPost;window.removeEventListener('thingtime:native-message',window.__uploadFrames);delete window.__uploadPost;delete window.__uploadFrames;");
            if(remoteRoot!=null) {
                JSONArray nodes=webApi(web,"/api/v1/files?rootId="+remoteRoot,"GET",null).getJSONObject("inventory").getJSONArray("nodes");
                for(int i=0;i<nodes.length();i++){JSONObject node=nodes.getJSONObject(i);if(!node.getString("kind").equals("file"))continue;JSONObject f=node.getJSONObject("file"),c=f.getJSONObject("content");
                    webApi(web,"/api/v1/files","POST",new JSONObject().put("id",f.getString("id")).put("operationId",java.util.UUID.randomUUID().toString()).put("expectedRevision",f.getString("revision")).put("name",f.getString("name")).put("folderId",f.get("folderId")).put("attachmentId",c.getString("attachmentId")).put("contentVersion",c.getString("version")).put("trashed",true));
                }
            }
            if(connectionId!=null)webApi(web,"/api/v1/things?id="+connectionId,"DELETE",null);
            if(remoteRoot!=null)webApi(web,"/api/v1/things?id="+remoteRoot,"DELETE",null);
        }
    }
    private static void verifyInstalledWebBridge(Context context,CookieManager jar,DeviceScope scope,KeystoreDeviceStore storage) throws Exception {
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        instrumentation.runOnMainSync(()-> {
            for(HttpCookie cookie:jar.getCookieStore().getCookies()) android.webkit.CookieManager.getInstance().setCookie(scope.origin,cookie.getName()+"="+cookie.getValue()+"; Path=/");
            android.webkit.CookieManager.getInstance().flush();
        });
        android.content.Intent intent=new android.content.Intent(context,MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity=(MainActivity)instrumentation.startActivitySync(intent);
        android.webkit.WebView[] target=new android.webkit.WebView[1];
        instrumentation.runOnMainSync(()-> {
            android.view.ViewGroup content=activity.findViewById(android.R.id.content);
            target[0]=(android.webkit.WebView)((android.view.ViewGroup)content.getChildAt(0)).getChildAt(0);
            target[0].loadUrl(scope.origin+"/things");
        });
        try {
            awaitTrue(target[0],"window.thingtimeNativeBridge?.platform === 'android' && window.thingtimeNativeBridge?.devicePairingVersion === '1.0.0'");
            awaitTrue(target[0],"document.body.innerText.includes('This device is paired to your account')");
            verifySelectedFolder(target[0],context,scope);
            verifyPageLayout(target[0]);
            if("true".equals(InstrumentationRegistry.getArguments().getString("fileHistory"))) FileHistoryAcceptance.run(target[0],context,scope);
            long revision=storage.load(scope).getLong("revision");
            awaitTrue(target[0],"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Check connection' && !b.disabled)");
            assertEquals("true",evaluate(target[0],"(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Check connection'); b.click(); return true;})()"));
            awaitTrue(target[0],"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Check connection' && !b.disabled)");
            long until=System.currentTimeMillis()+15000; while(storage.load(scope).getLong("revision")<=revision && System.currentTimeMillis()<until) Thread.sleep(100);
            assertTrue(storage.load(scope).getLong("revision")>revision);
            assertEquals("true",evaluate(target[0],"document.documentElement.scrollWidth <= window.innerWidth + 1"));
            instrumentation.getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,new FileOutputStream(new File(context.getFilesDir(),"device-ui-qa.png")));
        } finally {
            instrumentation.runOnMainSync(activity::finish);
            instrumentation.runOnMainSync(()->android.webkit.CookieManager.getInstance().removeAllCookies(null));
        }
    }
    @Test public void pairReadbackAndResumeAgainstLocalAPI() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        File fixture=new File(context.getFilesDir(),"device-test-fixture.json");
        Assume.assumeTrue("No disposable local account fixture supplied",fixture.exists());
        JSONObject config=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8)); fixture.delete();
        String base=config.getString("base");
        assertTrue(base.startsWith("http://127.0.0.1:") || base.startsWith("http://localhost:"));
        CookieManager jar=new CookieManager(null,CookiePolicy.ACCEPT_ALL);
        JSONObject login=new JSONObject().put("username",config.getString("username")).put("password",config.getString("password"));
        HttpURLConnection connection=(HttpURLConnection)new URL(base+"/api/v1/login").openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
        connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type","application/json"); connection.setRequestProperty("Origin",base);
        try {
            try(OutputStream output=connection.getOutputStream()) { output.write(login.toString().getBytes(StandardCharsets.UTF_8)); }
            assertEquals(200,connection.getResponseCode()); jar.put(URI.create(base+"/api/v1/login"),connection.getHeaderFields());
        } finally { connection.disconnect(); }
        DeviceHttpTransport transport=new DeviceHttpTransport(url->jar.getCookieStore().get(URI.create(url)).stream().map(cookie->cookie.getName()+"="+cookie.getValue()).collect(java.util.stream.Collectors.joining("; ")),()->{});
        DeviceScope scope=new DeviceScope(config.getString("userId"),base,true);
        KeystoreDeviceStore storage=new KeystoreDeviceStore(context);
        try {
            JSONObject descriptor=new JSONObject().put("name","Android pairing QA").put("model","Android emulator").put("osVersion","15").put("appVersion","1.0");
            JSONObject first=new PairingEngine(storage,transport,()->{}).pair(scope,descriptor);
            assertEquals("paired",first.getString("state")); String id=first.getString("deviceId");
            JSONObject second=new PairingEngine(new KeystoreDeviceStore(context),transport,()->{}).pair(scope,descriptor);
            assertEquals(id,second.getString("deviceId"));
            JSONArray devices=transport.request(scope,"/api/v1/devices",null,null,true).getJSONArray("devices"); int found=0;
            for(int i=0;i<devices.length();i++) { JSONObject device=devices.getJSONObject(i); if(id.equals(device.getString("id"))) { found++; assertEquals("android",device.getString("platform")); assertTrue(device.getBoolean("online")); assertEquals(0,device.getJSONArray("capabilities").length()); } }
            assertEquals(1,found); assertEquals(id,storage.load(scope).getString("deviceId"));
            verifyInstalledWebBridge(context,jar,scope,storage);

        } finally { transport.request(scope,"/api/v1/auth/accounts/remove",new JSONObject().put("userId",scope.owner).toString(),null,true); }
    }
}
