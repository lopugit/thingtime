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
    static final int PICK_FOLDER=7183,PHOTO_PERMISSIONS=7184;
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
    private android.app.AlertDialog approvalDialog;
    private Request pending; private boolean permissionResult; private boolean selecting; private Intent selectedResult; private boolean resultArrived;
    private CancellationSignal cancellation=new CancellationSignal();
    private static final class Request {
        volatile FolderRangeSource range; volatile FolderRangeSink sink;
        FolderStore.Grant approvalGrant,restoreGrant; JSONObject reviewedRestore; boolean restoreConsent; WriteApproval approval; boolean choosePhotos,photoPermissionsRequested,chooseExisting,offlineConsent; String offlineName;
        final String id,action;final DeviceScope scope;final JSONObject payload,base;final JavaScriptReplyProxy reply;final long generation;final long deadline;
        Request(JSONObject payload,DeviceScope scope,JavaScriptReplyProxy reply,long generation) throws Exception {
            this.payload=payload;this.scope=scope;this.reply=reply;this.generation=generation;id=payload.getString("requestId");action=payload.getString("action");deadline=android.os.SystemClock.elapsedRealtime()+((action.equals("choose") || action.startsWith("trash") || action.startsWith("version-") || action.equals("write-approve") || action.equals("scan") || action.equals("read-range") || action.equals("stage-begin") || action.equals("stage-range") || action.equals("stage-finish") || action.equals("publish") || action.equals("publication-lookup"))?300000:30000);
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
        if(approvalDialog!=null) { approvalDialog.dismiss();approvalDialog=null; }
        Request old=pending;pending=null;selecting=false;selectedResult=null;resultArrived=false;permissionResult=false;generation.incrementAndGet();cancellation.cancel();cancellation=new CancellationSignal();
        if(old!=null) { if(old.range!=null)old.range.close();if(old.sink!=null)old.sink.close();reply(old,new JSONObject(),"Folder access paused. Try again when the app is active."); }
    }
    void pause() { if(!selecting) suspend(); }
    void activityResult(int code,int result,Intent data) {
        if(code!=PICK_FOLDER || !selecting || pending==null) return;
        selectedResult=result==Activity.RESULT_OK?data:null;resultArrived=true;resume();
    }
    void permissionResult(int code) {
        if(code!=PHOTO_PERMISSIONS || !selecting || pending==null || !pending.choosePhotos)return;
        permissionResult=true;resultArrived=true;resume();
    }
    void resume() {
        if(!active.get() || !selecting || !resultArrived || pending==null) return;
        Request request=pending;Intent result=selectedResult;selectedResult=null;resultArrived=false;selecting=false;
        boolean wasPermission=permissionResult;permissionResult=false;execute(request,result,!wasPermission);
    }
    void handleFrame(byte[] bytes) {
        Request request=pending;
        if(request!=null && active.get()) {if(request.range!=null)request.range.accept(bytes);if(request.sink!=null)request.sink.accept(bytes);}
    }
    void handle(JSONObject body,JavaScriptReplyProxy reply) throws Exception {
        JSONObject payload=body.getJSONObject("payload");String id=payload.getString("requestId"),action=payload.getString("action");
        if(!UUID.fromString(id).toString().equalsIgnoreCase(id)) return;
        DeviceScope scope=new DeviceScope(payload.getString("ownerId"),origin,BuildConfig.DEBUG);
        if(action.equals("suspend")) { if(pending!=null && pending.id.equals(id)) suspend();return; }
        if(!java.util.Arrays.asList("list","choose","remove","scan","read","read-range","conditions","stage-begin","stage-append","stage-range","stage-finish","write-approve","publication-lookup","publish","trash","trash-lookup","trash-expected","trash-inspect","trash-list","trash-restore","trash-restore-reviewed","version-list","version-inspect","version-restore-reviewed","version-restore-status").contains(action)) return;
        if((action.equals("stage-range") || action.equals("read-range")) && !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER))return;
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
                check.run();FolderStore store=new FolderStore(activity);ManagedFolderAccess offline=new ManagedFolderAccess(activity,store,check);
                PairingEngine auth=new PairingEngine(new KeystoreDeviceStore(activity),new DeviceHttpTransport(url->CookieManager.getInstance().getCookie(url),check),check);
                auth.identity(request.scope);check.run();
                if(request.action.equals("choose") && !pickerFinished) {
                    if(!request.choosePhotos && !request.chooseExisting && request.offlineName==null) {choose(request,check);return;}
                    Uri initial=null;
                    if(request.choosePhotos) {
                        if(!PhotoLibrary.supported())throw new FolderReader.Failure("Photo backup requires Android 11 or later.");
                        if(!request.photoPermissionsRequested) {requestPhotoPermissions(request,check);return;}
                        if("unavailable".equals(PhotoLibrary.access(activity)))throw new FolderReader.Failure("Allow photo/video access and original media location metadata to back up original files. You can choose selected media only.");
                        initial=android.provider.DocumentsContract.buildDocumentUri(PhotoLibrary.authority(activity),PhotoLibrary.ROOT);
                    }
                    if(request.offlineName!=null) {
                        try(ManagedFileStore catalog=new ManagedFileStore(activity,check)) {
                            String root=catalog.createRoot(request.scope,request.offlineName);
                            catalog.exposeInFiles(request.scope,root);initial=OfflineDocumentsProvider.rootUri(activity,root);
                        }
                        request.offlineName=null;request.chooseExisting=true;OfflineDocumentsProvider.changed(activity);
                    }
                    final Uri initialUri=initial;
                    activity.runOnUiThread(()-> {
                        try {
                            check.run();selecting=true;
                            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                            if(initialUri!=null)intent.putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,initialUri);
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
                        if(OfflineDocumentsProvider.authority(activity).equals(tree.getAuthority())) {
                            try(ManagedFileStore catalog=new ManagedFileStore(activity,check)) {
                                catalog.requireFilesRoot(request.scope,android.provider.DocumentsContract.getTreeDocumentId(tree));
                            }
                        }
                        FolderReader.Doc root=new SafFolderProvider(activity.getContentResolver(),tree,signal).root();
                        if(!root.directory) throw new FolderReader.Failure("Choose a folder.");
                        check.run();auth.identity(request.scope);check.run();store.add(request.scope,tree,selected.getFlags(),root.name);
                    }
                } else if(!request.action.equals("list")) {
                    String rootId=request.payload.getString("rootId");if(!UUID.fromString(rootId).toString().equalsIgnoreCase(rootId)) throw new FolderReader.Failure("Invalid folder selection.");
                    if(request.action.equals("remove")) { store.remove(request.scope,rootId);proofs.clear(); }
                    else if(PhotoLibrary.owns(activity,store.snapshot(request.scope,rootId).uri) && !java.util.Arrays.asList("scan","read","read-range").contains(request.action)) {
                        throw new FolderReader.Failure("Photo libraries are read-only backup sources.");
                    }
                    else if(request.action.equals("write-approve")) {
                        WriteApproval approval=new WriteApproval(request.payload.getJSONObject("approval"),request.scope);
                        FolderStore.Grant grant=store.snapshot(request.scope,rootId);
                        if(Boolean.TRUE.equals(approval.allowTrash) && !offline.owns(grant.uri))throw new FolderReader.Failure("Recoverable deletion requires a Thingtime offline folder.");
                        if(offline.owns(grant.uri)) {
                            if(request.offlineConsent) {
                                if(request.approvalGrant==null || request.approval==null || !request.approval.matches(approval))throw new FolderReader.Failure("Folder write approval changed.");
                                offline.approve(request.scope,request.approvalGrant,approval);
                            } else if(!offline.approved(request.scope,grant,approval)) {
                                request.approvalGrant=grant;request.approval=approval;approveOffline(request,check);return;
                            }
                        } else if(pickerFinished) {
                            if(selected==null || selected.getData()==null) throw new FolderReader.Failure("Download approval cancelled. No new folder write permission was granted.");
                            if(request.approvalGrant==null || request.approval==null || !request.approval.matches(approval)) throw new FolderReader.Failure("Folder write approval changed.");
                            Uri tree=FolderStore.tree(selected.getData().toString());
                            if(!tree.equals(request.approvalGrant.uri)) throw new FolderReader.Failure("Choose the same folder to approve downloads.");
                            if(!new SafFolderProvider(activity.getContentResolver(),tree,signal).root().directory) throw new FolderReader.Failure("Choose a folder.");
                            check.run();auth.identity(request.scope);check.run();
                            store.approveWrite(request.scope,request.approvalGrant,approval,tree,selected.getFlags());
                        } else if(!store.isWriteApproved(request.scope,rootId,approval)) {
                            request.approvalGrant=store.snapshot(request.scope,rootId);request.approval=approval;
                            approve(request,check);return;
                        }
                        result.put("rootId",rootId).put("writeApproval",approval.json());
                    }
                    else if(request.action.startsWith("version-")) {
                        FolderStore.Grant grant=store.snapshot(request.scope,rootId);result.put("rootId",rootId);
                        if(request.action.equals("version-list")) {
                            if(request.payload.has("cursor") && !(request.payload.get("cursor") instanceof String))throw new FolderReader.Failure("Invalid version cursor.");
                            result.put("versionPage",offline.versionList(request.scope,grant,request.payload.has("cursor")?request.payload.getString("cursor"):null));
                        } else if(request.action.equals("version-inspect")) {
                            result.put("retainedEntry",offline.versionInspect(request.scope,grant,SyncStaging.uuid(request.payload,"versionId")));
                        } else {
                            JSONObject restore=request.payload.getJSONObject("restore"),restored=offline.restoreVersion(request.scope,grant,restore,false);
                            if(request.action.equals("version-restore-status")) {
                                result.put("versionRestore",restored==null?new JSONObject().put("status","missing"):new JSONObject().put("status","complete").put("entry",restored));
                            } else {
                            if(restored==null) {
                                if(!request.restoreConsent) {
                                    offline.reviewVersionRestore(request.scope,grant,restore);
                                    request.restoreGrant=grant;request.reviewedRestore=new JSONObject(restore.toString());approveRestore(request,check);return;
                                }
                                if(request.restoreGrant==null || request.reviewedRestore==null || !SyncTrash.same(request.reviewedRestore,restore))throw new FolderReader.Failure("Restore review changed.");
                                restored=offline.restoreVersion(request.scope,request.restoreGrant,restore,true);
                            }
                            result.put("restoredEntry",restored).put("operationId",restore.getString("operationId"));
                            OfflineDocumentsProvider.changed(activity,android.provider.DocumentsContract.getTreeDocumentId(grant.uri));
                            }
                        }
                    }
                    else if(request.action.equals("trash") || request.action.startsWith("trash-")) {
                        FolderStore.Grant grant=store.snapshot(request.scope,rootId);result.put("rootId",rootId);
                        if(request.action.equals("trash-list")) {
                            if(request.payload.has("cursor") && !(request.payload.get("cursor") instanceof String))throw new FolderReader.Failure("Invalid recovery cursor.");
                            result.put("trashPage",offline.trashList(request.scope,grant,request.payload.has("cursor")?request.payload.getString("cursor"):null));
                        } else {
                            JSONObject input=SyncTrash.request(request.payload.getJSONObject("trash"),request.scope,rootId);
                            if(request.action.equals("trash")) result.put("trash",new JSONObject().put("status","complete").put("receipt",
                                offline.trash(request.scope,grant,input,new WriteApproval(request.payload.getJSONObject("approval"),request.scope))));
                            else if(request.action.equals("trash-lookup"))result.put("trash",offline.trashLookup(request.scope,grant,input));
                            else if(request.action.equals("trash-expected"))result.put("expectedEntry",offline.trashExpected(request.scope,grant,input));
                            else if(request.action.equals("trash-inspect")) {
                                JSONObject inspected=offline.trashInspect(request.scope,grant,input);
                                result.put("retainedEntry",inspected.get("retainedEntry")).put("restoreIntent",inspected.get("restoreIntent"));
                            } else {
                                JSONObject restore=SyncTrash.restore(input,request.payload.getJSONObject("restore")),restored;
                                if(request.action.equals("trash-restore")) {
                                    WriteApproval approval=new WriteApproval(request.payload.getJSONObject("approval"),request.scope);
                                    restored=offline.restoreApproved(request.scope,grant,input,restore,approval);
                                } else {
                                    restored=offline.restore(request.scope,grant,input,restore,false);
                                    if(restored==null) {
                                        if(!request.restoreConsent) {
                                            offline.reviewRestore(request.scope,grant,input,restore);
                                            request.restoreGrant=grant;request.reviewedRestore=restore;approveRestore(request,check);return;
                                        }
                                        if(request.restoreGrant==null || request.reviewedRestore==null || !SyncTrash.same(request.reviewedRestore,restore))throw new FolderReader.Failure("Restore review changed.");
                                        restored=offline.restore(request.scope,request.restoreGrant,input,restore,true);
                                    }
                                }
                                result.put("restoredEntry",restored);
                            }
                            if(request.action.equals("trash") || request.action.startsWith("trash-restore"))OfflineDocumentsProvider.changed(activity,android.provider.DocumentsContract.getTreeDocumentId(grant.uri));
                        }
                    }
                    else if(request.action.equals("publish") || request.action.equals("publication-lookup")) {
                        FolderStore.Grant grant=store.snapshot(request.scope,rootId);JSONObject transfer=request.payload.getJSONObject("transfer");
                        JSONObject publication=request.action.equals("publish")
                            ?offline.publish(request.scope,grant,transfer,request.payload.getJSONObject("stage"),new WriteApproval(request.payload.getJSONObject("approval"),request.scope),new SyncStaging(activity,check))
                            :offline.lookup(request.scope,grant,transfer);
                        result.put("rootId",rootId).put("publication",publication);
                        if(request.action.equals("publish"))OfflineDocumentsProvider.changed(activity,android.provider.DocumentsContract.getTreeDocumentId(grant.uri));
                    }
                    else if(request.action.startsWith("stage-")) {
                        // Resolve this account's native grant on every range. A
                        // remembered root ID or existing journal is not authority.
                        FolderStore.Grant selectedGrant=store.snapshot(request.scope,rootId);store.requireRead(request.scope,selectedGrant);
                        FolderReader.Doc root=new SafFolderProvider(activity.getContentResolver(),selectedGrant.uri,signal).root();
                        if(!root.directory)throw new FolderReader.Failure("Folder access is unavailable. Choose it again.");
                        SyncStaging staging=new SyncStaging(activity,check);JSONObject transfer=request.payload.getJSONObject("transfer"),progress;
                        if(request.action.equals("stage-begin"))progress=staging.begin(transfer,request.scope,rootId);
                        else if(request.action.equals("stage-finish"))progress=staging.finish(transfer,request.scope,rootId);
                        else if(request.action.equals("stage-range")) {
                            try(FolderRangeSource range=new FolderRangeSource(check,(token,offset,length)->activity.runOnUiThread(()-> {
                                try {
                                    check.run();if(pending!=request)throw new java.util.concurrent.CancellationException();
                                    JSONObject pull=new JSONObject(request.base.toString()).put("token",token).put("offset",offset).put("length",length);
                                    request.reply.postMessage(new JSONObject().put("type","mobile-files-range-pull").put("payload",pull).toString());
                                } catch(Exception error) { if(request.range!=null)request.range.close();if(request.sink!=null)request.sink.close(); }
                            }))) {
                                request.range=range;check.run();
                                progress=staging.appendRange(transfer,request.scope,rootId,
                                    SyncStaging.integer(request.payload,"offset",9007199254740991L),
                                    SyncStaging.integer(request.payload,"length",32*1024*1024),range::read);
                            } finally { request.range=null; }
                            store.requireRead(request.scope,selectedGrant);check.run();
                        } else {
                            Object encoded=request.payload.get("data");
                            if(!(encoded instanceof String) || ((String)encoded).length()>87384)throw new FolderReader.Failure("Invalid download chunk.");
                            byte[] bytes=java.util.Base64.getDecoder().decode((String)encoded);
                            if(!java.util.Base64.getEncoder().encodeToString(bytes).equals(encoded))throw new FolderReader.Failure("Invalid download chunk.");
                            progress=staging.append(transfer,request.scope,rootId,SyncStaging.integer(request.payload,"offset",9007199254740991L),bytes);
                        }
                        result.put("rootId",rootId).put("staging",progress);
                    }
                    else {
                        FolderStore.Grant grant=store.snapshot(request.scope,rootId);store.requireRead(request.scope,grant);boolean managed=offline.owns(grant.uri);
                        FolderReader reader=managed?null:new FolderReader(PhotoLibrary.owns(activity,grant.uri)?new PhotoLibrary(activity,android.provider.DocumentsContract.getTreeDocumentId(grant.uri),check,signal):new SafFolderProvider(activity.getContentResolver(),grant.uri,signal),check,proofs,request.scope.origin+"\0"+request.scope.owner+"\0"+rootId);
                        result.put("rootId",rootId);
                        if(request.action.equals("scan")) result.put("complete",true).put("entries",managed?offline.scan(request.scope,grant):reader.scan());
                        else {
                            String path=request.payload.getString("path"),version=request.payload.getString("version");
                            long offset=integer(request.payload,"offset",9007199254740991L),length=integer(request.payload,"length",request.action.equals("read-range")?FolderReader.MAX_RANGE:FolderReader.MAX_READ);
                            if(request.action.equals("read-range")) {
                                FolderReader.Range bytes=managed?offline.readRange(request.scope,grant,path,version,offset,(int)length):reader.readRange(path,version,offset,(int)length);
                                // Recheck the owner before disclosing verified bytes. During
                                // backpressure every frame rechecks the same grant and lifecycle.
                                String authentication=SessionCookie.auth(CookieManager.getInstance().getCookie(request.scope.origin+"/api/v1/auth/me"));
                                auth.identity(request.scope);check.run();
                                PairingEngine.Check frameCheck=()->{
                                    check.run();store.requireRead(request.scope,grant);
                                    if(PhotoLibrary.owns(activity,grant.uri))new PhotoLibrary(activity,android.provider.DocumentsContract.getTreeDocumentId(grant.uri),check,signal).stat(android.provider.DocumentsContract.getTreeDocumentId(grant.uri));
                                    if(!authentication.equals(SessionCookie.auth(CookieManager.getInstance().getCookie(request.scope.origin+"/api/v1/auth/me"))))
                                        throw new java.util.concurrent.CancellationException();
                                };
                                try(FolderRangeSink sink=new FolderRangeSink(request.id,frameCheck,frame->activity.runOnUiThread(()-> {
                                    try {frameCheck.run();if(pending!=request)throw new java.util.concurrent.CancellationException();request.reply.postMessage(frame);}
                                    catch(Exception error){if(request.sink!=null)request.sink.close();}
                                }))) {
                                    request.sink=sink;sink.write(bytes.bytes);
                                } finally {request.sink=null;}
                                frameCheck.run();result.put("path",path).put("chunk",bytes.metadata());
                            } else result.put("path",path).put("chunk",managed?offline.read(request.scope,grant,path,version,offset,(int)length):reader.read(path,version,offset,(int)length,Boolean.TRUE.equals(request.payload.opt("verifiedChunks"))));
                        }
                    }
                }
                check.run();auth.identity(request.scope);check.run();result.put("roots",offline.capabilities(request.scope));finish(request,result,null);
            } catch(java.util.concurrent.CancellationException | android.os.OperationCanceledException cancelled) { finish(request,new JSONObject(),"Folder access paused. Try again when the app is active."); }
            catch(Exception failure) { finish(request,new JSONObject(),failure instanceof FolderReader.Failure || failure instanceof PairingEngine.Failure?failure.getMessage():"Folder access is unavailable. Check Files permissions or choose it again."); }
        });
    }
    private void choose(Request request,PairingEngine.Check check) {
        activity.runOnUiThread(()-> {
            try {
                check.run();android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(activity)
                    .setTitle("Choose folder")
                    .setItems(PhotoLibrary.supported()?new String[]{"Existing folder","New offline folder","Photo library (backup)"}:new String[]{"Existing folder","New offline folder"},(d,which)-> {
                        approvalDialog=null;
                        if(which==0){request.chooseExisting=true;execute(request,null,false);}else if(which==2){request.choosePhotos=true;explainPhotos(request,check);}else nameOfflineFolder(request,check);
                    }).setNegativeButton("Cancel",(d,w)->finish(request,new JSONObject(),"Folder selection cancelled.")).create();
                dialog.setOnCancelListener(d->finish(request,new JSONObject(),"Folder selection cancelled."));approvalDialog=dialog;dialog.show();
            }catch(Exception error){finish(request,new JSONObject(),"Folder access paused. Try again when the app is active.");}
        });
    }
    private void explainPhotos(Request request,PairingEngine.Check check) {
        try {
            check.run();android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(activity).setTitle("Back up photo originals")
                .setMessage("Choose which photos and videos Thingtime can read. Original files include their embedded location metadata. Next, choose the photo library or a storage volume in Files, then a cloud destination in Thingtime. Nothing uploads until you start a backup. Removing access or deleting device photos keeps saved cloud copies.")
                .setNegativeButton("Cancel",(d,w)->finish(request,new JSONObject(),"Photo selection cancelled."))
                .setPositiveButton("Choose photo access",(d,w)->{approvalDialog=null;execute(request,null,false);}).create();
            dialog.setOnCancelListener(d->finish(request,new JSONObject(),"Photo selection cancelled."));approvalDialog=dialog;dialog.show();
        }catch(Exception error){finish(request,new JSONObject(),"Photo access is unavailable.");}
    }
    private void requestPhotoPermissions(Request request,PairingEngine.Check check) {
        activity.runOnUiThread(()-> {
            try {check.run();request.photoPermissionsRequested=true;selecting=true;activity.requestPermissions(PhotoLibrary.permissions(),PHOTO_PERMISSIONS);}
            catch(Exception error){finish(request,new JSONObject(),"Photo permissions are unavailable.");}
        });
    }
    private void nameOfflineFolder(Request request,PairingEngine.Check check) {
        try {
            check.run();android.widget.EditText name=new android.widget.EditText(activity);
            name.setSingleLine(true);name.setText("Thingtime offline");name.setSelectAllOnFocus(true);
            name.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(128)});
            android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(activity)
                .setTitle("New offline folder")
                .setMessage("Create a folder stored on this device and visible in Android Files, including when signed out. Other apps can read files you select there. Next, select this folder to connect it to your account. Removing access keeps its files; uninstalling Thingtime removes them.")
                .setView(name).setNegativeButton("Cancel",(d,w)->finish(request,new JSONObject(),"Folder creation cancelled."))
                .setPositiveButton("Create folder",null).create();
            dialog.setOnCancelListener(d->finish(request,new JSONObject(),"Folder creation cancelled."));approvalDialog=dialog;dialog.show();
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener(view-> {
                try {
                    check.run();String value=name.getText().toString().trim();FolderReader.path(value);if(value.contains("/"))throw new Exception();
                    request.offlineName=value;dialog.dismiss();approvalDialog=null;execute(request,null,false);
                }catch(Exception error){name.setError("Enter a folder name without slashes.");}
            });
        }catch(Exception error){finish(request,new JSONObject(),"Folder access paused. Try again when the app is active.");}
    }
    private void approveOffline(Request request,PairingEngine.Check check) {
        activity.runOnUiThread(()-> {
            try {
                check.run();android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(activity)
                    .setTitle((Boolean.TRUE.equals(request.approval.allowTrash)?"Allow downloads and recoverable deletions in ":"Allow downloads to ") + request.approvalGrant.name + "?")
                    .setMessage((Boolean.TRUE.equals(request.approval.allowTrash)?"Deleted files can also move into private recovery storage. ":"") + "Approve this sync connection on " + request.scope.origin + " to add and replace files in this offline folder. Replaced versions are retained. Files you select in Android Files remain readable by other apps. Changing sync settings or choosing this folder again requires renewed approval.")
                    .setNegativeButton("Cancel",(d,w)->finish(request,new JSONObject(),"Download approval cancelled. No new folder write permission was granted."))
                    .setPositiveButton(Boolean.TRUE.equals(request.approval.allowTrash)?"Allow sync and trash":"Allow downloads",(d,w)->{approvalDialog=null;request.offlineConsent=true;execute(request,null,false);}).create();
                dialog.setOnCancelListener(d->finish(request,new JSONObject(),"Download approval cancelled. No new folder write permission was granted."));approvalDialog=dialog;dialog.show();
            }catch(Exception error){finish(request,new JSONObject(),"Folder access paused. Try again when the app is active.");}
        });
    }
    private void approveRestore(Request request,PairingEngine.Check check) {
        activity.runOnUiThread(()-> {
            try {
                check.run();JSONObject restore=request.reviewedRestore;
                android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(activity)
                    .setTitle("Restore to " + request.restoreGrant.name + "?")
                    .setMessage("Restore " + restore.getJSONObject("expected").getString("path") + " as " + restore.getString("path") +
                        " in this offline folder on " + request.scope.origin + ". Existing files are never overwritten.")
                    .setNegativeButton("Cancel",(d,w)->finish(request,new JSONObject(),"Restore cancelled. The retained file is preserved."))
                    .setPositiveButton("Restore",(d,w)->{approvalDialog=null;request.restoreConsent=true;execute(request,null,false);}).create();
                dialog.setOnCancelListener(d->finish(request,new JSONObject(),"Restore cancelled. The retained file is preserved."));approvalDialog=dialog;dialog.show();
            }catch(Exception error){finish(request,new JSONObject(),"Folder access paused. Try again when the app is active.");}
        });
    }
    private void approve(Request request,PairingEngine.Check check) {
        activity.runOnUiThread(()-> {
            try {
                check.run();
                android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(activity)
                    .setTitle("Allow downloads to " + request.approvalGrant.name + "?")
                    .setMessage("Approve this sync connection on " + request.scope.origin + " to add and replace files in this folder. Next, select the same folder in Files to grant Android write access. Choosing or removing this folder clears this connection's approval.")
                    .setNegativeButton("Cancel",(d,w)->finish(request,new JSONObject(),"Download approval cancelled. No new folder write permission was granted."))
                    .setPositiveButton("Continue to Files",(d,w)-> {
                        approvalDialog=null;
                        try {
                            check.run();selecting=true;
                            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION|Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
                                .putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,request.approvalGrant.uri);
                            activity.startActivityForResult(intent,PICK_FOLDER);
                        } catch(Exception error) { finish(request,new JSONObject(),"The system folder picker is unavailable."); }
                    }).create();
                dialog.setOnCancelListener(d->finish(request,new JSONObject(),"Download approval cancelled. No new folder write permission was granted."));
                approvalDialog=dialog;dialog.show();
            } catch(Exception error) { finish(request,new JSONObject(),"Folder access paused. Try again when the app is active."); }
        });
    }
    private void finish(Request request,JSONObject result,String error) {
        if(request.range!=null)request.range.close();if(request.sink!=null)request.sink.close();
        activity.runOnUiThread(()-> {
            if(generation.get()!=request.generation || pending!=request || !active.get()) return;
            if(approvalDialog!=null) { approvalDialog.dismiss();approvalDialog=null; }
            pending=null;selecting=false;reply(request,result,error);
        });
    }
}
