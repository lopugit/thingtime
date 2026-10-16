package com.thingtime.mobile;

import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.JSONObject;
import org.junit.*;
import static org.junit.Assert.*;
import java.util.*;

public class ManagedFolderAccessTest {
    static final String AUTHORITY="com.thingtime.offline.fixture";
    ManagedFileStoreTest fixture;FolderStore registry;FolderStore.Grant grant;DeviceScope owner;Uri uri;
    Storage data;Permissions permissions;ManagedFolderAccess access;
    static final class Storage implements PairingEngine.Store {
        JSONObject value;boolean fail;
        public JSONObject load(DeviceScope scope) throws Exception {return value==null?null:new JSONObject(value.toString());}
        public void save(DeviceScope scope,JSONObject value) throws Exception {if(fail)throw new java.io.IOException("Disk failure");this.value=new JSONObject(value.toString());}
    }
    static final class Permissions implements FolderStore.Permissions {
        Set<Uri> read=new HashSet<>();
        public boolean has(Uri uri){return read.contains(uri);}public void take(Uri uri){read.add(uri);}public void release(Uri uri){read.remove(uri);}
        public boolean hasWrite(Uri uri){return false;}public void takeWrite(Uri uri){throw new AssertionError("No OS writable handle needed");}public void releaseWrite(Uri uri){throw new AssertionError("No OS writable handle granted");}
    }
    @Before public void before() throws Exception {
        fixture=new ManagedFileStoreTest();fixture.before();owner=fixture.fixture.owner;
        try(ManagedFileStore store=fixture.store()){store.exposeInFiles(owner,fixture.root);}
        data=new Storage();permissions=new Permissions();registry=new FolderStore(data,permissions);
        uri=DocumentsContract.buildTreeDocumentUri(AUTHORITY,fixture.root);
        registry.add(owner,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Offline");
        grant=registry.snapshot(owner,registry.list(owner).getJSONObject(0).getString("id"));fixture.fixture.grant=grant.id;
        access=new ManagedFolderAccess(fixture.managed,AUTHORITY,registry,()->{});
    }
    @After public void after() throws Exception {fixture.after();}
    WriteApproval approval(JSONObject request,String revision) throws Exception {
        return new WriteApproval(new JSONObject().put("scope",request.getJSONObject("scope")).put("configurationRevision",revision).put("configurationHash","a".repeat(64)),owner);
    }
    @Test public void approvalPublicationReadAndHistoricalLookupShareTheNativeContract() throws Exception {
        byte[] bytes={1,2,3};JSONObject request=fixture.request("file.bin",bytes,false),stage=fixture.stage(request,bytes);WriteApproval approval=approval(request,"1");
        assertEquals("1.0.0",access.capabilities(owner).getJSONObject(0).getString("publicationVersion"));
        assertFalse(access.approved(owner,grant,approval));assertThrows(Exception.class,()->access.publish(owner,grant,request,stage,approval,fixture.fixture.store()));
        access.approve(owner,grant,approval);assertTrue(access.approved(owner,grant,approval));
        JSONObject publication=access.publish(owner,grant,request,stage,approval,fixture.fixture.store()),entry=publication.getJSONObject("receipt").getJSONObject("entry");
        assertEquals(SyncStaging.canonical(publication),SyncStaging.canonical(access.lookup(owner,grant,request)));
        assertEquals(SyncStaging.canonical(entry),SyncStaging.canonical(access.scan(owner,grant).getJSONObject(0)));
        assertEquals("AQID",access.read(owner,grant,"file.bin",entry.getString("version"),0,3).getString("data"));
        assertEquals(SyncStaging.canonical(publication),SyncStaging.canonical(access.publish(owner,grant,request,new JSONObject(),approval,fixture.fixture.store())));
        FolderStore reloaded=new FolderStore(data,permissions);
        assertTrue(new ManagedFolderAccess(fixture.managed,AUTHORITY,reloaded,()->{}).approved(owner,grant,approval));
        assertFalse(registry.isWriteApproved(owner,grant.id,approval));
    }
    @Test public void revisionReselectionRevocationAndRemovalInvalidateConsent() throws Exception {
        JSONObject request=fixture.request("file.bin",new byte[]{1},false);WriteApproval first=approval(request,"1"),second=approval(request,"2");
        access.approve(owner,grant,first);assertFalse(access.approved(owner,grant,second));access.approve(owner,grant,second);assertFalse(access.approved(owner,grant,first));
        permissions.read.clear();assertThrows(Exception.class,()->access.approved(owner,grant,second));assertFalse(access.capabilities(owner).getJSONObject(0).has("publicationVersion"));
        registry.add(owner,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Offline again");assertThrows(Exception.class,()->access.approve(owner,grant,second));
        FolderStore.Grant fresh=registry.snapshot(owner,grant.id);assertFalse(access.approved(owner,fresh,second));access.approve(owner,fresh,second);
        registry.remove(owner,grant.id);assertThrows(Exception.class,()->access.scan(owner,fresh));
        try(ManagedFileStore store=fixture.store()){assertEquals(fixture.root,store.document(fixture.root).id);}
    }
    @Test public void foreignProviderRootAccountAndApprovalScopeCannotPublish() throws Exception {
        JSONObject request=fixture.request("file.bin",new byte[]{1},false),stage=fixture.stage(request,new byte[]{1});WriteApproval approval=approval(request,"1");access.approve(owner,grant,approval);
        JSONObject changed=new JSONObject(request.toString());changed.getJSONObject("scope").put("deviceId","different-device");
        assertThrows(Exception.class,()->access.publish(owner,grant,changed,stage,approval,fixture.fixture.store()));
        DeviceScope foreign=new DeviceScope("different",owner.origin,false);assertThrows(Exception.class,()->access.approve(foreign,grant,approval));
        Uri generic=Uri.parse("content://external.fixture/tree/root");registry.add(owner,generic,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Generic");
        FolderStore.Grant other=registry.snapshot(owner,registry.list(owner).getJSONObject(1).getString("id"));
        assertFalse(access.capabilities(owner).getJSONObject(1).has("publicationVersion"));assertThrows(Exception.class,()->access.approve(owner,other,approval));
        assertThrows(Exception.class,()->access.lookup(owner,other,request));
        registry.add(foreign,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION,"Foreign");FolderStore.Grant stolen=registry.snapshot(foreign,registry.list(foreign).getJSONObject(0).getString("id"));
        assertThrows(Exception.class,()->access.scan(foreign,stolen));
    }
    @Test public void failedApprovalPersistenceAndMidCopyRevocationLeaveNoVisibleFile() throws Exception {
        byte[] bytes=new byte[131073];JSONObject request=fixture.request("file.bin",bytes,false),stage=fixture.stage(request,bytes);WriteApproval approval=approval(request,"1");
        data.fail=true;assertThrows(Exception.class,()->access.approve(owner,grant,approval));data.fail=false;assertFalse(access.approved(owner,grant,approval));access.approve(owner,grant,approval);
        ManagedFolderAccess racing=new ManagedFolderAccess(fixture.managed,AUTHORITY,registry,()->{
            java.io.File[] blobs=new java.io.File(fixture.managed,"blobs").listFiles();if(blobs!=null && blobs.length>0)permissions.read.clear();
        });
        assertThrows(Exception.class,()->racing.publish(owner,grant,request,stage,approval,fixture.fixture.store()));
        try(ManagedFileStore store=fixture.store()){assertEquals(0,store.scan(owner,fixture.root).length());assertEquals("missing",store.lookup(owner,fixture.root,grant.id,request).getString("status"));}
    }
}
