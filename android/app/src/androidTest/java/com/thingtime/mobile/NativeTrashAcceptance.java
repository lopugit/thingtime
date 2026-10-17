package com.thingtime.mobile;

import android.content.Context;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.json.JSONArray;
import static org.junit.Assert.*;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.*;

/** Opt-in real authenticated WebView bridge, native dialogs and shared recovery
 * screen. Invoked only for the disposable selected offline-folder fixture. */
final class NativeTrashAcceptance {
    static void run(WebView web,Context context,DeviceScope scope,String grantId,ManagedFileStoreTest fixture) throws Exception {
        DeviceLiveTest.awaitTrue(web,"window.thingtimeNativeBridge.fileTrashVersion==='1.2.0'");
        JSONObject entry=null;
        try(ManagedFileStore s=fixture.store()){JSONArray entries=s.scan(scope,fixture.root);for(int i=0;i<entries.length();i++)if(entries.getJSONObject(i).getString("path").equals("nested/original.bin"))entry=entries.getJSONObject(i);}
        assertNotNull(entry);JSONObject request=ManagedTrashTest.request(fixture,entry);
        request.getJSONObject("scope").put("deviceId",new KeystoreDeviceStore(context).load(scope).getString("deviceId"));
        WriteApproval approval=new WriteApproval(new JSONObject().put("scope",request.getJSONObject("scope")).put("configurationRevision","1").put("configurationHash","a".repeat(64)).put("allowTrash",true),scope);
        JSONObject approve=new JSONObject().put("action","write-approve").put("rootId",grantId).put("approval",approval.json());
        ExecutorService ui=Executors.newSingleThreadExecutor();
        try {
            Future<?> cancel=ui.submit(()->dialog(context,"Allow downloads and recoverable deletions in ThingtimeOfflineQA?","Cancel","native-trash-cancel.png"));
            assertTrue(DeviceLiveTest.folderReply(web,scope,new JSONObject(approve.toString())).has("error"));cancel.get(60,TimeUnit.SECONDS);
            JSONObject deletion=new JSONObject().put("action","trash").put("rootId",grantId).put("trash",request).put("approval",approval.json());
            assertTrue(DeviceLiveTest.folderReply(web,scope,new JSONObject(deletion.toString())).has("error"));
            Future<?> allow=ui.submit(()->dialog(context,"Allow downloads and recoverable deletions in ThingtimeOfflineQA?","Allow sync and trash","native-trash-approval.png"));
            DeviceLiveTest.folderRequest(web,scope,new JSONObject(approve.toString()));allow.get(60,TimeUnit.SECONDS);
            JSONObject removed=DeviceLiveTest.folderRequest(web,scope,deletion).getJSONObject("trash");assertEquals("complete",removed.getString("status"));
            assertEquals("complete",DeviceLiveTest.folderRequest(web,scope,new JSONObject().put("action","trash-lookup").put("rootId",grantId).put("trash",request)).getJSONObject("trash").getString("status"));
            JSONObject inspected=DeviceLiveTest.folderRequest(web,scope,new JSONObject().put("action","trash-inspect").put("rootId",grantId).put("trash",request));
            assertTrue(SyncTrash.same(entry,inspected.getJSONObject("retainedEntry")));assertTrue(inspected.isNull("restoreIntent"));
            DeviceLiveTest.awaitTrue(web,"document.body.innerText.includes('Recover device files')");
            DeviceLiveTest.evaluate(web,"(()=>{const l=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='Device folder');const s=document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,"+JSONObject.quote(grantId)+");s.dispatchEvent(new Event('change',{bubbles:true}));})()");
            click(web,"Find retained files");DeviceLiveTest.awaitTrue(web,"document.body.innerText.includes('Retained on this device')");click(web,"Review restore");
            DeviceLiveTest.awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Restore file or folder'&&!b.disabled)");
            assertEquals("true",DeviceLiveTest.evaluate(web,"document.documentElement.scrollWidth<=window.innerWidth+1"));
            DeviceLiveTest.verifyPageLayout(web);
            DeviceLiveTest.evaluate(web,"Array.from(document.querySelectorAll('p')).find(e=>e.textContent==='Recover device files')?.scrollIntoView({block:'start'})");
            screenshot(context,"native-trash-recovery-screen.png");
            Future<?> denied=ui.submit(()->dialog(context,"Restore to ThingtimeOfflineQA?","Cancel","native-trash-restore-cancel.png"));click(web,"Restore file or folder");denied.get(60,TimeUnit.SECONDS);
            DeviceLiveTest.awaitTrue(web,"document.body.innerText.includes('Restore cancelled. The retained file is preserved.')");
            try(ManagedFileStore s=fixture.store()){assertEquals(1,s.scan(scope,fixture.root).length());}
            Future<?> restored=ui.submit(()->dialog(context,"Restore to ThingtimeOfflineQA?","Restore","native-trash-restore-approve.png"));click(web,"Restore file or folder");restored.get(60,TimeUnit.SECONDS);
            DeviceLiveTest.awaitTrue(web,"document.body.innerText.includes('Restored to nested/original.bin.')");
            JSONObject target=new JSONObject().put("path","nested/original.bin").put("expected",entry);
            JSONObject replay=DeviceLiveTest.folderRequest(web,scope,new JSONObject().put("action","trash-restore-reviewed").put("rootId",grantId).put("trash",request).put("restore",target)).getJSONObject("restoredEntry");
            assertEquals(entry.getString("id"),replay.getString("id"));assertNotEquals(entry.getString("version"),replay.getString("version"));
            byte[] expected=new byte[17];java.util.Arrays.fill(expected,(byte)13);assertArrayEquals(expected,fixture.read(replay,8*1024*1024,17));
            DeviceLiveTest.folderRequest(web,scope,new JSONObject(deletion.toString()));
            assertEquals(0,DeviceLiveTest.folderRequest(web,scope,new JSONObject().put("action","trash-list").put("rootId",grantId)).getJSONObject("trashPage").getJSONArray("items").length());
            System.out.println("NATIVE_TRASH_QA_PASS: real identity, distinct delete consent, cancellation, atomic removal, shared recovery UI, separate restore consent, exact replay and original bytes.");
        } finally{ui.shutdownNow();}
    }
    static void click(WebView web,String label) throws Exception {
        DeviceLiveTest.awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==="+JSONObject.quote(label)+"&&!b.disabled)");
        DeviceLiveTest.evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==="+JSONObject.quote(label)+"&&!b.disabled).click()");
    }
    private static void screenshot(Context context,String name) throws Exception {
        try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),name))){assertTrue(InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,output));}
    }
    private static AccessibilityNodeInfo find(AccessibilityNodeInfo node,String text) {
        if(node==null)return null;if(node.getText()!=null && node.getText().toString().equalsIgnoreCase(text))return node;
        for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo found=find(node.getChild(i),text);if(found!=null)return found;}return null;
    }
    static void dialog(Context context,String title,String button,String image) {
        try {
            long until=System.currentTimeMillis()+60000;
            while(System.currentTimeMillis()<until) {
                AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
                if(find(root,title)!=null){AccessibilityNodeInfo selected=find(root,button);assertNotNull(selected);screenshot(context,image);assertTrue(selected.performAction(AccessibilityNodeInfo.ACTION_CLICK));return;}
                Thread.sleep(200);
            }
            fail("Expected native consent dialog: "+title);
        }catch(Exception error){throw new RuntimeException(error);}
    }
}
