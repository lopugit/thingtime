package com.thingtime.mobile;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import static org.junit.Assert.*;
import java.util.*;

/** Opt-in installed permission/picker and real cloud backup of owned test media. */
final class PhotoBackupAcceptance {
    static void run(WebView web,Context context,DeviceScope scope) throws Exception {
        PhotoLibraryTest fixture=new PhotoLibraryTest();fixture.before();Uri original=fixture.create("live",false);
        InstrumentationRegistry.getInstrumentation().getUiAutomation().dropShellPermissionIdentity();
        String grant=null,cloud=null,connection=null;String name="Photo backup acceptance "+UUID.randomUUID();
        try {
            DeviceLiveTest.progress("PHOTO_BACKUP_QA_READY: Choose folder > Photo library (backup), cancel the explanation once, then choose photo access and select Photo library in Files. Only the owned test image will upload.");
            FolderStore folders=new FolderStore(context);long deadline=System.currentTimeMillis()+300000;
            while(System.currentTimeMillis()<deadline && grant==null) {
                JSONArray roots=folders.list(scope);
                for(int i=0;i<roots.length();i++){String id=roots.getJSONObject(i).getString("id");if(PhotoLibrary.owns(context,folders.grant(scope,id)))grant=id;}
                if(grant==null)Thread.sleep(300);
            }
            assertNotNull("Choose the native photo library",grant);
            JSONObject nativeRoot=null;JSONArray roots=DeviceLiveTest.folderRequest(web,scope,new JSONObject().put("action","list")).getJSONArray("roots");
            for(int i=0;i<roots.length();i++)if(roots.getJSONObject(i).getString("id").equals(grant))nativeRoot=roots.getJSONObject(i);
            assertNotNull(nativeRoot);assertEquals("photos",nativeRoot.getString("sourceKind"));assertFalse(nativeRoot.has("publicationVersion"));assertNotEquals("unavailable",nativeRoot.getString("photoAccess"));
            assertEquals("Photo libraries are read-only backup sources.",DeviceLiveTest.folderReply(web,scope,new JSONObject().put("action","write-approve").put("rootId",grant)).getString("error"));
            JSONArray entries=DeviceLiveTest.folderRequest(web,scope,new JSONObject().put("action","scan").put("rootId",grant)).getJSONArray("entries");
            JSONArray excluded=new JSONArray();String path=null;
            String prefix=android.content.ContentUris.parseId(original)+"-";
            for(int i=0;i<entries.length();i++){JSONObject e=entries.getJSONObject(i);if(!e.getString("kind").equals("file"))continue;if(e.getString("path").contains(prefix))path=e.getString("path");else excluded.put(e.getString("path"));}
            assertNotNull("Permission selection must include the synthetic image",path);assertTrue(excluded.length()<=100);
            NativeTrashAcceptance.click(web,"Add connection");
            DeviceLiveTest.evaluate(web,"(()=>{const l=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='Device folder'&&document.getElementById(x.htmlFor)?.tagName==='SELECT');const s=document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,"+JSONObject.quote(grant)+");s.dispatchEvent(new Event('change',{bubbles:true}));})()");
            DeviceLiveTest.awaitTrue(web,"(()=>{const l=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.trim()==='Direction');const s=l&&document.getElementById(l.htmlFor);return s?.value==='backup' && s.disabled})()");
            NativeTrashAcceptance.screenshot(context,"photo-backup-editor.png");
            DeviceLiveTest.verifyPageLayout(web);NativeTrashAcceptance.click(web,"Discard draft");
            DeviceLiveTest.progress("PHOTO_EDITOR_PASS");
            cloud=DeviceLiveTest.webApi(web,"/api/v1/things","POST",new JSONObject().put("thingtime",new JSONArray().put("folder")).put("crystal",new JSONObject().put("name",name))).getJSONObject("thing").getString("id");
            DeviceLiveTest.progress("PHOTO_CLOUD_ROOT_CREATED");
            JSONObject config=new JSONObject().put("configurationVersion",1).put("name",name).put("deviceId",new KeystoreDeviceStore(context).load(scope).getString("deviceId")).put("localRootId",grant).put("sourceKind","photos").put("remoteFolderId",cloud).put("mode","backup").put("paused",false).put("propagateDeletes",false).put("network","any").put("chargingOnly",false).put("excludedPaths",excluded);
            connection=DeviceLiveTest.webApi(web,"/api/v1/things","POST",new JSONObject().put("thingtime",new JSONArray().put("file-sync")).put("crystal",config)).getJSONObject("thing").getString("id");
            DeviceLiveTest.progress("PHOTO_CONNECTION_CREATED");
            NativeTrashAcceptance.click(web,"Refresh");
            String card="Array.from(document.querySelectorAll('p')).find(e=>e.textContent==="+JSONObject.quote(name)+")?.parentElement?.parentElement";
            DeviceLiveTest.progress("PHOTO_START_UPLOAD");upload(web,card);JSONObject first=file(web,cloud,path);verifyBytes(web,first,fixture.bytes);DeviceLiveTest.progress("PHOTO_FIRST_HASH_PASS");
            // Local deletion must never delete an uploaded cloud copy. A new image must still back up.
            Uri second=fixture.create("new",false);context.getContentResolver().delete(original,null,null);fixture.created.remove(original);Thread.sleep(400);
            upload(web,card);assertEquals(first.getString("revision"),file(web,cloud,path).getString("revision"));
            JSONArray cloudNodes=inventory(web,cloud);JSONObject added=null;
            for(int i=0;i<cloudNodes.length();i++){JSONObject n=cloudNodes.getJSONObject(i);if(n.getString("path").contains(android.content.ContentUris.parseId(second)+"-"))added=n.getJSONObject("file");}
            assertNotNull(added);verifyBytes(web,added,fixture.bytes);
            upload(web,card);assertEquals(cloudNodes.toString(),inventory(web,cloud).toString());
            NativeTrashAcceptance.screenshot(context,"photo-backup-complete.png");
            DeviceLiveTest.progress("PHOTO_BACKUP_PASS: real permission and tree selection, backup-only editor, original cloud SHA-256, added photo, retained cloud copy after device deletion, repeat without duplicate publication.");
        } finally {
            if(cloud!=null){JSONArray nodes=inventory(web,cloud);for(int i=nodes.length()-1;i>=0;i--){JSONObject n=nodes.getJSONObject(i);if(n.getString("kind").equals("file")){JSONObject f=n.getJSONObject("file"),c=f.getJSONObject("content");DeviceLiveTest.webApi(web,"/api/v1/files","POST",new JSONObject().put("id",f.getString("id")).put("operationId",UUID.randomUUID().toString()).put("expectedRevision",f.getString("revision")).put("name",f.getString("name")).put("folderId",f.get("folderId")).put("attachmentId",c.getString("attachmentId")).put("contentVersion",c.getString("version")).put("trashed",true));}}}
            if(connection!=null)DeviceLiveTest.webApi(web,"/api/v1/things?id="+connection,"DELETE",null);
            if(cloud!=null)DeviceLiveTest.webApi(web,"/api/v1/things?id="+cloud,"DELETE",null);
            if(grant!=null)new FolderStore(context).remove(scope,grant);fixture.after();
        }
    }
    static void upload(WebView web,String card) throws Exception {
        DeviceLiveTest.awaitTrue(web,"Array.from(("+card+")?.querySelectorAll('button')||[]).some(b=>['Upload now','Upload again'].includes(b.textContent.trim())&&!b.disabled)");
        DeviceLiveTest.evaluate(web,"Array.from(("+card+").querySelectorAll('button')).find(b=>['Upload now','Upload again'].includes(b.textContent.trim())&&!b.disabled).click()");
        DeviceLiveTest.awaitTrue(web,"("+card+")?.querySelector('[role=status]')?.textContent==='Last transfer finished.' && Array.from(("+card+").querySelectorAll('button')).some(b=>b.textContent.trim()==='Upload now'&&!b.disabled)",240000);
    }
    static JSONArray inventory(WebView web,String root) throws Exception{return DeviceLiveTest.webApi(web,"/api/v1/files?rootId="+root,"GET",null).getJSONObject("inventory").getJSONArray("nodes");}
    static JSONObject file(WebView web,String root,String path) throws Exception {JSONArray nodes=inventory(web,root);for(int i=0;i<nodes.length();i++)if(nodes.getJSONObject(i).getString("path").equals(path))return nodes.getJSONObject(i).getJSONObject("file");throw new AssertionError("Missing photo backup");}
    static void verifyBytes(WebView web,JSONObject file,byte[] expected) throws Exception {
        JSONObject content=file.getJSONObject("content");assertEquals(expected.length,content.getLong("size"));
        DeviceLiveTest.evaluate(web,"window.__photoHash=null;(async()=>{const r=await fetch("+JSONObject.quote("/api/v1/attachments/content?id="+content.getString("attachmentId")+"&cache=bytes")+");if(!r.ok){window.__photoHash='failed';return;}const hash=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());window.__photoHash=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')})()");
        DeviceLiveTest.awaitTrue(web,"window.__photoHash!==null");assertEquals(FolderReader.hex(java.security.MessageDigest.getInstance("SHA-256").digest(expected)),new JSONTokener(DeviceLiveTest.evaluate(web,"window.__photoHash")).nextValue());
    }
}
