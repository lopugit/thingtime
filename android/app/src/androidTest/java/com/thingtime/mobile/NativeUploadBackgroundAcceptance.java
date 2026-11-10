package com.thingtime.mobile;

import android.app.Activity;
import android.content.Intent;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import java.util.concurrent.*;
import static org.junit.Assert.*;

/** Observes the genuine native acknowledgement before backgrounding the real
 * activity. No production transport, web bridge or authority is replaced. */
public final class NativeUploadBackgroundAcceptance {
    private final Activity activity;
    private final DeviceScope scope;
    private final WebView web;
    NativeUploadBackgroundAcceptance(WebView web,DeviceScope scope) {
        activity=(Activity)web.getContext();this.scope=scope;this.web=web;
    }
    private boolean active() throws Exception {
        java.lang.reflect.Field active=MainActivity.class.getDeclaredField("active");active.setAccessible(true);return active.getBoolean(activity);
    }
    void verify() throws Exception {
        try {DeviceLiveTest.awaitTrue(web,"typeof window.__uploadQA.background==='boolean'||window.__uploadQA.lastError!==null");}
        catch(AssertionError failure) {
            DeviceLiveTest.progress("BACKGROUND_START_DIAGNOSTIC: "+DeviceLiveTest.evaluate(web,"JSON.stringify({qa:window.__uploadQA,status:Array.from(document.querySelectorAll('[role=status],[role=alert]')).map(e=>e.textContent)})"));throw failure;
        }
        assertEquals("null",DeviceLiveTest.evaluate(web,"window.__uploadQA.lastError"));
        JSONObject message=new JSONObject(new org.json.JSONTokener(DeviceLiveTest.evaluate(web,"JSON.stringify({background:window.__uploadQA.background,request:window.__uploadQArequest})")).nextValue().toString());
        assertTrue("Android refused background authority",message.getBoolean("background"));
        InstrumentationRegistry.getInstrumentation().runOnMainSync(()->activity.moveTaskToBack(true));
        long deadline=System.currentTimeMillis()+10000;
        while(active()&&System.currentTimeMillis()<deadline)Thread.sleep(20);
        assertFalse("The real activity must be paused",active());
        JSONObject input=message.getJSONObject("request");
        NativeUploadRequest request=new NativeUploadRequest(input.getJSONObject("upload"),scope,input.getString("rootId"),false);
        try(NativeUploadHttp transport=new NativeUploadHttp(scope,url->android.webkit.CookieManager.getInstance().getCookie(url),()->{
            if(active())throw new java.io.IOException("Activity returned before background verification");
        })) {
            JSONObject first=transport.json("/api/v1/attachments/uploads",request.reservation());
            assertFalse("Fixture finished before backgrounding; this run proves no background transfer",request.verifyPlan(first));
            boolean ready=false;deadline=System.currentTimeMillis()+180000;
            while(System.currentTimeMillis()<deadline) {
                Thread.sleep(2000);
                try {
                    JSONObject stored=transport.json("/api/v1/attachments/content?id="+java.net.URLEncoder.encode(request.uploadId,"UTF-8")+"&fingerprint=1",null);
                    assertEquals(request.uploadId,stored.getString("id"));assertEquals(request.size,stored.getLong("size"));
                    assertEquals(SyncStaging.canonical(request.source.getJSONObject("fingerprint")),SyncStaging.canonical(stored.getJSONObject("fingerprint")));
                    assertTrue(request.verifyPlan(transport.json("/api/v1/attachments/uploads",request.reservation())));ready=true;break;
                }catch(PairingEngine.Failure pending){if(pending.status!=404)throw pending;}

            }
            assertTrue("Native attachment did not become ready while the WebView was paused",ready);assertFalse(active());
            DeviceLiveTest.progress("ANDROID_BACKGROUND_UPLOAD_PASS: real activity paused, original reservation uploading then ready, no WebView polling during transfer.");
        }finally {
            activity.startActivity(new Intent(activity,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
        }
    }
    void close(WebView web){
        activity.startActivity(new Intent(activity,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
    }
}
