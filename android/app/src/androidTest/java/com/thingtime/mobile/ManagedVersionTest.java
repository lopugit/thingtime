package com.thingtime.mobile;

import android.database.sqlite.SQLiteDatabase;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.File;
import java.util.UUID;

/** Real retained publication bytes, SQLite migration and restart-safe copy restore. */
public class ManagedVersionTest {
    ManagedFileStoreTest f;
    @Before public void before() throws Exception {f=new ManagedFileStoreTest();f.before();}
    @After public void after() throws Exception {f.after();}
    JSONObject replace(String path,byte[] original,byte[] replacement) throws Exception {
        JSONObject entry=f.publish(f.request(path,original,false),original).getJSONObject("entry");
        JSONObject request=f.request(path,replacement,false);request.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",entry);
        f.publish(request,replacement);return entry;
    }
    JSONObject page(String cursor) throws Exception {try(ManagedFileStore s=f.store()){return s.versionList(f.fixture.owner,f.root,f.fixture.grant,cursor);}}
    JSONObject first() throws Exception {return page(null).getJSONArray("items").getJSONObject(0);}
    JSONObject restore(JSONObject version,String path) throws Exception {
        return new JSONObject().put("versionId",version.getString("versionId")).put("operationId",UUID.randomUUID().toString()).put("path",path).put("expected",version.getJSONObject("entry"));
    }
    @Test public void copyRestorationPreservesCurrentBytesAndRetainedVersion() throws Exception {
        byte[] old={1,2,3},current={4,5};JSONObject original=replace("file",old,current),version=first(),request=restore(version,"old-copy"),restored;
        assertTrue(version.getLong("capturedAt")>0);
        try(ManagedFileStore s=f.store()) {
            assertTrue(SyncTrash.same(original,s.versionInspect(f.fixture.owner,f.root,f.fixture.grant,version.getString("versionId"))));
            assertNull(s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,false));
            s.reviewVersionRestore(f.fixture.owner,f.root,f.fixture.grant,request);
            restored=s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,true);
            assertNotEquals(original.getString("id"),restored.getString("id"));
            assertEquals(1,s.versionList(f.fixture.owner,f.root,f.fixture.grant,null).getJSONArray("items").length());
            assertTrue(SyncTrash.same(restored,s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,false)));
            JSONObject another=restore(version,"second-copy");assertNotEquals(restored.getString("id"),s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,another,true).getString("id"));
        }
        assertArrayEquals(old,f.read(restored,0,old.length));
        try(ManagedFileStore s=f.store()){JSONArray entries=s.scan(f.fixture.owner,f.root);for(int i=0;i<entries.length();i++){JSONObject e=entries.getJSONObject(i);if(e.getString("path").equals("file"))assertArrayEquals(current,f.read(e,0,current.length));}}
    }
    @Test public void lostReplyAndRollbackPreserveOneReceiptWithoutOverwritingLaterChanges() throws Exception {
        replace("file",new byte[]{1},new byte[]{2});JSONObject request=restore(first(),"copy");
        try(ManagedFileStore fail=new ManagedFileStore(f.managed,()->{},()->{throw new java.io.IOException("before commit");},()->{})) {
            assertThrows(Exception.class,()->fail.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,true));
        }
        try(ManagedFileStore s=f.store()){assertNull(s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,false));assertEquals(1,s.scan(f.fixture.owner,f.root).length());}
        try(ManagedFileStore lost=new ManagedFileStore(f.managed,()->{},()->{},()->{throw new java.io.IOException("lost reply");})) {
            assertThrows(Exception.class,()->lost.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,true));
        }
        JSONObject restored;
        try(ManagedFileStore s=f.store()){restored=s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,false);assertEquals(2,s.scan(f.fixture.owner,f.root).length());}
        JSONObject edit=f.request("copy",new byte[]{3},false);edit.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",restored);JSONObject edited=f.publish(edit,new byte[]{3}).getJSONObject("entry");
        try(ManagedFileStore s=f.store()) {
            assertTrue(SyncTrash.same(restored,s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,true)));
            assertThrows(Exception.class,()->s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,new JSONObject(request.toString()).put("path","changed"),true));
        }
        assertArrayEquals(new byte[]{3},f.read(edited,0,1));
    }
    @Test public void occupiedAliasesMissingParentsWrongReviewAndForeignScopesAreRefused() throws Exception {
        replace("File",new byte[]{1},new byte[]{2});JSONObject version=first(),request=restore(version,"copy");
        try(ManagedFileStore s=f.store()) {
            for(String path:new String[]{"File","file","missing/child","../escape"})assertThrows(Exception.class,()->s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,new JSONObject(request.toString()).put("path",path),true));
            JSONObject wrong=new JSONObject(request.toString());wrong.getJSONObject("expected").put("version","wrong");assertThrows(Exception.class,()->s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,wrong,true));
            String foreign=UUID.randomUUID().toString();assertEquals(0,s.versionList(f.fixture.owner,f.root,foreign,null).getJSONArray("items").length());
            assertThrows(Exception.class,()->s.versionInspect(f.fixture.owner,f.root,foreign,version.getString("versionId")));
            assertThrows(Exception.class,()->s.restoreVersion(f.fixture.owner,f.root,foreign,request,true));
            assertThrows(Exception.class,()->s.versionList(new DeviceScope("foreign",f.fixture.owner.origin,false),f.root,f.fixture.grant,null));
            assertThrows(Exception.class,()->s.versionList(new DeviceScope(f.fixture.owner.owner,"https://other.test",false),f.root,f.fixture.grant,null));
        }
    }
    @Test public void pagesAreBoundedAndCorruptBytesNeverRestore() throws Exception {
        for(int i=0;i<22;i++)replace("file-"+i,new byte[]{1},new byte[]{2});
        JSONObject page=page(null),request=restore(page.getJSONArray("items").getJSONObject(0),"copy");assertEquals(20,page.getJSONArray("items").length());
        JSONObject last=page(page.getString("nextCursor"));assertEquals(2,last.getJSONArray("items").length());assertTrue(last.isNull("nextCursor"));
        for(File file:new File(f.managed,"blobs").listFiles())java.nio.file.Files.write(file.toPath(),new byte[]{9});
        try(ManagedFileStore s=f.store()) {
            assertThrows(Exception.class,()->s.versionInspect(f.fixture.owner,f.root,f.fixture.grant,request.getString("versionId")));
            assertThrows(Exception.class,()->s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,true));
        }
    }
    static void legacyRetained(SQLiteDatabase db) {
        db.execSQL("ALTER TABLE retained RENAME TO retained_new");
        db.execSQL("CREATE TABLE retained (id TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES roots(id), operation TEXT NOT NULL, entry TEXT NOT NULL, blob TEXT NOT NULL)");
        db.execSQL("INSERT INTO retained SELECT id,root,operation,entry,blob FROM retained_new");db.execSQL("DROP TABLE retained_new");
        db.execSQL("DROP TABLE version_restores");
    }
    @Test public void versionThreeMigrationRecoversGrantWithoutInventingHistoricalTimes() throws Exception {
        replace("file",new byte[]{7},new byte[]{8});String id=first().getString("versionId");
        try(SQLiteDatabase db=SQLiteDatabase.openDatabase(new File(f.managed,"catalog.sqlite").getPath(),null,SQLiteDatabase.OPEN_READWRITE)){legacyRetained(db);db.setVersion(3);}
        JSONObject version=first();assertEquals(id,version.getString("versionId"));assertTrue(version.isNull("capturedAt"));
        JSONObject request=restore(version,"copy"),restored;
        try(ManagedFileStore s=f.store()){restored=s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,true);}
        assertArrayEquals(new byte[]{7},f.read(restored,0,1));
    }
    @Test public void grantRevocationAtCommitRollsBackCopyAndReceipt() throws Exception {
        ManagedFolderAccessTest access=new ManagedFolderAccessTest();access.before();
        try {
            ManagedFileStoreTest saved=f;f=access.fixture;
            try {
                replace("file",new byte[]{1},new byte[]{2});JSONObject request=restore(first(),"copy");
                try(ManagedFileStore guarded=new ManagedFileStore(f.managed,()->{},()->{access.permissions.read.clear();access.registry.requireRead(access.owner,access.grant);},()->{})) {
                    assertThrows(Exception.class,()->guarded.restoreVersion(access.owner,access.fixture.root,access.grant.id,request,true));
                }
                assertThrows(Exception.class,()->access.access.restoreVersion(access.owner,access.grant,request,true));
                try(ManagedFileStore s=f.store()){assertNull(s.restoreVersion(f.fixture.owner,f.root,f.fixture.grant,request,false));assertEquals(1,s.scan(f.fixture.owner,f.root).length());}
            } finally {f=saved;}
        } finally {access.after();}
    }
}
