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
