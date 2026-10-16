package com.thingtime.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import android.net.Uri;
import android.content.Intent;
import java.util.*;

/** Real Android URI/JSON semantics; synthetic permission service, no user files. */
public class FolderStoreTest {
    private static class Storage implements PairingEngine.Store {
        JSONObject value;boolean fail;
        public JSONObject load(DeviceScope scope) throws Exception { return value==null?null:new JSONObject(value.toString()); }
        public void save(DeviceScope scope,JSONObject value) throws Exception { if(fail) throw new java.io.IOException("Synthetic disk failure");this.value=new JSONObject(value.toString()); }
    }
    private static class Permissions implements FolderStore.Permissions {
        Set<Uri> granted=new HashSet<>(),writable=new HashSet<>();int releases;
        public boolean hasWrite(Uri uri) { return writable.contains(uri); }
        public void takeWrite(Uri uri) { writable.add(uri); }
        public void releaseWrite(Uri uri) { writable.remove(uri); }
        public boolean has(Uri uri) { return granted.contains(uri); }
        public void take(Uri uri) { granted.add(uri); }
        public void release(Uri uri) { granted.remove(uri);releases++; }
    }
    private DeviceScope scope(String owner) throws Exception { return new DeviceScope(owner,"https://folder.test",false); }
    @Test public void reloadIsolationAndSharedGrantRemoval() throws Exception {
        Storage data=new Storage();Permissions permissions=new Permissions();FolderStore store=new FolderStore(data,permissions);
        DeviceScope one=scope("one"),two=scope("two");Uri uri=Uri.parse("content://folder-fixture.test/tree/root");
        store.add(one,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Selected");String id=store.list(one).getJSONObject(0).getString("id");
        store.add(one,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Selected again");assertEquals(id,store.list(one).getJSONObject(0).getString("id"));
        assertEquals(uri,new FolderStore(data,permissions).grant(one,id));assertEquals(0,store.list(two).length());assertThrows(Exception.class,()->store.grant(two,id));
        assertEquals(0,store.list(new DeviceScope("one","https://elsewhere.test",false)).length());
        store.add(two,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Second account");String other=store.list(two).getJSONObject(0).getString("id");
        store.remove(one,id);assertTrue(permissions.has(uri));assertEquals(0,permissions.releases);assertThrows(Exception.class,()->store.grant(one,id));
        store.remove(two,other);assertFalse(permissions.has(uri));assertEquals(1,permissions.releases);
        assertFalse(store.list(one).toString().contains("content://"));
    }
    @Test public void failedSaveCannotLeaveANewGrantOrReleaseAnotherAccount() throws Exception {
        Storage data=new Storage();Permissions permissions=new Permissions();FolderStore store=new FolderStore(data,permissions);
        Uri uri=Uri.parse("content://folder-fixture.test/tree/root");DeviceScope one=scope("one"),two=scope("two");
        data.fail=true;assertThrows(Exception.class,()->store.add(one,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Selected"));assertFalse(permissions.has(uri));assertEquals(0,store.list(one).length());
        data.fail=false;store.add(one,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Selected");String id=store.list(one).getJSONObject(0).getString("id");
        data.fail=true;assertThrows(Exception.class,()->store.add(two,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Selected"));assertTrue(permissions.has(uri));assertEquals(0,store.list(two).length());
        assertThrows(Exception.class,()->store.remove(one,id));assertEquals(uri,store.grant(one,id));assertTrue(permissions.has(uri));
    }
    @Test public void boundsAndInvalidStoredScopeFailClosed() throws Exception {
        Storage data=new Storage();Permissions permissions=new Permissions();FolderStore store=new FolderStore(data,permissions);DeviceScope one=scope("one");
        for(int i=0;i<32;i++) store.add(one,Uri.parse("content://folder-fixture.test/tree/"+i),Intent.FLAG_GRANT_READ_URI_PERMISSION,"Folder "+i);
        assertThrows(Exception.class,()->store.add(one,Uri.parse("content://folder-fixture.test/tree/extra"),Intent.FLAG_GRANT_READ_URI_PERMISSION,"Extra"));
        assertFalse(permissions.has(Uri.parse("content://folder-fixture.test/tree/extra")));
        assertThrows(Exception.class,()->store.add(one,Uri.parse("file:///private"),Intent.FLAG_GRANT_READ_URI_PERMISSION,"Unsafe"));
        data.value.put("owner","foreign");assertThrows(Exception.class,()->store.list(one));
    }

    private WriteApproval approval(DeviceScope account,String root,String revision) throws Exception {
        return new WriteApproval(new JSONObject().put("scope",new JSONObject().put("ownerId",account.owner).put("origin",account.origin).put("dataPlane","home").put("rootId",root).put("deviceId","device"))
            .put("configurationRevision",revision).put("configurationHash","a".repeat(64)),account);
    }
    private String add(FolderStore store,DeviceScope account,Uri uri) throws Exception {
        store.add(account,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Selected");return store.list(account).getJSONObject(0).getString("id");
    }
    @Test public void approvalReloadRevisionIsolationAndReselectionFence() throws Exception {
        Storage data=new Storage();Permissions permissions=new Permissions();FolderStore store=new FolderStore(data,permissions);
        DeviceScope one=scope("one"),two=scope("two");Uri uri=Uri.parse("content://folder-fixture.test/tree/root");String id=add(store,one,uri);
        WriteApproval approval=approval(one,"remote-root","1");FolderStore.Grant old=store.snapshot(one,id);
        assertFalse(store.isWriteApproved(one,id,approval));
        store.approveWrite(one,old,approval,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        assertTrue(new FolderStore(data,permissions).isWriteApproved(one,id,approval));
        assertFalse(store.isWriteApproved(one,id,approval(one,"remote-root","2")));
        assertFalse(store.isWriteApproved(one,id,approval(one,"another-root","1")));
        assertThrows(Exception.class,()->store.isWriteApproved(two,id,approval));
        WriteApproval changedHash=new WriteApproval(approval.json().put("configurationHash","b".repeat(64)),one);
        assertFalse(store.isWriteApproved(one,id,changedHash));
        store.approveWrite(one,old,approval(one,"remote-root","2"),uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        assertFalse(store.isWriteApproved(one,id,approval));
        add(store,one,uri);assertFalse(permissions.hasWrite(uri));
        assertThrows(Exception.class,()->store.approveWrite(one,old,approval,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        assertFalse(store.isWriteApproved(one,id,approval));
        assertFalse(store.list(one).toString().contains("writeApprovals"));
    }
    @Test public void writePermissionRollbackSharedReferencesAndOsRevocation() throws Exception {
        Storage data=new Storage();Permissions permissions=new Permissions();FolderStore store=new FolderStore(data,permissions);
        DeviceScope one=scope("one"),two=scope("two");Uri uri=Uri.parse("content://folder-fixture.test/tree/root");
        String a=add(store,one,uri),b=add(store,two,uri);WriteApproval approval=approval(one,"root","1"),other=approval(two,"root","1");
        FolderStore.Grant first=store.snapshot(one,a),second=store.snapshot(two,b);
        data.fail=true;assertThrows(Exception.class,()->store.approveWrite(one,first,approval,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        assertFalse(permissions.hasWrite(uri));assertTrue(permissions.has(uri));
        data.fail=false;store.approveWrite(one,first,approval,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        data.fail=true;assertThrows(Exception.class,()->store.approveWrite(two,second,other,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        assertTrue(permissions.hasWrite(uri));assertTrue(store.isWriteApproved(one,a,approval));assertFalse(store.isWriteApproved(two,b,other));
        data.fail=false;store.approveWrite(two,second,other,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        store.remove(one,a);assertTrue(permissions.hasWrite(uri));assertTrue(store.isWriteApproved(two,b,other));
        permissions.releaseWrite(uri);assertFalse(store.isWriteApproved(two,b,other));
        store.approveWrite(two,second,other,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        add(store,one,uri);store.remove(two,b);
        assertFalse(permissions.hasWrite(uri));assertTrue(permissions.has(uri));
    }
    @Test public void approvalCannotChangeSelectedFolderOrExceedBounds() throws Exception {
        Storage data=new Storage();Permissions permissions=new Permissions();FolderStore store=new FolderStore(data,permissions);DeviceScope one=scope("one");
        Uri uri=Uri.parse("content://folder-fixture.test/tree/root"),other=Uri.parse("content://folder-fixture.test/tree/other");String id=add(store,one,uri);
        FolderStore.Grant selected=store.snapshot(one,id);WriteApproval approval=approval(one,"root","1");
        assertThrows(Exception.class,()->store.approveWrite(one,selected,approval,other,Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        assertThrows(Exception.class,()->store.approveWrite(one,selected,approval,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION));
        assertFalse(permissions.hasWrite(uri));
        for(int i=0;i<32;i++) store.approveWrite(one,selected,approval(one,"root-"+i,"1"),uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        assertThrows(Exception.class,()->store.approveWrite(one,selected,approval,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
        store.approveWrite(one,selected,approval(one,"root-0","2"),uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        assertTrue(store.isWriteApproved(one,id,approval(one,"root-0","2")));
        store.remove(one,id);assertFalse(permissions.hasWrite(uri));assertFalse(permissions.has(uri));
        assertThrows(Exception.class,()->store.approveWrite(one,selected,approval,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
    }

    @Test public void regrantAfterOsRevocationCannotReactivateOtherApprovals() throws Exception {
        Storage data=new Storage();Permissions permissions=new Permissions();FolderStore store=new FolderStore(data,permissions);
        DeviceScope one=scope("one"),two=scope("two");Uri uri=Uri.parse("content://folder-fixture.test/tree/root");
        String a=add(store,one,uri),b=add(store,two,uri);WriteApproval first=approval(one,"root","1"),second=approval(two,"root","1");
        FolderStore.Grant firstGrant=store.snapshot(one,a),secondGrant=store.snapshot(two,b);
        store.approveWrite(one,firstGrant,first,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        store.approveWrite(one,firstGrant,approval(one,"another-root","1"),uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        store.approveWrite(two,secondGrant,second,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        permissions.releaseWrite(uri);
        // No intervening isWriteApproved call is required to notice revocation.
        store.approveWrite(one,firstGrant,first,uri,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        assertTrue(store.isWriteApproved(one,a,first));assertFalse(store.isWriteApproved(one,a,approval(one,"another-root","1")));
        assertFalse(new FolderStore(data,permissions).isWriteApproved(two,b,second));
        assertTrue(permissions.has(uri));assertTrue(permissions.hasWrite(uri));
    }
}
