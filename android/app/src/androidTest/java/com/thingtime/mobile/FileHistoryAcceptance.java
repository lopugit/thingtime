package com.thingtime.mobile;

import static com.thingtime.mobile.DeviceLiveTest.*;
import static org.junit.Assert.*;
import android.content.Context;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import org.json.*;

/** Real API, real History UI and exact byte readback in the installed debug app. */
final class FileHistoryAcceptance {
    private static String uuid() { return UUID.randomUUID().toString(); }
    private static void click(WebView web,String label) throws Exception {
        String selector="Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==="+JSONObject.quote(label)+"&&!b.disabled)";
        awaitTrue(web,"!!("+selector+")");evaluate(web,selector+".click()");
    }
    private static void awaitExport(WebView web,String success) throws Exception {
        awaitTrue(web,"("+success+") || !!document.querySelector('[aria-label=\"Version details\"] [role=alert]')",300000);
        assertEquals("true",evaluate(web,success));
    }
    private static void navigate(WebView web,String url) {
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->web.loadUrl(url));
    }
    private static JSONObject upload(WebView web,byte[] bytes) throws Exception {
        JSONObject start=webApi(web,"/api/v1/attachments/uploads","POST",new JSONObject().put("requestId",uuid()).put("filename","android-history-acceptance.bin")
            .put("contentType","application/octet-stream").put("sizeBytes",bytes.length).put("purpose","file"));
        String id=start.getJSONObject("upload").getString("id");
        try {
            JSONObject part=webApi(web,"/api/v1/attachments/uploads/parts","POST",new JSONObject().put("uploadId",id).put("parts",new JSONArray().put(new JSONObject()
                .put("partNumber",1).put("checksumSha256",java.util.Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes)))))).getJSONArray("parts").getJSONObject(0);
            evaluate(web,"window.__historyUpload=null;(async()=>{try{const p="+part+";const u=new URL(p.url,location.href);if(u.protocol!=='https:'&&u.origin!==location.origin)throw Error('Unexpected upload origin');const r=await fetch(u,{method:'PUT',redirect:'error',credentials:'omit',headers:p.headers,body:Uint8Array.from(atob("+JSONObject.quote(java.util.Base64.getEncoder().encodeToString(bytes))+"),c=>c.charCodeAt(0))});window.__historyUpload=r.ok;}catch{window.__historyUpload=false}})()");
            awaitTrue(web,"window.__historyUpload!==null");assertEquals("true",evaluate(web,"window.__historyUpload"));
            webApi(web,"/api/v1/attachments/uploads/complete","POST",new JSONObject().put("uploadId",id));
            JSONObject content=webApi(web,"/api/v1/attachments/content?id="+id+"&fingerprint=1","GET",null);
            return new JSONObject().put("attachmentId",id).put("version",content.getString("version"));
        } catch(Exception | AssertionError failure) {
            webApi(web,"/api/v1/attachments/delete","POST",new JSONObject().put("id",id));throw failure;
        }
    }
    private static JSONObject commit(String id,Object revision,JSONObject content,String name,boolean trashed) throws Exception {
        return new JSONObject().put("id",id).put("operationId",uuid()).put("expectedRevision",revision).put("name",name).put("folderId",JSONObject.NULL)
            .put("attachmentId",content.getString("attachmentId")).put("contentVersion",content.getString("version")).put("trashed",trashed);
    }
    static void run(WebView web,Context context,DeviceScope scope) throws Exception {
        byte[] before=new byte[128],after=new byte[257];Arrays.fill(before,(byte)11);Arrays.fill(after,(byte)22);
        String id=uuid(), name="Android history "+id+".bin";JSONObject first=null,second=null,current=null;
        try {
            first=upload(web,before);second=upload(web,after);
            current=webApi(web,"/api/v1/files","POST",commit(id,JSONObject.NULL,first,name,false)).getJSONObject("file");
            current=webApi(web,"/api/v1/files","POST",commit(id,current.getString("revision"),second,name,false)).getJSONObject("file");
            String replacementRevision=current.getString("revision");
            System.out.println("FILE_HISTORY_SEEDED: two private byte versions created.");
            navigate(web,scope.origin+"/history?storage=home&kind=file&q=Android&thing="+id);
            awaitTrue(web,"document.querySelectorAll('.history-event').length===2");
            assertEquals("true",evaluate(web,"Array.from(document.querySelectorAll('.history-snapshot-title')).every(n=>n.textContent.includes('Android history '))"));
            evaluate(web,"document.querySelector('.history-event[data-operation=update]').click()");
            awaitTrue(web,"document.querySelector('[aria-label=\"Version details\"]') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Review restore'&&!b.disabled)");
            assertEquals("true",evaluate(web,"document.body.innerText.includes('128 bytes') && document.body.innerText.includes('257 bytes')"));
            if("true".equals(InstrumentationRegistry.getArguments().getString("fileExport"))) {
                System.out.println("FILE_EXPORT_PICKER_READY: Cancel the first Save As, then save each of the two historical versions to Downloads. Name: "+name);
                evaluate(web,"window.__exportReplies=[];window.addEventListener('thingtime:native-message',e=>{if(e.detail?.type==='file-export-result')window.__exportReplies.push(e.detail.payload)})");
                click(web,"Save this version");
                awaitTrue(web,"document.body.innerText.includes('Save cancelled. This version remains in History.')",300000);
                System.out.println("FILE_EXPORT_CANCEL_PASS: Now save the earlier 128-byte version.");
                click(web,"Save this version");
                awaitExport(web,"document.body.innerText.includes('File saved and checked. This version remains in History.')");
                System.out.println("FILE_EXPORT_FIRST_PASS: Now save the later 257-byte version; keep the collision suffix.");
                evaluate(web,"Array.from(document.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Save this version')[1].click()");
                awaitExport(web,"Array.from(document.querySelectorAll('[role=status]')).filter(n=>n.textContent.includes('File saved and checked.')).length===2");
                System.out.println("FILE_EXPORT_PASS: Cancel, save both versions and provider byte verification. Independent Downloads readback filename: "+name);
            }
            click(web,"Review restore");click(web,"Cancel restore");
            assertEquals(replacementRevision,webApi(web,"/api/v1/files?id="+id,"GET",null).getJSONObject("file").getString("revision"));
            System.out.println("FILE_HISTORY_CANCEL_PASS: review opened; cancel left the revision unchanged.");
            click(web,"Review restore");
            awaitTrue(web,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Restore this version'&&!b.disabled)");
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Restore this version').scrollIntoView({block:'center'})");
            awaitTrue(web,"(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Restore this version');const r=b?.getBoundingClientRect();return !!r&&r.top>=0&&r.bottom<=innerHeight})()");
            evaluate(web,"window.__historyPainted=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__historyPainted=true))");
            awaitTrue(web,"window.__historyPainted===true");
            try(FileOutputStream screenshot=new FileOutputStream(new File(context.getFilesDir(),"file-history-qa.png"))) {
                InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,screenshot);
            }
            click(web,"Restore this version");
            awaitTrue(web,"document.body.innerText.includes('File version restored. Earlier versions remain in History.')");
            current=webApi(web,"/api/v1/files?id="+id,"GET",null).getJSONObject("file");
            assertEquals(first.getString("attachmentId"),current.getJSONObject("content").getString("attachmentId"));
            assertNotEquals(replacementRevision,current.getString("revision"));assertEquals(name,current.getString("name"));
            for(JSONObject content:new JSONObject[]{first,second}) {
                byte[] expected=content==first?before:after;
                evaluate(web,"window.__historyHash=null;fetch('/api/v1/attachments/content?id="+content.getString("attachmentId")+"&cache=bytes',{redirect:'error'}).then(async r=>{if(!r.ok)throw Error('Download refused');const b=await r.arrayBuffer();window.__historyHash={size:b.byteLength,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('')}}).catch(()=>window.__historyHash={error:true})");
                awaitTrue(web,"window.__historyHash!==null");
                JSONObject result=new JSONObject(new JSONTokener(evaluate(web,"JSON.stringify(window.__historyHash)")).nextValue().toString());
                assertEquals(expected.length,result.getInt("size"));assertEquals(FolderReader.hex(MessageDigest.getInstance("SHA-256").digest(expected)),result.getString("hash"));
            }
            assertEquals("true",evaluate(web,"document.documentElement.scrollWidth<=innerWidth+1"));
            System.out.println("FILE_HISTORY_PASS: real installed History, two retained versions, cancel without writes, guarded restore, both exact byte hashes. Native export is separately opt-in.");
        } catch(Exception | AssertionError failure) {
            System.out.println("FILE_EXPORT_REPLIES: "+evaluate(web,"JSON.stringify(window.__exportReplies || [])"));
            System.out.println("FILE_HISTORY_DETAIL: "+evaluate(web,"document.querySelector('[aria-label=\"Version details\"]')?.innerText || 'No selected version'"));
            throw failure;
        } finally {
            if(current!=null) {
                current=webApi(web,"/api/v1/files?id="+id,"GET",null).getJSONObject("file");
                webApi(web,"/api/v1/files","POST",commit(id,current.getString("revision"),current.getJSONObject("content"),current.getString("name"),true));
            } else if(first!=null) webApi(web,"/api/v1/attachments/delete","POST",new JSONObject().put("id",first.getString("attachmentId")));
            if(second!=null && (current==null || !second.getString("attachmentId").equals(current.getJSONObject("content").getString("attachmentId")))) {
                // A bound former version is intentionally retained. Only delete an upload never committed.
                JSONObject history=webApi(web,"/api/v1/timeline?ownerId="+scope.owner+"&dataPlane=home&thingId="+id,"GET",null);
                if(!history.toString().contains(second.getString("attachmentId"))) webApi(web,"/api/v1/attachments/delete","POST",new JSONObject().put("id",second.getString("attachmentId")));
            }
            navigate(web,scope.origin+"/things");awaitTrue(web,"document.body.innerText.includes('This device is paired to your account')");
        }
    }
}
