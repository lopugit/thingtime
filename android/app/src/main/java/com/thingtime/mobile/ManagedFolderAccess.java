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
    private final File directory;
    private final String authority;
    private final FolderStore grants;
    private final PairingEngine.Check active;
    ManagedFolderAccess(Context context,FolderStore grants,PairingEngine.Check active) {
        this(new File(context.getNoBackupFilesDir(),"ManagedFiles-v1"),OfflineDocumentsProvider.authority(context),grants,active);
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
            if(!owns(grant.uri))continue;
            try(ManagedFileStore store=store(()->{})) {root(scope,grant,store);row.put("publicationVersion","1.0.0");}
            catch(FolderReader.Failure | SecurityException unavailable) { /* Keep the saved selection; it needs renewed access. */ }
        }
        return roots;
    }
}
