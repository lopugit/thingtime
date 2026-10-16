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
    private static String evaluate(android.webkit.WebView web,String js) throws Exception {
        java.util.concurrent.ArrayBlockingQueue<String> result=new java.util.concurrent.ArrayBlockingQueue<>(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->web.evaluateJavascript(js,result::offer));
        String value=result.poll(10,java.util.concurrent.TimeUnit.SECONDS); assertNotNull("WebView evaluation timed out",value); return value;
    }
    private static void awaitTrue(android.webkit.WebView web,String js) throws Exception {
        awaitTrue(web,js,60000);
    }
    private static void awaitTrue(android.webkit.WebView web,String js,long timeout) throws Exception {
        long end=System.currentTimeMillis()+timeout;
        while(System.currentTimeMillis()<end) { if("true".equals(evaluate(web,js))) return; Thread.sleep(250); }
        fail("Installed WebView did not satisfy: "+js);
    }
    private static JSONObject folderRequest(android.webkit.WebView web,DeviceScope scope,JSONObject request) throws Exception {
        String id=java.util.UUID.randomUUID().toString();request.put("requestId",id).put("ownerId",scope.owner).put("origin",scope.origin);
        evaluate(web,"window.__folderTestReply=null;window.__folderTestListener=e=>{if(e.detail?.type==='mobile-files-result'&&e.detail?.payload?.requestId==="+JSONObject.quote(id)+"){window.__folderTestReply=e.detail.payload;window.removeEventListener('thingtime:native-message',window.__folderTestListener)}};window.addEventListener('thingtime:native-message',window.__folderTestListener);window.thingtimeNativeBridge.postMessage("+new JSONObject().put("type","mobile-files").put("payload",request)+");");
        awaitTrue(web,"window.__folderTestReply !== null");
        JSONObject result=new JSONObject(new JSONTokener(evaluate(web,"JSON.stringify(window.__folderTestReply)")).nextValue().toString());
        assertFalse(result.optString("error"),result.has("error"));return result;
    }
    private static void verifySelectedFolder(android.webkit.WebView web,Context context,DeviceScope scope) throws Exception {
        awaitTrue(web,"window.thingtimeNativeBridge?.fileAccessVersion==='1.2.0' && document.body.innerText.includes('Folder access') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Choose folder'&&!b.disabled)");
        assertNotNull(folderRequest(web,scope,new JSONObject().put("action","list")).getJSONArray("roots"));
        JSONObject conditions=folderRequest(web,scope,new JSONObject().put("action","conditions")).getJSONObject("conditions");
        assertTrue(java.util.Arrays.asList("wifi","cellular","ethernet","offline","unknown").contains(conditions.getString("network")));
        assertTrue(conditions.isNull("charging") || conditions.get("charging") instanceof Boolean);
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
    private static JSONObject webApi(android.webkit.WebView web,String path,String method,JSONObject body) throws Exception {
        evaluate(web,"window.__syncQA=null;(async()=>{try{const r=await fetch("+JSONObject.quote(path)+",{method:"+JSONObject.quote(method)+",headers:{'Content-Type':'application/json'},"+(body==null?"":"body:"+JSONObject.quote(body.toString())+",")+"redirect:'error'});const value=await r.json();window.__syncQA=r.ok?{ok:true,value}:{ok:false,status:r.status};}catch(e){window.__syncQA={ok:false,error:String(e)}}})()");
        awaitTrue(web,"window.__syncQA!==null");
        JSONObject result=new JSONObject(new JSONTokener(evaluate(web,"JSON.stringify(window.__syncQA)")).nextValue().toString());
        assertTrue("Acceptance API failed: "+path+" "+result,result.getBoolean("ok"));return result.getJSONObject("value");
    }
    private static void verifySelectedUpload(android.webkit.WebView web,Context context,DeviceScope scope,String localRootId) throws Exception {
        String remoteRoot=null,connectionId=null;
        try {
            remoteRoot=webApi(web,"/api/v1/things","POST",new JSONObject().put("thingtime",new JSONArray().put("folder")).put("crystal",new JSONObject().put("name","Android upload acceptance "+java.util.UUID.randomUUID()))).getJSONObject("thing").getString("id");
            String deviceId=new KeystoreDeviceStore(context).load(scope).getString("deviceId");
            JSONObject config=new JSONObject().put("configurationVersion",1).put("name","Android upload acceptance").put("deviceId",deviceId).put("localRootId",localRootId).put("remoteFolderId",remoteRoot).put("mode","backup").put("paused",false).put("propagateDeletes",false).put("network","any").put("chargingOnly",false).put("excludedPaths",new JSONArray());
            connectionId=webApi(web,"/api/v1/things","POST",new JSONObject().put("thingtime",new JSONArray().put("file-sync")).put("crystal",config)).getJSONObject("thing").getString("id");
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Refresh'&&!b.disabled).click()");
            awaitTrue(web,"document.body.innerText.includes('Android upload acceptance') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Upload now'&&!b.disabled)");
            evaluate(web,"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Upload now'&&!b.disabled).click()");
            awaitTrue(web,"document.body.innerText.includes('Last upload finished.')",240000);
            JSONArray nodes=webApi(web,"/api/v1/files?rootId="+remoteRoot,"GET",null).getJSONObject("inventory").getJSONArray("nodes");JSONObject file=null;
            for(int i=0;i<nodes.length();i++){JSONObject n=nodes.getJSONObject(i);if(n.getString("path").equals("original.bin"))file=n.getJSONObject("file");}
            assertNotNull(file);assertEquals(8*1024*1024+17,file.getJSONObject("content").getLong("size"));
            String attachment=file.getJSONObject("content").getString("attachmentId");
            evaluate(web,"window.__syncHash=null;(async()=>{try{const r=await fetch("+JSONObject.quote("/api/v1/attachments/content?id="+attachment+"&cache=bytes")+");if(!r.ok)throw Error('download');const digest=await crypto.subtle.digest('SHA-256',await r.arrayBuffer());window.__syncHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}catch(e){window.__syncHash='error'}})()");
            awaitTrue(web,"window.__syncHash!==null");
            byte[] expected=new byte[8*1024*1024+17];java.util.Arrays.fill(expected,(byte)13);
            String hash=FolderReader.hex(java.security.MessageDigest.getInstance("SHA-256").digest(expected));
            assertEquals(hash,new JSONTokener(evaluate(web,"window.__syncHash")).nextValue());
            System.out.println("FOLDER_UPLOAD_PASS: installed Android WebView control, real SAF bytes, configured executor, cloud multipart publication, independent downloaded-byte SHA-256.");
        } finally {
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
