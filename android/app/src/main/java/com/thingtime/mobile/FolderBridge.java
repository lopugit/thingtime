package com.thingtime.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.CancellationSignal;
import android.webkit.CookieManager;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/** Foreground folder adapter. Picker pause is expected; resumed results must
 * authenticate again before retaining a grant or returning private data. */
final class FolderBridge {
    static final int PICK_FOLDER=7183;
    private static final ExecutorService worker=Executors.newSingleThreadExecutor();
    interface Active { boolean get(); }
    private final Activity activity; private final String origin; private final Active active;
    private final AtomicLong generation=new AtomicLong();
    private final FolderReader.ProofCache proofs=new FolderReader.ProofCache();
    private volatile String networkKind="unknown";
    private android.net.Network observedNetwork;
    private final android.net.ConnectivityManager connectivity;
    private final android.net.ConnectivityManager.NetworkCallback networkCallback=new android.net.ConnectivityManager.NetworkCallback() {
        @Override public synchronized void onAvailable(android.net.Network network) { observedNetwork=network;networkKind="unknown"; }
        @Override public synchronized void onCapabilitiesChanged(android.net.Network network,android.net.NetworkCapabilities caps) {
            if(!network.equals(observedNetwork)) return;
            networkKind=!caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)?"offline":
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR)?"cellular":caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)?"wifi":caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)?"ethernet":"unknown";
        }
        @Override public synchronized void onLost(android.net.Network network) { if(network.equals(observedNetwork)){observedNetwork=null;networkKind="offline";} }
    };
    private Request pending; private boolean selecting; private Intent selectedResult; private boolean resultArrived;
    private CancellationSignal cancellation=new CancellationSignal();
    private static final class Request {
        final String id,action;final DeviceScope scope;final JSONObject payload,base;final JavaScriptReplyProxy reply;final long generation;final long deadline;
        Request(JSONObject payload,DeviceScope scope,JavaScriptReplyProxy reply,long generation) throws Exception {
            this.payload=payload;this.scope=scope;this.reply=reply;this.generation=generation;id=payload.getString("requestId");action=payload.getString("action");deadline=android.os.SystemClock.elapsedRealtime()+((action.equals("choose") || action.equals("scan") || action.equals("stage-begin") || action.equals("stage-finish"))?300000:30000);
            base=new JSONObject().put("requestId",id).put("ownerId",scope.owner).put("origin",scope.origin);
        }
    }
    FolderBridge(Activity activity,String origin,Active active) {
        this.activity=activity;this.origin=origin;this.active=active;
        connectivity=(android.net.ConnectivityManager)activity.getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        try { if(connectivity!=null)connectivity.registerDefaultNetworkCallback(networkCallback); }catch(Exception unavailable){ networkKind="unknown"; }
    }
    void close() { suspend();try { if(connectivity!=null)connectivity.unregisterNetworkCallback(networkCallback); }catch(Exception ignored){} }
    void suspend() {
        proofs.clear();
        Request old=pending;pending=null;selecting=false;selectedResult=null;resultArrived=false;generation.incrementAndGet();cancellation.cancel();cancellation=new CancellationSignal();
        if(old!=null) reply(old,new JSONObject(),"Folder access paused. Try again when the app is active.");
    }
    void pause() { if(!selecting) suspend(); }
    void activityResult(int code,int result,Intent data) {
        if(code!=PICK_FOLDER || !selecting || pending==null) return;
        selectedResult=result==Activity.RESULT_OK?data:null;resultArrived=true;resume();
    }
    void resume() {
        if(!active.get() || !selecting || !resultArrived || pending==null) return;
        Request request=pending;Intent result=selectedResult;selectedResult=null;resultArrived=false;selecting=false;
        execute(request,result,true);
    }
    void handle(JSONObject body,JavaScriptReplyProxy reply) throws Exception {
        JSONObject payload=body.getJSONObject("payload");String id=payload.getString("requestId"),action=payload.getString("action");
        if(!UUID.fromString(id).toString().equalsIgnoreCase(id)) return;
        DeviceScope scope=new DeviceScope(payload.getString("ownerId"),origin,BuildConfig.DEBUG);
        if(action.equals("suspend")) { if(pending!=null && pending.id.equals(id)) suspend();return; }
        if(!java.util.Arrays.asList("list","choose","remove","scan","read","conditions","stage-begin","stage-append","stage-finish").contains(action)) return;
        if(pending!=null) { reply(new Request(payload,scope,reply,generation.get()),new JSONObject(),"Another folder request is running.");return; }
        Request request=new Request(payload,scope,reply,generation.incrementAndGet());pending=request;execute(request,null,false);
    }
    private void reply(Request request,JSONObject result,String error) {
        try {
            JSONObject payload=new JSONObject(request.base.toString());
            if(error!=null) payload.put("error",error);else for(java.util.Iterator<String> keys=result.keys();keys.hasNext();) { String key=keys.next();payload.put(key,result.get(key)); }
            if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) request.reply.postMessage(new JSONObject().put("type","mobile-files-result").put("payload",payload).toString());
        } catch(Exception ignored) { }
    }
    private static long integer(JSONObject payload,String key,long maximum) throws Exception {
        Object value=payload.get(key);if(!(value instanceof Number)) throw new FolderReader.Failure("Invalid file read range.");
        double number=((Number)value).doubleValue();if(!Double.isFinite(number) || number<0 || number>maximum || number!=Math.rint(number)) throw new FolderReader.Failure("Invalid file read range.");return (long)number;
    }
    private void execute(Request request,Intent selected,boolean pickerFinished) {
        CancellationSignal signal=cancellation;
        PairingEngine.Check check=()-> { if(generation.get()!=request.generation || !active.get() || android.os.SystemClock.elapsedRealtime()>request.deadline) throw new java.util.concurrent.CancellationException();signal.throwIfCanceled(); };
        worker.execute(()-> {
            try {
                check.run();FolderStore store=new FolderStore(activity);
                PairingEngine auth=new PairingEngine(new KeystoreDeviceStore(activity),new DeviceHttpTransport(url->CookieManager.getInstance().getCookie(url),check),check);
                auth.identity(request.scope);check.run();
                if(request.action.equals("choose") && !pickerFinished) {
                    activity.runOnUiThread(()-> {
                        try {
                            check.run();selecting=true;
                            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                            activity.startActivityForResult(intent,PICK_FOLDER);
                        } catch(Exception error) { finish(request,new JSONObject(),"The system folder picker is unavailable."); }
                    });return;
                }
                JSONObject result=new JSONObject();
                if(request.action.equals("conditions")) {
                    String kind=networkKind;
                    Intent battery=activity.registerReceiver(null,new android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                    int status=battery==null?-1:battery.getIntExtra(android.os.BatteryManager.EXTRA_STATUS,-1);
                    Object charging=status<0 || status==android.os.BatteryManager.BATTERY_STATUS_UNKNOWN?JSONObject.NULL:
                        status==android.os.BatteryManager.BATTERY_STATUS_CHARGING || status==android.os.BatteryManager.BATTERY_STATUS_FULL;
                    result.put("conditions",new JSONObject().put("network",kind).put("charging",charging));
                } else if(request.action.equals("choose")) {
                    if(selected!=null && selected.getData()!=null) {
                        Uri tree=FolderStore.tree(selected.getData().toString());
                        FolderReader.Doc root=new SafFolderProvider(activity.getContentResolver(),tree,signal).root();
                        if(!root.directory) throw new FolderReader.Failure("Choose a folder.");
                        check.run();auth.identity(request.scope);check.run();store.add(request.scope,tree,selected.getFlags(),root.name);
                    }
                } else if(!request.action.equals("list")) {
                    String rootId=request.payload.getString("rootId");if(!UUID.fromString(rootId).toString().equalsIgnoreCase(rootId)) throw new FolderReader.Failure("Invalid folder selection.");
                    if(request.action.equals("remove")) { store.remove(request.scope,rootId);proofs.clear(); }
                    else if(request.action.startsWith("stage-")) {
                        // Resolve this account's native grant on every chunk. A
                        // remembered root ID or existing journal is not authority.
                        FolderReader.Doc root=new SafFolderProvider(activity.getContentResolver(),store.grant(request.scope,rootId),signal).root();
                        if(!root.directory)throw new FolderReader.Failure("Folder access is unavailable. Choose it again.");
                        SyncStaging staging=new SyncStaging(activity,check);JSONObject transfer=request.payload.getJSONObject("transfer"),progress;
                        if(request.action.equals("stage-begin"))progress=staging.begin(transfer,request.scope,rootId);
                        else if(request.action.equals("stage-finish"))progress=staging.finish(transfer,request.scope,rootId);
                        else {
                            Object encoded=request.payload.get("data");
                            if(!(encoded instanceof String) || ((String)encoded).length()>87384)throw new FolderReader.Failure("Invalid download chunk.");
                            byte[] bytes=java.util.Base64.getDecoder().decode((String)encoded);
                            if(!java.util.Base64.getEncoder().encodeToString(bytes).equals(encoded))throw new FolderReader.Failure("Invalid download chunk.");
                            progress=staging.append(transfer,request.scope,rootId,SyncStaging.integer(request.payload,"offset",9007199254740991L),bytes);
                        }
                        result.put("rootId",rootId).put("staging",progress);
                    }
                    else {
                        FolderReader reader=new FolderReader(new SafFolderProvider(activity.getContentResolver(),store.grant(request.scope,rootId),signal),check,proofs,request.scope.origin+"\0"+request.scope.owner+"\0"+rootId);
                        result.put("rootId",rootId);
                        if(request.action.equals("scan")) result.put("complete",true).put("entries",reader.scan());
                        else {
                            String path=request.payload.getString("path"),version=request.payload.getString("version");
                            long offset=integer(request.payload,"offset",9007199254740991L),length=integer(request.payload,"length",FolderReader.MAX_READ);
                            result.put("path",path).put("chunk",reader.read(path,version,offset,(int)length,Boolean.TRUE.equals(request.payload.opt("verifiedChunks"))));
                        }
                    }
                }
                check.run();auth.identity(request.scope);check.run();result.put("roots",store.list(request.scope));finish(request,result,null);
            } catch(java.util.concurrent.CancellationException | android.os.OperationCanceledException cancelled) { finish(request,new JSONObject(),"Folder access paused. Try again when the app is active."); }
            catch(Exception failure) { finish(request,new JSONObject(),failure instanceof FolderReader.Failure || failure instanceof PairingEngine.Failure?failure.getMessage():"Folder access is unavailable. Check Files permissions or choose it again."); }
        });
    }
    private void finish(Request request,JSONObject result,String error) {
        activity.runOnUiThread(()-> {
            if(generation.get()!=request.generation || pending!=request || !active.get()) return;
            pending=null;selecting=false;reply(request,result,error);
        });
    }
}
