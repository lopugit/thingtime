package com.thingtime.mobile;

import android.content.Context;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.json.JSONArray;
import org.json.JSONTokener;
import static org.junit.Assert.*;
import java.util.concurrent.*;

/** Installed shared recovery controls, durable UI intent and real native consent. */
final class NativeVersionAcceptance {
    static void select(WebView web,String grant) throws Exception {
        DeviceLiveTest.awaitTrue(web,"(()=>{const l=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='Show replaced versions');return !!l && !l.querySelector('input').disabled})()");
        DeviceLiveTest.evaluate(web,"(()=>{const l=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='Device folder');const s=document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,"+JSONObject.quote(grant)+");s.dispatchEvent(new Event('change',{bubbles:true}));const c=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='Show replaced versions');if(!c.querySelector('input').checked)c.click();})()");
        NativeTrashAcceptance.click(web,"Find replaced versions");
    }
    static String intent(WebView web,String grant) throws Exception {
        return new JSONTokener(DeviceLiveTest.evaluate(web,"(()=>{const keys=Object.keys(localStorage).filter(k=>k.startsWith('tt:native-version-restore:')&&k.includes("+JSONObject.quote(grant)+"));if(keys.length!==1)throw Error('Expected one saved version restore');return localStorage.getItem(keys[0]);})()")).nextValue().toString();
    }
    static void run(WebView web,Context context,DeviceScope owner,String grant,ManagedFileStoreTest fixture) throws Exception {
        DeviceLiveTest.awaitTrue(web,"window.thingtimeNativeBridge.fileVersionsVersion==='1.0.0'");
        JSONObject original=null;
        try(ManagedFileStore store=fixture.store()){JSONArray entries=store.scan(owner,fixture.root);for(int i=0;i<entries.length();i++)if(entries.getJSONObject(i).getString("path").equals("nested/original.bin"))original=entries.getJSONObject(i);}
        assertNotNull(original);byte[] replacement=new byte[8*1024*1024+17];java.util.Arrays.fill(replacement,(byte)14);
        JSONObject edit=fixture.request("nested/original.bin",replacement,true);edit.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",original);
        JSONObject current=fixture.publish(edit,replacement).getJSONObject("entry");
        select(web,grant);NativeTrashAcceptance.click(web,"Review version");
        DeviceLiveTest.awaitTrue(web,"Array.from(document.querySelectorAll('label')).some(l=>l.textContent.trim()==='New copy path within this folder')");
        DeviceLiveTest.evaluate(web,"(()=>{const l=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='New copy path within this folder');const s=document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'nested/earlier-copy.bin');s.dispatchEvent(new Event('input',{bubbles:true}));})()");
        ExecutorService dialogs=Executors.newSingleThreadExecutor();
        try {
            Future<?> cancel=dialogs.submit(()->NativeTrashAcceptance.dialog(context,"Restore to ThingtimeOfflineQA?","Cancel","native-version-cancel.png"));
            NativeTrashAcceptance.click(web,"Restore version copy");cancel.get(60,TimeUnit.SECONDS);
            DeviceLiveTest.awaitTrue(web,"document.body.innerText.includes('Restore cancelled. The retained file is preserved.')");
            String saved=intent(web,grant);JSONObject restore=new JSONObject(saved);assertEquals("nested/earlier-copy.bin",restore.getString("path"));
            try(ManagedFileStore store=fixture.store()){assertEquals(2,store.scan(owner,fixture.root).length());}
            DeviceLiveTest.evaluate(web,"window.__versionOldDocument=true");
            InstrumentationRegistry.getInstrumentation().runOnMainSync(web::reload);
            DeviceLiveTest.awaitTrue(web,"window.__versionOldDocument!==true && document.body.innerText.includes('Show replaced versions')",120000);
            select(web,grant);NativeTrashAcceptance.click(web,"Resume version restore");
            Future<?> approve=dialogs.submit(()->NativeTrashAcceptance.dialog(context,"Restore to ThingtimeOfflineQA?","Restore","native-version-approve.png"));
            assertEquals(saved,intent(web,grant));approve.get(60,TimeUnit.SECONDS);
            DeviceLiveTest.awaitTrue(web,"document.body.innerText.includes('Restored to nested/earlier-copy.bin.')");
            JSONObject request=new JSONObject().put("action","version-restore-reviewed").put("rootId",grant).put("restore",restore);
            JSONObject replay=DeviceLiveTest.folderRequest(web,owner,request).getJSONObject("restoredEntry");
            assertNotEquals(original.getString("id"),replay.getString("id"));assertArrayEquals(java.util.Arrays.copyOfRange(replacement,8*1024*1024,replacement.length),fixture.read(current,8*1024*1024,17));
            // Use the provider stream for the whole independently hashed restored file.
            byte[] expected=new byte[replacement.length];java.util.Arrays.fill(expected,(byte)13);
            try(android.os.ParcelFileDescriptor fd=context.getContentResolver().openFileDescriptor(OfflineDocumentsProvider.rootUri(context,fixture.root+":"+replay.getString("id")),"r");java.io.InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(fd)) {
                assertArrayEquals(java.security.MessageDigest.getInstance("SHA-256").digest(expected),java.security.MessageDigest.getInstance("SHA-256").digest(in.readAllBytes()));
            }
            assertEquals(1,DeviceLiveTest.folderRequest(web,owner,new JSONObject().put("action","version-list").put("rootId",grant)).getJSONObject("versionPage").getJSONArray("items").length());
            DeviceLiveTest.verifyPageLayout(web);
            DeviceLiveTest.evaluate(web,"Array.from(document.querySelectorAll('p')).find(e=>e.textContent==='Recover device files')?.scrollIntoView({block:'start'})");
            NativeTrashAcceptance.screenshot(context,"native-version-restored.png");
            DeviceLiveTest.progress("NATIVE_VERSION_QA_PASS: real retained replacement, review/cancel, saved operation across WebView reload, native approval, independent restored copy/hash, unchanged current bytes and exact replay.");
        } finally {dialogs.shutdownNow();}
    }
}
