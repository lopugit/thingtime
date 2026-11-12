package com.thingtime.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.*;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicLong;

/** One foreground Save As request. Picker access is explicit and never persisted. */
final class FileExportBridge {
    static final int SAVE_FILE=7184;
    private static final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Activity activity;
    private final String origin;
    private final FolderBridge.Active active;
    private final AtomicLong generation=new AtomicLong();
    private final File directory;
    private Request pending;
    private boolean selecting,resultArrived;
    private Uri destination;
    private int nextPickerCode=SAVE_FILE;
    private static final class Request {
        final String id,cookie;final long generation,deadline;final DeviceScope scope;
        final AttachmentExport file;final JavaScriptReplyProxy reply;File staged;int pickerCode=-1;
        Request(JSONObject payload,String origin,long generation,JavaScriptReplyProxy reply) throws Exception {
            id=payload.getString("requestId");if(!UUID.fromString(id).toString().equalsIgnoreCase(id))throw new IOException();
            scope=new DeviceScope(payload.getString("ownerId"),origin,BuildConfig.DEBUG);
            if(!origin.equals(payload.getString("origin")))throw new IOException();
            this.generation=generation;this.reply=reply;file=new AttachmentExport(payload);
            String session;
            try { session=SessionCookie.auth(CookieManager.getInstance().getCookie(origin+"/api/v1/attachments/content")); }
            catch(IOException signedOut) { session=""; }
            cookie=session;
            deadline=android.os.SystemClock.elapsedRealtime()+30*60*1000;
        }
    }
    FileExportBridge(Activity activity,String origin,FolderBridge.Active active) {
        this.activity=activity;this.origin=origin;this.active=active;
        directory=new File(activity.getCacheDir(),"file-exports-v1");
        // Same serial worker as downloads: activity recreation cannot remove an
        // old task's bytes while it still writes them. Cache has no user files.
        worker.execute(()-> { File[] stale=directory.listFiles();if(stale!=null)for(File file:stale)file.delete(); });
    }
    private PairingEngine.Check check(Request request) {
        return ()-> {
            String reason=generation.get()!=request.generation?"generation":!active.get()?"inactive":android.os.SystemClock.elapsedRealtime()>request.deadline?"deadline":
                request.cookie.isEmpty() || !request.cookie.equals(SessionCookie.auth(CookieManager.getInstance().getCookie(origin+"/api/v1/attachments/content")))?"session":null;
            if(reason!=null) {
                if(BuildConfig.DEBUG)android.util.Log.w("FileExport","Export guard stopped: "+reason);
                throw new java.util.concurrent.CancellationException();
            }
        };
    }
    void handle(JSONObject message,JavaScriptReplyProxy reply) throws Exception {
        JSONObject payload=message.getJSONObject("payload");
        if("cancel".equals(payload.optString("action"))) { if(pending!=null && pending.id.equals(payload.optString("requestId")))suspend();return; }
        if(!"save".equals(payload.optString("action")))return;
        Request request=new Request(payload,origin,pending==null?generation.incrementAndGet():generation.get(),reply);
        if(pending!=null){respond(request,false,"Another file is being saved. Finish or cancel it first.");return;}
        pending=request;
        worker.execute(()-> {
            try {
                PairingEngine.Check guard=check(request);guard.run();authorize(request,guard);
                if(!directory.isDirectory() && !directory.mkdirs())throw new IOException();
                if(directory.getUsableSpace()<request.file.size+16*1024*1024)throw new IOException();
                request.staged=File.createTempFile("export-",".part",directory);
                try(FileOutputStream output=new FileOutputStream(request.staged)) {
                    request.file.download(output,(offset,length)->request.file.range(request.scope,request.cookie,offset,length,guard),guard);
                    output.getFD().sync();
                }
                authorize(request,guard);guard.run();
                activity.runOnUiThread(()-> {
                    try {
                        guard.run();if(nextPickerCode>65535)throw new IOException();
                        request.pickerCode=nextPickerCode++;selecting=true;
                        activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                            .setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,request.file.name),request.pickerCode);
                    }catch(Exception error){finish(request,false,"The Save As picker is unavailable. Try again.");}
                });
            }catch(Exception error){finish(request,false,"Could not prepare this version. Check your connection, account and free space, then retry.");}
        });
    }
    private void authorize(Request request,PairingEngine.Check guard) throws Exception {
        DeviceHttpTransport transport=new DeviceHttpTransport(url->request.cookie,guard);
        new PairingEngine(new KeystoreDeviceStore(activity),transport,guard).identity(request.scope);
        JSONObject manifest=transport.request(request.scope,"/.well-known/thingtime-capabilities.json",null,null,false);
        if(manifest.optInt("schemaVersion")!=1 || !origin.equals(manifest.optString("origin")) ||
            !PairingEngine.compatible(manifest.getJSONObject("features").getJSONObject("api.attachment-content").getString("version"),"1.14.0"))throw new IOException();
        request.file.match(transport.request(request.scope,request.file.fingerprintPath(),null,null,true));guard.run();
    }
    void pause(){if(!selecting)suspend();}
    void suspend(){
        generation.incrementAndGet();Request request=pending;pending=null;selecting=false;resultArrived=false;destination=null;
        if(request!=null){respond(request,false,"Saving paused. A file already created may be incomplete; check Files before trying again.");cleanup(request);}
    }
    void activityResult(int code,int result,Intent data) {
        if(!selecting || pending==null || code!=pending.pickerCode)return;
        destination=result==Activity.RESULT_OK && data!=null?data.getData():null;resultArrived=true;resume();
    }
    void resume(){
        if(!active.get() || !selecting || !resultArrived || pending==null)return;
        Request request=pending;Uri uri=destination;selecting=false;resultArrived=false;destination=null;
        if(uri==null){finish(request,false,null);return;}
        worker.execute(()-> {
            boolean opened=false;
            String phase="authorization";
            try {
                PairingEngine.Check guard=check(request);guard.run();
                if(!"content".equals(uri.getScheme()))throw new IOException();
                authorize(request,guard);
                phase="private verification";
                try(InputStream staged=new FileInputStream(request.staged)){request.file.verify(staged,guard);}
                guard.run();
                phase="provider copy";
                // ACTION_CREATE_DOCUMENT selects a new document. No broad folder
                // grant, overwrite, persistent permission, or automatic retry.
                try(OutputStream output=activity.getContentResolver().openOutputStream(uri,"w");InputStream input=new FileInputStream(request.staged)) {
                    if(output==null)throw new IOException();opened=true;
                    byte[] bytes=new byte[64*1024];int count;
                    while((count=input.read(bytes))!=-1){guard.run();output.write(bytes,0,count);}output.flush();
                }
                guard.run();
                phase="provider verification";
                try(InputStream input=activity.getContentResolver().openInputStream(uri)) {
                    if(input==null)throw new IOException();request.file.verify(input,guard);
                }
                finish(request,true,null);
            }catch(Exception error){
                if(BuildConfig.DEBUG)android.util.Log.w("FileExport","Save As failed during "+phase+": "+error.getClass().getSimpleName());
                finish(request,false,opened?"Could not verify the saved file. It may be incomplete; check it in Files before trying again.":"Saving stopped before copying bytes. Reopen History and try again.");
            }
        });
    }
    private void cleanup(Request request){worker.execute(()-> {if(request.staged!=null)request.staged.delete();});}
    private void finish(Request request,boolean saved,String error){
        activity.runOnUiThread(()-> {
            if(pending==request){
                pending=null;selecting=false;
                try{if(saved)check(request).run();respond(request,saved,error);}
                catch(Exception changed){respond(request,false,"Saving could not be confirmed. Check Files before trying again.");}
            }cleanup(request);
        });
    }
    private void respond(Request request,boolean saved,String error){
        try {
            JSONObject payload=new JSONObject().put("requestId",request.id).put("ownerId",request.scope.owner).put("origin",origin)
                .put("attachmentId",request.file.id).put("version",request.file.version).put("size",request.file.size).put("saved",saved);
            if(error!=null)payload.put("error",error);
            if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))request.reply.postMessage(new JSONObject().put("type","file-export-result").put("payload",payload).toString());
        }catch(Exception ignored){}
    }
}
