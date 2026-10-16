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
        long end=System.currentTimeMillis()+60000;
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
        awaitTrue(web,"window.thingtimeNativeBridge?.fileAccessVersion==='1.0.0' && document.body.innerText.includes('Folder access') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Choose folder'&&!b.disabled)");
        assertNotNull(folderRequest(web,scope,new JSONObject().put("action","list")).getJSONArray("roots"));
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
            JSONArray entries=scan.getJSONArray("entries");JSONObject file=null;
            for(int i=0;i<entries.length();i++) if(entries.getJSONObject(i).getString("path").equals("original.bin")) file=entries.getJSONObject(i);
            assertNotNull(file);assertEquals(8*1024*1024+17,file.getLong("size"));assertEquals(2,file.getJSONObject("fingerprint").getInt("partCount"));
            java.security.MessageDigest part=java.security.MessageDigest.getInstance("SHA-256"), composite=java.security.MessageDigest.getInstance("SHA-256");
            byte[] first=new byte[8*1024*1024],tail=new byte[17];java.util.Arrays.fill(first,(byte)13);java.util.Arrays.fill(tail,(byte)13);composite.update(part.digest(first));composite.update(part.digest(tail));
            assertEquals(FolderReader.hex(composite.digest()),file.getJSONObject("fingerprint").getString("sha256"));
            JSONObject read=folderRequest(web,scope,new JSONObject().put("action","read").put("rootId",id).put("path","original.bin").put("version",file.getString("version")).put("offset",8*1024*1024).put("length",65536));
            assertArrayEquals(tail,java.util.Base64.getDecoder().decode(read.getJSONObject("chunk").getString("data")));
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
