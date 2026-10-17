package com.thingtime.mobile;

import android.content.Context;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** Opt-in installed planner acceptance. Uses real cloud APIs, a real selected
 * offline folder, native consent, SQLite and IndexedDB. Only one delivered native
 * receipt is suppressed to model an interrupted bridge response. */
final class SyncDeletionAcceptance {
    interface Work {void run() throws Exception;}
    static void consent(Context context,String title,String button,Work action) throws Exception {
        ExecutorService ui=Executors.newSingleThreadExecutor();
        Future<?> selected=ui.submit(()->NativeTrashAcceptance.dialog(context,title,button,"sync-deletion-"+button.replace(' ','-').toLowerCase()+".png"));
        try{action.run();selected.get(60,TimeUnit.SECONDS);}finally{ui.shutdownNow();}
    }
    private static void click(WebView web,String label) throws Exception{NativeTrashAcceptance.click(web,label);}
    private static void sync(WebView web,String label) throws Exception {
        click(web,label);DeviceLiveTest.awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Stop transfer')");DeviceLiveTest.awaitDownload(web);
    }
    private static JSONArray journal(WebView web,String configuration) throws Exception {
        DeviceLiveTest.evaluate(web,"window.__deletionJournal=null;(()=>{const open=indexedDB.open('thingtime-file-sync-v1');open.onsuccess=()=>{const db=open.result;const tx=db.transaction('runs','readonly');const read=tx.objectStore('runs').getAll();read.onsuccess=()=>window.__deletionJournal=read.result.filter(r=>r.scope.rootId==="+JSONObject.quote(configuration)+");tx.oncomplete=()=>db.close()}})()");
        DeviceLiveTest.awaitTrue(web,"Array.isArray(window.__deletionJournal)");
        JSONArray runs=new JSONArray(new JSONTokener(DeviceLiveTest.evaluate(web,"JSON.stringify(window.__deletionJournal)")).nextValue().toString());
        assertEquals(1,runs.length());return runs.getJSONObject(0).getJSONArray("operations");
    }
    private static JSONObject request(WebView web,DeviceScope scope,String grant,String action) throws Exception {
        return DeviceLiveTest.folderRequest(web,scope,new JSONObject().put("action",action).put("rootId",grant));
    }
    private static void same(JSONArray a,JSONArray b) throws Exception {
        assertEquals(a.length(),b.length());
        for(int i=0;i<a.length();i++)assertEquals(SyncStaging.canonical(a.getJSONObject(i)),SyncStaging.canonical(b.getJSONObject(i)));
    }
    static void run(WebView web,Context context,DeviceScope scope,String grant,String root,String configuration,
                    JSONObject cloud,JSONArray expected,ManagedFileStoreTest fixture) throws Exception {
        JSONArray before=DeviceLiveTest.verifyCloudBytes(context,scope,root,expected);
        JSONObject saved=DeviceLiveTest.webApi(web,"/api/v1/things?id="+configuration,"GET",null).getJSONObject("thing");
        JSONObject config=new JSONObject(saved.getJSONObject("crystal").toString()).put("propagateDeletes",true);
        DeviceLiveTest.webApi(web,"/api/v1/things","PATCH",new JSONObject().put("id",configuration).put("expectedUpdatedAt",saved.getString("updatedAt")).put("crystal",config));
        click(web,"Refresh");DeviceLiveTest.awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Sync now'&&!b.disabled)");
        consent(context,"Allow downloads and recoverable deletions in Thingtime offline?","Cancel",()->{
            click(web,"Sync now");DeviceLiveTest.awaitTrue(web,"document.body.innerText.includes('Download approval cancelled')");
        });
        same(before,DeviceLiveTest.verifyCloudBytes(context,scope,root,expected));
        consent(context,"Allow downloads and recoverable deletions in Thingtime offline?","Allow sync and trash",()->sync(web,"Retry transfer"));
        same(before,DeviceLiveTest.verifyCloudBytes(context,scope,root,expected));
        System.out.println("ANDROID_SYNC_DELETION_CONSENT_PASS");

        JSONArray nodes=DeviceLiveTest.webApi(web,"/api/v1/files?rootId="+cloud.getString("rootId"),"GET",null).getJSONObject("inventory").getJSONArray("nodes");
        JSONObject child=null,parent=null;
        for(int i=0;i<nodes.length();i++){JSONObject node=nodes.getJSONObject(i);if(node.getString("path").equals("nested/sample.bin"))child=node.getJSONObject("file");if(node.getString("path").equals("nested"))parent=node;}
        assertNotNull(child);assertNotNull(parent);assertEquals(cloud.getString("nestedId"),parent.getString("id"));
        JSONObject content=child.getJSONObject("content");
        DeviceLiveTest.webApi(web,"/api/v1/files","POST",new JSONObject().put("id",child.getString("id")).put("operationId",java.util.UUID.randomUUID().toString())
            .put("expectedRevision",child.getString("revision")).put("name",child.getString("name")).put("folderId",child.get("folderId"))
            .put("attachmentId",content.getString("attachmentId")).put("contentVersion",content.getString("version")).put("trashed",true));
        DeviceLiveTest.webApi(web,"/api/v1/things?id="+parent.getString("id"),"DELETE",null);

        // Suppress an actual committed response, then stop through the production
        // control. No invented success/receipt is supplied to the executor.
        DeviceLiveTest.evaluate(web,"window.__lostTrash=null;window.__trashRequests=new Map();window.__trashOriginalPost=window.thingtimeNativeBridge.postMessage;window.thingtimeNativeBridge.postMessage=m=>{if(m.type==='mobile-files'&&m.payload.action==='trash')window.__trashRequests.set(m.payload.requestId,m.payload.trash);return window.__trashOriginalPost(m)};window.__loseTrash=e=>{const p=e.detail?.payload;if(e.detail?.type==='mobile-files-result'&&p?.trash?.status==='complete'&&window.__trashRequests.has(p.requestId)&&!window.__lostTrash){window.__lostTrash={request:window.__trashRequests.get(p.requestId),receipt:p.trash.receipt};e.stopImmediatePropagation();Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Stop transfer').click()}};window.addEventListener('thingtime:native-message',window.__loseTrash,true)");
        click(web,"Sync now");DeviceLiveTest.awaitTrue(web,"window.__lostTrash!==null && !Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Stop transfer')");
        JSONObject lost=new JSONObject(new JSONTokener(DeviceLiveTest.evaluate(web,"JSON.stringify(window.__lostTrash)")).nextValue().toString());
        assertEquals("nested/sample.bin",lost.getJSONObject("request").getJSONObject("operation").getJSONObject("mutation").getString("path"));
        JSONArray operations=journal(web,configuration);assertEquals(2,operations.length());
        for(int i=0;i<operations.length();i++)assertFalse(operations.getJSONObject(i).getBoolean("confirmed"));
        assertEquals(operations.getJSONObject(0).getString("id"),lost.getJSONObject("receipt").getString("operationId"));
        JSONArray retained=request(web,scope,grant,"trash-list").getJSONObject("trashPage").getJSONArray("items");assertEquals(1,retained.length());
        try(ManagedFileStore store=fixture.store()){JSONArray entries=store.scan(scope,root);assertEquals(3,entries.length());for(int i=0;i<entries.length();i++)assertNotEquals("nested/sample.bin",entries.getJSONObject(i).getString("path"));}
        System.out.println("ANDROID_SYNC_DELETION_LOST_REPLY_PASS");

        DeviceLiveTest.evaluate(web,"window.__beforeDeletionReload=true");
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->web.loadUrl(scope.origin+"/things"));
        DeviceLiveTest.awaitTrue(web,"window.__beforeDeletionReload===undefined && window.thingtimeNativeBridge?.platform==='android' && document.body.innerText.includes('This device is paired to your account') && document.body.innerText.includes('Android cloud download acceptance')");
        same(operations,journal(web,configuration));
        System.out.println("ANDROID_SYNC_DELETION_RELOAD_PASS");
        // The persisted interrupted progress exposes Retry transfer after reload;
        // it resumes the unfinished run using the original operation IDs.
        sync(web,"Retry transfer");
        JSONArray resumed=journal(web,configuration);assertEquals(operations.length(),resumed.length());
        for(int i=0;i<operations.length();i++){assertEquals(operations.getJSONObject(i).getString("id"),resumed.getJSONObject(i).getString("id"));assertTrue(resumed.getJSONObject(i).getBoolean("confirmed"));}
        retained=request(web,scope,grant,"trash-list").getJSONObject("trashPage").getJSONArray("items");assertEquals(2,retained.length());
        JSONArray remaining;try(ManagedFileStore store=fixture.store()){remaining=store.scan(scope,root);assertEquals(2,remaining.length());}
        sync(web,"Sync now");try(ManagedFileStore store=fixture.store()){same(remaining,store.scan(scope,root));}
        assertEquals(2,request(web,scope,grant,"trash-list").getJSONObject("trashPage").getJSONArray("items").length());
        System.out.println("ANDROID_SYNC_DELETION_RESUME_PASS");
        JSONObject folderItem=null,fileItem=null;
        for(int i=0;i<retained.length();i++){JSONObject item=retained.getJSONObject(i);assertEquals(configuration,item.getJSONObject("request").getJSONObject("scope").getString("rootId"));if(item.getString("kind").equals("folder"))folderItem=item;else fileItem=item;}
        assertNotNull(folderItem);assertNotNull(fileItem);
        for(JSONObject item:new JSONObject[]{folderItem,fileItem}) {
            JSONObject trash=item.getJSONObject("request"),inspect=DeviceLiveTest.folderRequest(web,scope,new JSONObject().put("action","trash-inspect").put("rootId",grant).put("trash",trash));
            JSONObject restore=new JSONObject().put("path",trash.getJSONObject("operation").getJSONObject("mutation").getString("path")).put("expected",inspect.getJSONObject("retainedEntry"));
            JSONObject input=new JSONObject().put("action","trash-restore-reviewed").put("rootId",grant).put("trash",trash).put("restore",restore);
            consent(context,"Restore to Thingtime offline?","Restore",()->DeviceLiveTest.folderRequest(web,scope,input));
            assertNotNull(DeviceLiveTest.folderRequest(web,scope,new JSONObject(input.toString())).getJSONObject("restoredEntry"));
        }
        DeviceLiveTest.verifyCloudBytes(context,scope,root,expected);
        assertEquals(0,request(web,scope,grant,"trash-list").getJSONObject("trashPage").getJSONArray("items").length());
        DeviceLiveTest.verifyPageLayout(web);
        System.out.println("ANDROID_SYNC_DELETION_PASS: real planner/native consent, cloud child-parent removal, lost committed reply, WebView/IndexedDB reload with original operation IDs, repeat convergence and reviewed byte-exact tree restoration.");
    }
}
