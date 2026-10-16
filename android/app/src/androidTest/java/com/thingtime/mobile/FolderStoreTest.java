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
        Set<Uri> granted=new HashSet<>();int releases;
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
}
