package com.thingtime.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.widget.TextView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.JavaScriptReplyProxy;
import org.json.JSONObject;
import java.util.Collections;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

public final class MainActivity extends Activity {
    private WebView web;
    private String origin;
    // Serialize records across activity recreation as well as within one WebView.
    private static final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicLong generation=new AtomicLong();
    private volatile boolean active;
    private volatile String currentOrigin="";
    private String runningRequest;
    private FolderBridge folders;
    private FileExportBridge exports;
    private static final String SCRIPT="""
        (() => {
          if (window !== window.top || !window.thingtimeDeviceTransport) return;
          const listeners = new Set();
          const receive = message => {
            window.dispatchEvent(new CustomEvent('thingtime:native-message', {detail:message}));
            for (const listener of listeners) { try { listener(message); } catch {} }
          };
          window.thingtimeDeviceTransport.onmessage = event => { try { receive(event.data instanceof ArrayBuffer ? {type:"mobile-files-read-frame",payload:{frame:event.data}} : JSON.parse(event.data)); } catch {} };
          window.thingtimeNativeBridge = {
            version:'1.4.0', platform:'android', isNativeWebView:true, devicePairingVersion:'1.0.0', fileAccessVersion:'__ACCESS_VERSION__', fileStagingVersion:'__STAGING_VERSION__', filePublicationVersion:'1.1.0', fileTrashVersion:'1.2.0', fileVersionsVersion:'1.0.0', fileExportVersion:'1.0.0',
            postMessage:message => window.thingtimeDeviceTransport.postMessage(JSON.stringify(message)),
            __BINARY_METHOD__
            onMessage:listener => { listeners.add(listener); return () => listeners.delete(listener); },
            offMessage:listener => listeners.delete(listener)
          };
          window.dispatchEvent(new Event('thingtime:native-bridge-ready'));
        })();
        """;
    @android.annotation.SuppressLint("SetJavaScriptEnabled") // The Thingtime web UI requires JS; bridge access is origin and main-frame restricted.
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try { origin=DeviceScope.origin(BuildConfig.WEB_ORIGIN,BuildConfig.DEBUG); }
        catch(Exception invalid) { unavailable("Invalid Thingtime destination."); return; }
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            unavailable("Update Android System WebView to connect this device."); return;
        }
        final boolean binary=WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER);
        folders=new FolderBridge(this,origin,()->active && origin.equals(currentOrigin));
        exports=new FileExportBridge(this,origin,()->active && origin.equals(currentOrigin));
        web=new WebView(this); android.widget.FrameLayout frame=new android.widget.FrameLayout(this); frame.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1)); setContentView(frame);
        if(Build.VERSION.SDK_INT>=30) {
            frame.setOnApplyWindowInsetsListener((view,insets)-> { android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.ime()); view.setPadding(bars.left,bars.top,bars.right,bars.bottom); return insets; });
        } else {
            frame.setOnApplyWindowInsetsListener((view,insets)-> { view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom()); return insets; });
        }
        WebSettings settings=web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) { cancel(); if(folders!=null) folders.suspend(); if(exports!=null)exports.suspend(); currentOrigin=canonical(url); }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                if(!request.isForMainFrame()) return false;
                if(origin.equals(canonical(request.getUrl().toString()))) return false;
                if(request.hasGesture() && ("https".equals(request.getUrl().getScheme()) || "http".equals(request.getUrl().getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW,request.getUrl())); } catch(android.content.ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(web,"thingtimeDeviceTransport",Collections.singleton(origin),(view,message,source,isMainFrame,reply)-> {
            if(!isMainFrame || !origin.equals(canonical(source.toString())) || !origin.equals(canonical(view.getUrl()))) return;
            if(binary && message.getType()==WebMessageCompat.TYPE_ARRAY_BUFFER) { if(active)folders.handleFrame(message.getArrayBuffer());return; }
            if(message.getType()!=WebMessageCompat.TYPE_STRING)return;
            String data=message.getData(); if(data==null || data.length()>131072) return;
            try {
                JSONObject body=new JSONObject(data);
                // The system Save As picker pauses this activity. A web account
                // change or unmount must still be able to cancel that request.
                boolean cancelExport="file-export".equals(body.optString("type")) && body.optJSONObject("payload")!=null && "cancel".equals(body.getJSONObject("payload").optString("action"));
                if(!active && !cancelExport)return;
                if(!"mobile-files".equals(body.optString("type")) && data.length()>4096)return;
                handle(body,reply);
            } catch(Exception invalid) { /* Malformed messages have no effects. */ }
        });
        if(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) WebViewCompat.addDocumentStartJavaScript(web,SCRIPT.replace("__ACCESS_VERSION__",binary?"1.4.0":"1.3.0").replace("__STAGING_VERSION__",binary?"1.1.0":"1.0.0")
            .replace("__BINARY_METHOD__",binary?"postFileFrame:frame => window.thingtimeDeviceTransport.postMessage(frame),":""),Collections.singleton(origin));
        web.loadUrl(origin);
    }
    private String canonical(String url) { try { return DeviceScope.origin(url,BuildConfig.DEBUG); } catch(Exception e) { return ""; } }
    private void unavailable(String message) { TextView text=new TextView(this); text.setText(message); text.setPadding(32,96,32,32); setContentView(text); }
    private void cancel() { generation.incrementAndGet(); runningRequest=null; }
    private void handle(JSONObject message,JavaScriptReplyProxy reply) throws Exception {
        if("file-export".equals(message.optString("type"))) { exports.handle(message,reply);return; }
        if("mobile-files".equals(message.optString("type"))) { folders.handle(message,reply);return; }
        if(!"mobile-device".equals(message.optString("type"))) return;
        JSONObject payload=message.getJSONObject("payload"); String id=payload.getString("requestId");
        if(!UUID.fromString(id).toString().equalsIgnoreCase(id)) return;
        DeviceScope scope=new DeviceScope(payload.getString("ownerId"),origin,BuildConfig.DEBUG);
        String action=payload.getString("action");
        if("suspend".equals(action)) { if(id.equals(runningRequest)) cancel(); return; }
        if(!action.equals("status") && !action.equals("pair")) return;
        JSONObject base=new JSONObject().put("requestId",id).put("ownerId",scope.owner).put("origin",scope.origin);
        if(runningRequest!=null) { if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply.postMessage(new JSONObject().put("type","mobile-device-result").put("payload",base.put("error","Another device request is running. Try again shortly.")).toString()); return; }
        long operation=generation.incrementAndGet(); runningRequest=id;
        PairingEngine.Check check=()-> { if(generation.get()!=operation || !active || !scope.origin.equals(currentOrigin)) throw new java.util.concurrent.CancellationException(); };
        worker.execute(()-> {
            try {
                PairingEngine engine=new PairingEngine(new KeystoreDeviceStore(this),new DeviceHttpTransport(url->CookieManager.getInstance().getCookie(url),check),check);
                JSONObject result=action.equals("pair")?engine.pair(scope,new JSONObject().put("name",Build.MODEL).put("model",Build.MANUFACTURER+" "+Build.MODEL).put("osVersion",Build.VERSION.RELEASE).put("appVersion",BuildConfig.VERSION_NAME)):engine.status(scope);
                check.run(); base.put("state",result.getString("state")); if(result.has("deviceId")) base.put("deviceId",result.get("deviceId"));
            } catch(java.util.concurrent.CancellationException cancelled) { return; }
            catch(Exception error) { try { base.put("error",error instanceof PairingEngine.Failure?error.getMessage():"Device connection could not be checked. Retry to resume saved work."); } catch(Exception ignored) { } }
            runOnUiThread(()-> { try { check.run(); if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply.postMessage(new JSONObject().put("type","mobile-device-result").put("payload",base).toString()); } catch(Exception ignored) { } finally { if(generation.get()==operation) runningRequest=null; } });
        });
    }
    @Override protected void onResume() { super.onResume(); active=true; if(web!=null) web.onResume(); if(folders!=null) folders.resume(); if(exports!=null)exports.resume(); }
    @Override protected void onPause() { active=false; cancel(); if(folders!=null) folders.pause(); if(exports!=null)exports.pause(); if(web!=null) web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { cancel(); if(folders!=null) folders.close(); if(exports!=null)exports.suspend(); if(web!=null) web.destroy(); super.onDestroy(); }
    @Override protected void onActivityResult(int request,int result,Intent data) { super.onActivityResult(request,result,data); if(folders!=null) folders.activityResult(request,result,data); if(exports!=null)exports.activityResult(request,result,data); }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results) { super.onRequestPermissionsResult(request,permissions,results);if(folders!=null)folders.permissionResult(request); }
    @Override public void onBackPressed() { if(web!=null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
