package com.thingtime.mobile;

import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.File;
import java.util.UUID;

/** Actual Android SQLite catalog and immutable bytes, including rollback,
 * replay, nested parent transitions and independent native grant fencing. */
public class ManagedTrashTest {
    ManagedFileStoreTest f;
    @Before public void before() throws Exception {f=new ManagedFileStoreTest();f.before();}
    @After public void after() throws Exception {f.after();}
    static JSONObject request(ManagedFileStoreTest f,JSONObject entry) throws Exception {
        JSONObject request=f.request(entry.getString("path"),new byte[0],false);
        request.getJSONObject("operation").put("mutation",new JSONObject().put("kind","trash").put("side","local")
            .put("path",entry.getString("path")).put("expected",entry));return request;
    }
    JSONObject entry(String path) throws Exception {
        try(ManagedFileStore s=f.store()){JSONArray entries=s.scan(f.fixture.owner,f.root);for(int i=0;i<entries.length();i++)if(entries.getJSONObject(i).getString("path").equals(path))return entries.getJSONObject(i);}
        throw new AssertionError("Missing fixture entry: "+path);
    }
    JSONObject trash(JSONObject request) throws Exception {try(ManagedFileStore s=f.store()){return s.trash(f.fixture.owner,f.root,f.fixture.grant,request);}}
    JSONObject restore(JSONObject request,String path) throws Exception {
        try(ManagedFileStore s=f.store()){return new JSONObject().put("path",path).put("expected",s.trashInspect(f.fixture.owner,f.root,f.fixture.grant,request).getJSONObject("retainedEntry"));}
    }
    static String id(JSONObject request) throws Exception {return request.getJSONObject("operation").getString("id");}
    static JSONObject parent(JSONObject entry,String previous) throws Exception {JSONObject value=new JSONObject().put("expected",entry);if(previous!=null)value.put("previousOperationId",previous);return value;}
    @Test public void rollbackAndLostDeleteReplyPreserveExactRecoverableBytes() throws Exception {
        byte[] bytes={1,2,3};JSONObject original=f.publish(f.request("file",bytes,false),bytes).getJSONObject("entry"),request=request(f,original);
        try(ManagedFileStore fail=new ManagedFileStore(f.managed,()->{},()->{throw new java.io.IOException("Before commit");},()->{})) {
            assertThrows(Exception.class,()->fail.trash(f.fixture.owner,f.root,f.fixture.grant,request));
        }
        assertTrue(SyncTrash.same(original,entry("file")));
        try(ManagedFileStore s=f.store()){assertEquals("missing",s.trashLookup(f.fixture.owner,f.root,f.fixture.grant,request).getString("status"));assertEquals(0,s.trashList(f.fixture.owner,f.root,f.fixture.grant,null).getJSONArray("items").length());}
        try(ManagedFileStore lost=new ManagedFileStore(f.managed,()->{},()->{},()->{throw new java.io.IOException("Lost reply");})) {
            assertThrows(Exception.class,()->lost.trash(f.fixture.owner,f.root,f.fixture.grant,request));
        }
        try(ManagedFileStore s=f.store()) {
            assertEquals(0,s.scan(f.fixture.owner,f.root).length());
            assertTrue(SyncTrash.same(SyncTrash.receipt(request),s.trashLookup(f.fixture.owner,f.root,f.fixture.grant,request).getJSONObject("receipt")));
            assertTrue(SyncTrash.same(original,s.trashInspect(f.fixture.owner,f.root,f.fixture.grant,request).getJSONObject("retainedEntry")));
        }
        JSONObject target=restore(request,"restored"),restored;
        try(ManagedFileStore s=f.store()){assertNull(s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,false));s.reviewTrashRestore(f.fixture.owner,f.root,f.fixture.grant,request,target);restored=s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,true);}
        assertEquals(original.getString("id"),restored.getString("id"));assertNotEquals(original.getString("version"),restored.getString("version"));assertArrayEquals(bytes,f.read(restored,0,3));
    }
    @Test public void restoreCommitReplayCannotOverwriteLaterEditsOrChangeDestination() throws Exception {
        byte[] bytes={4,5};JSONObject request=request(f,f.publish(f.request("file",bytes,false),bytes).getJSONObject("entry"));trash(request);JSONObject target=restore(request,"file");
        try(ManagedFileStore fail=new ManagedFileStore(f.managed,()->{},()->{throw new java.io.IOException("Before restore commit");},()->{})) {
            assertThrows(Exception.class,()->fail.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,true));
        }
        try(ManagedFileStore s=f.store()){assertEquals(0,s.scan(f.fixture.owner,f.root).length());assertTrue(s.trashInspect(f.fixture.owner,f.root,f.fixture.grant,request).isNull("restoreIntent"));}
        try(ManagedFileStore lost=new ManagedFileStore(f.managed,()->{},()->{},()->{throw new java.io.IOException("Lost restore reply");})) {
            assertThrows(Exception.class,()->lost.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,true));
        }
        JSONObject restored=entry("file"),edit=f.request("file",new byte[]{9},false);edit.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",restored);
        JSONObject edited=f.publish(edit,new byte[]{9}).getJSONObject("entry");
        try(ManagedFileStore s=f.store()) {
            assertTrue(SyncTrash.same(restored,s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,false)));
            assertThrows(Exception.class,()->s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,new JSONObject(target.toString()).put("path","other"),true));
            assertEquals(0,s.trashList(f.fixture.owner,f.root,f.fixture.grant,null).getJSONArray("items").length());
            assertTrue(s.trashInspect(f.fixture.owner,f.root,f.fixture.grant,request).isNull("retainedEntry"));
        }
        trash(request);assertArrayEquals(new byte[]{9},f.read(edited,0,1));
    }
    @Test public void nestedChildrenAndSiblingTransitionsRemoveOnlyThePinnedTree() throws Exception {
        f.folder("top");f.folder("top/nested");f.publish(f.request("top/nested/a",new byte[]{1},false),new byte[]{1});f.publish(f.request("top/nested/b",new byte[]{2},false),new byte[]{2});
        JSONObject top=entry("top"),nested=entry("top/nested");
        JSONObject a=request(f,entry("top/nested/a")).put("parent",parent(nested,null));
        JSONObject b=request(f,entry("top/nested/b")).put("parent",parent(nested,id(a)));
        JSONObject dir=request(f,nested).put("parent",parent(top,null)).put("childrenOperationId",id(b));
        JSONObject outer=request(f,top).put("childrenOperationId",id(dir));
        assertThrows(Exception.class,()->trash(dir));trash(a);trash(b);
        try(ManagedFileStore s=f.store()){JSONObject effective=s.trashExpected(f.fixture.owner,f.root,f.fixture.grant,dir);assertEquals(nested.getString("id"),effective.getString("id"));assertNotEquals(nested.getString("version"),effective.getString("version"));}
        trash(dir);trash(outer);
        try(ManagedFileStore s=f.store()){assertEquals(0,s.scan(f.fixture.owner,f.root).length());assertEquals(4,s.trashList(f.fixture.owner,f.root,f.fixture.grant,null).getJSONArray("items").length());}
        // Empty folders restore first, then children; original IDs and bytes survive.
        for(JSONObject request:new JSONObject[]{outer,dir,a,b}) {
            String path=SyncTrash.mutation(request).getString("path");JSONObject target=restore(request,path);
            try(ManagedFileStore s=f.store()){s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,true);}
        }
        assertArrayEquals(new byte[]{2},f.read(entry("top/nested/b"),0,1));
    }
    @Test public void externalEditsAndForeignTransitionsCannotAdvanceADeletion() throws Exception {
        f.folder("dir");f.publish(f.request("dir/a",new byte[]{1},false),new byte[]{1});f.publish(f.request("dir/b",new byte[]{2},false),new byte[]{2});
        JSONObject directory=entry("dir"),a=request(f,entry("dir/a")).put("parent",parent(directory,null)),b=request(f,entry("dir/b")).put("parent",parent(directory,id(a)));
        trash(a);f.publish(f.request("dir/new",new byte[]{3},false),new byte[]{3});assertThrows(Exception.class,()->trash(b));
        JSONObject foreign=new JSONObject(b.toString());foreign.getJSONObject("scope").put("deviceId","another-pairing");assertThrows(Exception.class,()->trash(foreign));
        JSONObject nonempty=request(f,entry("dir"));assertThrows(Exception.class,()->trash(nonempty));assertArrayEquals(new byte[]{2},f.read(entry("dir/b"),0,1));
    }
    @Test public void restoreRequiresAbsentDestinationExactReviewAndUncorruptedBytes() throws Exception {
        byte[] bytes={7};JSONObject original=f.publish(f.request("file",bytes,false),bytes).getJSONObject("entry"),request=request(f,original);trash(request);
        f.publish(f.request("Occupied",bytes,false),bytes);JSONObject target=restore(request,"recovered");
        try(ManagedFileStore s=f.store()) {
            for(String path:new String[]{"Occupied","occupied","missing/file","../escape"})assertThrows(Exception.class,()->s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,new JSONObject(target.toString()).put("path",path),true));
            JSONObject stale=new JSONObject(target.toString());stale.getJSONObject("expected").put("version","stale");assertThrows(Exception.class,()->s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,stale,true));
        }
        for(File blob:new File(f.managed,"blobs").listFiles())java.nio.file.Files.write(blob.toPath(),new byte[]{8});
        try(ManagedFileStore s=f.store()){assertThrows(Exception.class,()->s.trashInspect(f.fixture.owner,f.root,f.fixture.grant,request));assertThrows(Exception.class,()->s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,true));}
    }
    @Test public void recoveryPagesSpanPriorPairingsButNeverAccountsOrGrants() throws Exception {
        for(int i=0;i<22;i++){JSONObject request=request(f,f.folder("folder-"+i).getJSONObject("entry"));request.getJSONObject("scope").put("deviceId","old-device-"+i).put("rootId","old-configuration-"+i);trash(request);}
        try(ManagedFileStore s=f.store()) {
            JSONObject page=s.trashList(f.fixture.owner,f.root,f.fixture.grant,null);assertEquals(20,page.getJSONArray("items").length());
            JSONObject second=s.trashList(f.fixture.owner,f.root,f.fixture.grant,page.getString("nextCursor"));assertEquals(2,second.getJSONArray("items").length());assertTrue(second.isNull("nextCursor"));
            assertEquals(0,s.trashList(f.fixture.owner,f.root,UUID.randomUUID().toString(),null).getJSONArray("items").length());
            assertThrows(Exception.class,()->s.trashList(new DeviceScope("foreign",f.fixture.owner.origin,false),f.root,f.fixture.grant,null));
            assertThrows(Exception.class,()->s.trashList(f.fixture.owner,f.root,f.fixture.grant,"invalid"));
        }
    }
    @Test public void versionTwoMigrationKeepsExistingFilesAndPublicationReceipts() throws Exception {
        byte[] bytes={1};JSONObject publication=f.request("file",bytes,false),receipt=f.publish(publication,bytes);
        try(SQLiteDatabase db=SQLiteDatabase.openDatabase(new File(f.managed,"catalog.sqlite").getPath(),null,SQLiteDatabase.OPEN_READWRITE)){db.execSQL("DROP TABLE trash_receipts");db.setVersion(2);}
        try(ManagedFileStore s=f.store()){assertTrue(SyncTrash.same(receipt,s.lookup(f.fixture.owner,f.root,f.fixture.grant,publication).getJSONObject("receipt")));assertEquals(1,s.scan(f.fixture.owner,f.root).length());assertEquals(0,s.trashList(f.fixture.owner,f.root,f.fixture.grant,null).getJSONArray("items").length());}
        assertArrayEquals(bytes,f.read(receipt.getJSONObject("entry"),0,1));trash(request(f,receipt.getJSONObject("entry")));
    }
}
