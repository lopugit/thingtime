package com.thingtime.mobile;

import android.content.Context;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

/** One encrypted registry makes cross-account references and grant removal atomic.
 * Every caller must authenticate its scope; provider URIs never cross the bridge. */
final class FolderStore {
    private static final Object LOCK=new Object();
    private final PairingEngine.Store storage;
    interface Permissions {
        boolean has(Uri uri);void take(Uri uri);void release(Uri uri);
        boolean hasWrite(Uri uri);void takeWrite(Uri uri);void releaseWrite(Uri uri);
    }
    private final Permissions permissions;
    private final DeviceScope registry;
    FolderStore(Context context) throws Exception {
        this(new KeystoreDeviceStore(context,"folders"),new Permissions() {
            private final ContentResolver resolver=context.getContentResolver();
            public boolean has(Uri uri) { return resolver.getPersistedUriPermissions().stream().anyMatch(p->p.getUri().equals(uri) && p.isReadPermission()); }
            public boolean hasWrite(Uri uri) { return resolver.getPersistedUriPermissions().stream().anyMatch(p->p.getUri().equals(uri) && p.isWritePermission()); }
            public void takeWrite(Uri uri) { resolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
            public void releaseWrite(Uri uri) { resolver.releasePersistableUriPermission(uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
            public void take(Uri uri) { resolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            public void release(Uri uri) { resolver.releasePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION); }
        });
    }
    FolderStore(PairingEngine.Store storage,Permissions permissions) throws Exception {
        this.storage=storage;this.permissions=permissions;
        registry=new DeviceScope("native-folder-registry","https://native.thingtime.invalid",false);
    }
    private JSONArray all() throws Exception {
        JSONObject saved=storage.load(registry); if(saved==null) return new JSONArray();
        if(!registry.matches(saved.optString("owner"),saved.optString("origin"))) throw new Exception("Invalid folder registry");
        JSONArray rows=saved.getJSONArray("roots"); if(rows.length()>128) throw new Exception("Invalid folder registry");
        java.util.HashSet<String> ids=new java.util.HashSet<>();
        for(int i=0;i<rows.length();i++) {
            JSONObject row=rows.getJSONObject(i);
            if(!UUID.fromString(row.getString("id")).toString().equalsIgnoreCase(row.getString("id")) || !ids.add(row.getString("id"))) throw new Exception("Invalid folder registry");
            DeviceScope scope=new DeviceScope(row.getString("owner"),row.getString("origin"),BuildConfig.DEBUG);
            if(!scope.origin.equals(row.getString("origin")) || row.getString("name").isEmpty() || row.getString("name").length()>1024) throw new Exception("Invalid folder registry");
            tree(row.getString("uri"));
            if(row.has("generation") && !UUID.fromString(row.getString("generation")).toString().equals(row.getString("generation"))) throw new Exception("Invalid folder registry");
            JSONArray approvals=approvals(row);
            if(approvals.length()>32) throw new Exception("Invalid folder registry");
            for(int j=0;j<approvals.length();j++) new WriteApproval(approvals.getJSONObject(j),scope);
        }
        return rows;
    }
    static Uri tree(String value) throws Exception {
        Uri uri=Uri.parse(value);
        if(value.length()>4096 || !"content".equals(uri.getScheme()) || uri.getAuthority()==null || !DocumentsContract.isTreeUri(uri) || uri.getQuery()!=null || uri.getFragment()!=null) throw new Exception("Invalid folder grant");
        DocumentsContract.getTreeDocumentId(uri); return uri;
    }
    private static JSONArray approvals(JSONObject row) throws Exception { return row.has("writeApprovals")?row.getJSONArray("writeApprovals"):new JSONArray(); }
    static final class Grant {
        final String id,name,generation; final Uri uri;
        Grant(JSONObject row) throws Exception {
            id=row.getString("id");name=row.getString("name");uri=tree(row.getString("uri"));generation=row.optString("generation","");
        }
    }
    Grant snapshot(DeviceScope scope,String id) throws Exception { synchronized(LOCK) { return new Grant(find(all(),scope,id)); } }
    private static JSONObject find(JSONArray rows,DeviceScope scope,String id) throws Exception {
        for(int i=0;i<rows.length();i++) { JSONObject row=rows.getJSONObject(i);if(id.equals(row.getString("id")) && scope.matches(row.getString("owner"),row.getString("origin"))) return row; }
        throw new FolderReader.Failure("Folder access is unavailable. Choose it again.");
    }
    boolean isWriteApproved(DeviceScope scope,String id,WriteApproval approval) throws Exception { synchronized(LOCK) {
        new WriteApproval(approval.json(),scope);
        JSONObject row=find(all(),scope,id);Uri uri=tree(row.getString("uri"));
        if(!permissions.has(uri) || !permissions.hasWrite(uri)) return false;
        JSONArray saved=approvals(row);
        for(int i=0;i<saved.length();i++) if(approval.matches(new WriteApproval(saved.getJSONObject(i),scope))) return true;
        return false;
    } }
    /** Native dialog + OS picker + fresh owner verification must precede this call.
     * A fresh generation on re-selection fences even the same provider URI. */
    void approveWrite(DeviceScope scope,Grant original,WriteApproval approval,Uri selected,int flags) throws Exception { synchronized(LOCK) {
        new WriteApproval(approval.json(),scope);
        JSONArray rows=all();JSONObject row=find(rows,scope,original.id);
        if(!original.uri.equals(selected) || !original.uri.equals(tree(row.getString("uri"))) || !original.generation.equals(row.optString("generation","")))
            throw new FolderReader.Failure("The selected folder changed. Start download approval again.");
        if((flags&Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==0 || !permissions.has(selected)) throw new FolderReader.Failure("The picker did not grant writable folder access.");
        boolean existed=permissions.hasWrite(selected);
        // Reacquiring a revoked OS grant must not reactivate old approvals on
        // this or another account's reference to the same provider tree.
        JSONArray next=new JSONArray(),saved=existed?approvals(row):new JSONArray();
        for(int i=0;i<saved.length();i++) if(!approval.sameScope(new WriteApproval(saved.getJSONObject(i),scope))) next.put(saved.getJSONObject(i));
        if(next.length()>=32) throw new FolderReader.Failure("Too many folder write approvals. Choose this folder again to clear them.");
        if(!existed) for(int i=0;i<rows.length();i++) {
            JSONObject previous=rows.getJSONObject(i);
            if(selected.toString().equals(previous.getString("uri"))) previous.remove("writeApprovals");
        }
        next.put(approval.json());row.put("writeApprovals",next);
        permissions.takeWrite(selected);
        try { save(rows); } catch(Exception failure) {
            if(!existed) try { permissions.releaseWrite(selected); } catch(SecurityException ignored) { }
            throw failure;
        }
    } }
    private void releaseUnusedWrite(JSONArray rows,Uri uri) throws Exception {
        for(int i=0;i<rows.length();i++) { JSONObject row=rows.getJSONObject(i);if(uri.toString().equals(row.getString("uri")) && approvals(row).length()>0) return; }
        if(permissions.hasWrite(uri)) try { permissions.releaseWrite(uri); } catch(SecurityException alreadyRevoked) { }
    }
    private void save(JSONArray rows) throws Exception { storage.save(registry,new JSONObject().put("owner",registry.owner).put("origin",registry.origin).put("roots",rows)); }
    JSONArray list(DeviceScope scope) throws Exception { synchronized(LOCK) {
        JSONArray rows=all(), result=new JSONArray();
        for(int i=0;i<rows.length();i++) { JSONObject r=rows.getJSONObject(i); if(scope.matches(r.getString("owner"),r.getString("origin"))) result.put(new JSONObject().put("id",r.getString("id")).put("name",r.getString("name"))); }
        return result;
    } }
    Uri grant(DeviceScope scope,String id) throws Exception { synchronized(LOCK) {
        JSONArray rows=all(); for(int i=0;i<rows.length();i++) { JSONObject r=rows.getJSONObject(i); if(id.equals(r.getString("id")) && scope.matches(r.getString("owner"),r.getString("origin"))) return tree(r.getString("uri")); }
        throw new FolderReader.Failure("Folder access is unavailable. Choose it again.");
    } }
    void add(DeviceScope scope,Uri selected,int flags,String name) throws Exception { synchronized(LOCK) {
        tree(selected.toString());
        if((flags&Intent.FLAG_GRANT_READ_URI_PERMISSION)==0 || name.isEmpty() || name.length()>1024) throw new FolderReader.Failure("The picker did not grant readable folder access.");
        JSONArray rows=all(); int index=-1, count=0;
        for(int i=0;i<rows.length();i++) { JSONObject r=rows.getJSONObject(i); if(scope.matches(r.getString("owner"),r.getString("origin"))) { count++; if(selected.toString().equals(r.getString("uri"))) index=i; } }
        if(index<0 && (count>=32 || rows.length()>=128)) throw new FolderReader.Failure("Too many selected folders. Remove an unused selection first.");
        boolean existed=permissions.has(selected);
        permissions.take(selected);
        try {
            String id=index<0?UUID.randomUUID().toString():rows.getJSONObject(index).getString("id");
            JSONObject row=new JSONObject().put("id",id).put("owner",scope.owner).put("origin",scope.origin).put("uri",selected.toString()).put("name",name).put("generation",UUID.randomUUID().toString());
            if(index<0) rows.put(row); else rows.put(index,row); save(rows);
        } catch(Exception failure) {
            if(!existed) try { permissions.release(selected); } catch(SecurityException ignored) { }
            throw failure;
        }
        releaseUnusedWrite(rows,selected);
    } }
    void remove(DeviceScope scope,String id) throws Exception { synchronized(LOCK) {
        JSONArray rows=all(), next=new JSONArray(); String removed=null;
        for(int i=0;i<rows.length();i++) { JSONObject r=rows.getJSONObject(i); if(id.equals(r.getString("id")) && scope.matches(r.getString("owner"),r.getString("origin"))) removed=r.getString("uri"); else next.put(r); }
        save(next);
        if(removed!=null) {
            releaseUnusedWrite(next,tree(removed));
            for(int i=0;i<next.length();i++) if(removed.equals(next.getJSONObject(i).getString("uri"))) return;
            try { permissions.release(tree(removed)); } catch(SecurityException alreadyRevoked) { }
        }
    } }
}
