package com.thingtime.mobile;

import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.File;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** The native grant/consent boundary for the transactional offline adapter.
 * Generic SAF providers never enter this publication path. Callers authenticate
 * the account before entry; grants and consent are checked again at commit. */
final class ManagedFolderAccess {
    private Context contextForPhotos;
    private final File directory;
    private final String authority;
    private final FolderStore grants;
    private final PairingEngine.Check active;
    ManagedFolderAccess(Context context,FolderStore grants,PairingEngine.Check active) {
        this(new File(context.getNoBackupFilesDir(),"ManagedFiles-v1"),OfflineDocumentsProvider.authority(context),grants,active);this.contextForPhotos=context;
    }
    ManagedFolderAccess(File directory,String authority,FolderStore grants,PairingEngine.Check active) {
        this.directory=directory;this.authority=authority;this.grants=grants;this.active=active;
    }
    boolean owns(Uri uri) {return authority.equals(uri.getAuthority());}
    private String root(DeviceScope scope,FolderStore.Grant grant,ManagedFileStore store) throws Exception {
        active.run();grants.requireRead(scope,grant);
        if(!owns(grant.uri))throw new FolderReader.Failure("Downloads require a Thingtime offline folder on this device.");
        String id=DocumentsContract.getTreeDocumentId(grant.uri);
        if(!UUID.fromString(id).toString().equals(id) || !grant.uri.equals(DocumentsContract.buildTreeDocumentUri(authority,id)))
            throw new FolderReader.Failure("Select the offline folder root again.");
        store.requireFilesRoot(scope,id);return id;
    }
    private ManagedFileStore store(PairingEngine.Check beforeCommit) throws Exception {return new ManagedFileStore(directory,active,beforeCommit,()->{});}
    boolean approved(DeviceScope scope,FolderStore.Grant grant,WriteApproval approval) throws Exception {
        try(ManagedFileStore store=store(()->{})){root(scope,grant,store);return grants.isOfflineWriteApproved(scope,grant,approval);}
    }
    void approve(DeviceScope scope,FolderStore.Grant grant,WriteApproval approval) throws Exception {
        try(ManagedFileStore store=store(()->{})){root(scope,grant,store);active.run();grants.approveOfflineWrite(scope,grant,approval);}
    }
    private void requireApproval(DeviceScope scope,FolderStore.Grant grant,WriteApproval approval) throws Exception {
        active.run();if(!grants.isOfflineWriteApproved(scope,grant,approval))throw new FolderReader.Failure("Approve this folder and current sync settings before downloading.");
    }
    JSONObject publish(DeviceScope scope,FolderStore.Grant grant,JSONObject transfer,JSONObject stage,WriteApproval approval,SyncStaging staging) throws Exception {
        JSONObject request=SyncStaging.request(transfer,scope,grant.id);
        if(!SyncStaging.canonical(request.getJSONObject("scope")).equals(SyncStaging.canonical(approval.json().getJSONObject("scope"))))
            throw new FolderReader.Failure("Download approval scope changed.");
        requireApproval(scope,grant,approval);
        try(ManagedFileStore store=store(()->requireApproval(scope,grant,approval))) {
            String root=root(scope,grant,store);
            JSONObject receipt=store.publish(scope,root,grant.id,request,stage,staging);
            return new JSONObject().put("status","complete").put("receipt",receipt);
        }
    }
    JSONObject lookup(DeviceScope scope,FolderStore.Grant grant,JSONObject transfer) throws Exception {
        try(ManagedFileStore store=store(()->{})){return store.lookup(scope,root(scope,grant,store),grant.id,transfer);}
    }
    JSONObject trash(DeviceScope scope,FolderStore.Grant grant,JSONObject input,WriteApproval approval) throws Exception {
        JSONObject request=SyncTrash.request(input,scope,grant.id);
        if(!Boolean.TRUE.equals(approval.allowTrash) || !SyncTrash.same(request.getJSONObject("scope"),approval.json().getJSONObject("scope")))
            throw new FolderReader.Failure("Approve recoverable deletions for this connection first.");
        requireApproval(scope,grant,approval);
        try(ManagedFileStore store=store(()->requireApproval(scope,grant,approval))){return store.trash(scope,root(scope,grant,store),grant.id,request);}
    }
    JSONObject trashLookup(DeviceScope scope,FolderStore.Grant grant,JSONObject input) throws Exception {
        try(ManagedFileStore store=store(()->{})){return store.trashLookup(scope,root(scope,grant,store),grant.id,input);}
    }
    JSONObject trashExpected(DeviceScope scope,FolderStore.Grant grant,JSONObject input) throws Exception {
        try(ManagedFileStore store=store(()->{})){return store.trashExpected(scope,root(scope,grant,store),grant.id,input);}
    }
    JSONObject trashInspect(DeviceScope scope,FolderStore.Grant grant,JSONObject input) throws Exception {
        try(ManagedFileStore store=store(()->{})){return store.trashInspect(scope,root(scope,grant,store),grant.id,input);}
    }
    JSONObject trashList(DeviceScope scope,FolderStore.Grant grant,String cursor) throws Exception {
        try(ManagedFileStore store=store(()->{})){return store.trashList(scope,root(scope,grant,store),grant.id,cursor);}
    }
    void reviewRestore(DeviceScope scope,FolderStore.Grant grant,JSONObject input,JSONObject restore) throws Exception {
        try(ManagedFileStore store=store(()->{})){store.reviewTrashRestore(scope,root(scope,grant,store),grant.id,input,restore);}
    }
    JSONObject restore(DeviceScope scope,FolderStore.Grant grant,JSONObject input,JSONObject restore,boolean approved) throws Exception {
        try(ManagedFileStore store=store(()->{active.run();grants.requireRead(scope,grant);})){
            return store.restoreTrash(scope,root(scope,grant,store),grant.id,input,restore,approved);
        }
    }
    JSONObject restoreApproved(DeviceScope scope,FolderStore.Grant grant,JSONObject input,JSONObject restore,WriteApproval approval) throws Exception {
        JSONObject request=SyncTrash.request(input,scope,grant.id);
        if(!SyncTrash.same(request.getJSONObject("scope"),approval.json().getJSONObject("scope")))throw new FolderReader.Failure("Restore approval scope changed.");
        requireApproval(scope,grant,approval);
        try(ManagedFileStore store=store(()->requireApproval(scope,grant,approval))){return store.restoreTrash(scope,root(scope,grant,store),grant.id,request,restore,true);}
    }
    JSONObject versionList(DeviceScope scope,FolderStore.Grant grant,String cursor) throws Exception {
        try(ManagedFileStore store=store(()->{})){JSONObject result=store.versionList(scope,root(scope,grant,store),grant.id,cursor);active.run();grants.requireRead(scope,grant);return result;}
    }
    JSONObject versionInspect(DeviceScope scope,FolderStore.Grant grant,String versionId) throws Exception {
        try(ManagedFileStore store=store(()->{})){JSONObject result=store.versionInspect(scope,root(scope,grant,store),grant.id,versionId);active.run();grants.requireRead(scope,grant);return result;}
    }
    void reviewVersionRestore(DeviceScope scope,FolderStore.Grant grant,JSONObject request) throws Exception {
        try(ManagedFileStore store=store(()->{})){store.reviewVersionRestore(scope,root(scope,grant,store),grant.id,request);active.run();grants.requireRead(scope,grant);}
    }
    JSONObject restoreVersion(DeviceScope scope,FolderStore.Grant grant,JSONObject request,boolean approved) throws Exception {
        try(ManagedFileStore store=store(()->{active.run();grants.requireRead(scope,grant);})){
            JSONObject result=store.restoreVersion(scope,root(scope,grant,store),grant.id,request,approved);active.run();grants.requireRead(scope,grant);return result;
        }
    }
    NativeUploadSource.Reader uploadSource(DeviceScope scope,FolderStore.Grant grant,JSONObject source) throws Exception {
        JSONObject expected=SyncStaging.entry(source);
        return work->{
            try(ManagedFileStore store=store(()->{})) {store.readUploadSource(scope,root(scope,grant,store),expected,work);}
            active.run();grants.requireRead(scope,grant);
        };
    }
    JSONArray scan(DeviceScope scope,FolderStore.Grant grant) throws Exception {
        try(ManagedFileStore store=store(()->{})){return store.scan(scope,root(scope,grant,store));}
    }
    JSONObject read(DeviceScope scope,FolderStore.Grant grant,String path,String version,long offset,int length) throws Exception {
        try(ManagedFileStore store=store(()->{})){return store.read(scope,root(scope,grant,store),path,version,offset,length);}
    }
    FolderReader.Range readRange(DeviceScope scope,FolderStore.Grant grant,String path,String version,long offset,int length) throws Exception {
        try(ManagedFileStore store=store(()->{})){return store.readRange(scope,root(scope,grant,store),path,version,offset,length);}
    }
    JSONArray capabilities(DeviceScope scope) throws Exception {
        JSONArray roots=grants.list(scope);
        for(int i=0;i<roots.length();i++) {
            JSONObject row=roots.getJSONObject(i);FolderStore.Grant grant=grants.snapshot(scope,row.getString("id"));
            if(contextForPhotos!=null && PhotoLibrary.owns(contextForPhotos,grant.uri)) {row.put("sourceKind","photos").put("photoAccess",PhotoLibrary.access(contextForPhotos));continue;}
            if(!owns(grant.uri))continue;
            try(ManagedFileStore store=store(()->{})) {root(scope,grant,store);row.put("publicationVersion","1.0.0");}
            catch(FolderReader.Failure | SecurityException unavailable) { /* Keep the saved selection; it needs renewed access. */ }
        }
        return roots;
    }
}
