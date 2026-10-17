package com.thingtime.mobile;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.system.Os;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.*;

/** Real SQLite transactions and app-private durable blobs, using production
 * staging and publication. No provider, web capability or user grant is added. */
public class ManagedFileStoreTest {
    File directory,managed;SyncStagingTest fixture;String root;
    @Before public void before() throws Exception {
        directory=Files.createTempDirectory(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir().toPath(),"managed-test-").toFile();
        managed=new File(directory,"managed");fixture=new SyncStagingTest();fixture.directory=new File(directory,"staging");
        fixture.owner=new DeviceScope("managed-account","https://managed.test",false);fixture.grant=UUID.randomUUID().toString();
        try(ManagedFileStore store=store()){root=store.createRoot(fixture.owner,"Offline");}
    }
    @After public void after() throws Exception {
        try(java.util.stream.Stream<java.nio.file.Path> paths=Files.walk(directory.toPath())) {
            for(java.nio.file.Path p:paths.sorted(java.util.Comparator.reverseOrder()).toArray(java.nio.file.Path[]::new))Files.delete(p);
        }
    }
    ManagedFileStore store() throws Exception {return new ManagedFileStore(managed,()->{},()->{},()->{});}
    JSONObject request(String path,byte[] bytes,boolean multipart) throws Exception {
        JSONObject request=fixture.request(bytes,multipart),mutation=request.getJSONObject("operation").getJSONObject("mutation");
        mutation.put("path",path);mutation.getJSONObject("source").put("path",path);return request;
    }
    JSONObject stage(JSONObject request,byte[] bytes) throws Exception {
        fixture.store().begin(request,fixture.owner,fixture.grant);
        if(bytes.length>0)fixture.append(request,bytes);
        return fixture.store().finish(request,fixture.owner,fixture.grant).getJSONObject("stage");
    }
    JSONObject publish(JSONObject request,byte[] bytes) throws Exception {
        JSONObject stage=stage(request,bytes);
        try(ManagedFileStore store=store()){return store.publish(fixture.owner,root,fixture.grant,request,stage,fixture.store());}
    }
    JSONObject folder(String path) throws Exception {
        JSONObject request=request(path,new byte[0],false);fixture.source(request).put("kind","folder").put("size",0).put("sha256",JSONObject.NULL);return publish(request,new byte[0]);
    }
    byte[] read(JSONObject entry,long offset,int length) throws Exception {
        try(ManagedFileStore store=store()) {
            JSONObject chunk=store.read(fixture.owner,root,entry.getString("path"),entry.getString("version"),offset,length);
            assertEquals(entry.getLong("size"),chunk.getLong("size"));return java.util.Base64.getDecoder().decode(chunk.getString("data"));
        }
    }
    @Test public void nestedMultipartContentHasAtomicReceiptAndRepeatableRead() throws Exception {
        JSONObject parent=folder("nested");byte[] bytes=new byte[8*1024*1024+17];Arrays.fill(bytes,(byte)13);
        JSONObject request=request("nested/original.bin",bytes,true),receipt=publish(request,bytes);
        assertArrayEquals(Arrays.copyOfRange(bytes,8*1024*1024,bytes.length),read(receipt.getJSONObject("entry"),8*1024*1024,65536));
        try(ManagedFileStore store=store()) {
            JSONArray entries=store.scan(fixture.owner,root);assertEquals(2,entries.length());
            assertNotEquals(parent.getJSONObject("entry").getString("version"),entries.getJSONObject(0).getString("version"));
            JSONObject replay=store.publish(fixture.owner,root,fixture.grant,request,new JSONObject(),fixture.store());
            assertEquals(SyncStaging.canonical(receipt),SyncStaging.canonical(replay));
            assertEquals(SyncStaging.canonical(receipt),SyncStaging.canonical(store.lookup(fixture.owner,root,fixture.grant,request).getJSONObject("receipt")));
        }
    }
    @Test public void replacementRetainsPriorBytesAndHistoricalReceiptDoesNotOverwriteLaterChanges() throws Exception {
        byte[] original={1,2,3},replacement={4,5,6};JSONObject firstRequest=request("file.bin",original,false),first=publish(firstRequest,original);
        JSONObject secondRequest=request("file.bin",replacement,false);secondRequest.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",first.getJSONObject("entry"));
        JSONObject second=publish(secondRequest,replacement);assertEquals(first.getJSONObject("entry").getString("id"),second.getJSONObject("entry").getString("id"));
        assertArrayEquals(replacement,read(second.getJSONObject("entry"),0,3));
        try(ManagedFileStore store=store()) {
            assertEquals(SyncStaging.canonical(first),SyncStaging.canonical(store.lookup(fixture.owner,root,fixture.grant,firstRequest).getJSONObject("receipt")));
            assertEquals(SyncStaging.canonical(first),SyncStaging.canonical(store.publish(fixture.owner,root,fixture.grant,firstRequest,new JSONObject(),fixture.store())));
            assertThrows(Exception.class,()->store.read(fixture.owner,root,"file.bin",first.getJSONObject("entry").getString("version"),0,3));
        }
        try(SQLiteDatabase db=SQLiteDatabase.openDatabase(new File(managed,"catalog.sqlite").getPath(),null,SQLiteDatabase.OPEN_READONLY);
            Cursor retained=db.rawQuery("SELECT entry,blob FROM retained",null)) {
            assertTrue(retained.moveToFirst());assertEquals(SyncStaging.canonical(first.getJSONObject("entry")),retained.getString(0));
            assertArrayEquals(original,Files.readAllBytes(new File(new File(managed,"blobs"),retained.getString(1)).toPath()));assertFalse(retained.moveToNext());
        }
        assertArrayEquals(replacement,read(second.getJSONObject("entry"),0,3));
    }
    @Test public void transactionFailureAndLostResponseRecoverWithoutPartialVisibleEntries() throws Exception {
        byte[] bytes={1,2,3};JSONObject request=request("file.bin",bytes,false),stage=stage(request,bytes);
        try(ManagedFileStore fail=new ManagedFileStore(managed,()->{},()->{throw new java.io.IOException("Before commit");},()->{})) {
            assertThrows(Exception.class,()->fail.publish(fixture.owner,root,fixture.grant,request,stage,fixture.store()));
        }
        try(ManagedFileStore store=store()){assertEquals(0,store.scan(fixture.owner,root).length());assertEquals("missing",store.lookup(fixture.owner,root,fixture.grant,request).getString("status"));}
        try(ManagedFileStore lost=new ManagedFileStore(managed,()->{},()->{},()->{throw new java.io.IOException("Lost response after commit");})) {
            assertThrows(Exception.class,()->lost.publish(fixture.owner,root,fixture.grant,request,stage,fixture.store()));
        }
        try(ManagedFileStore store=store()) {
            JSONObject completed=store.lookup(fixture.owner,root,fixture.grant,request).getJSONObject("receipt");assertEquals(1,store.scan(fixture.owner,root).length());
            assertArrayEquals(bytes,read(completed.getJSONObject("entry"),0,3));
            assertEquals(SyncStaging.canonical(completed),SyncStaging.canonical(store.publish(fixture.owner,root,fixture.grant,request,stage,fixture.store())));
        }
    }
    @Test public void staleTargetsAliasesAndMissingParentsCannotPublish() throws Exception {
        byte[] bytes={7};JSONObject first=publish(request("File.bin",bytes,false),bytes);
        JSONObject duplicate=request("File.bin",bytes,false),alias=request("file.bin",bytes,false),orphan=request("missing/file",bytes,false);
        for(JSONObject request:new JSONObject[]{duplicate,alias,orphan})assertThrows(Exception.class,()->publish(request,bytes));
        JSONObject stale=request("File.bin",new byte[]{8},false);stale.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",new JSONObject(first.getJSONObject("entry").toString()).put("version","stale"));
        assertThrows(Exception.class,()->publish(stale,new byte[]{8}));assertArrayEquals(bytes,read(first.getJSONObject("entry"),0,1));
        try(ManagedFileStore store=store()){assertEquals(1,store.scan(fixture.owner,root).length());}
    }
    @Test public void accountOriginRootOperationAndStageStayBound() throws Exception {
        byte[] bytes={1};JSONObject request=request("file.bin",bytes,false),stage=stage(request,bytes);
        try(ManagedFileStore store=store()) {
            DeviceScope other=new DeviceScope("other",fixture.owner.origin,false),otherSite=new DeviceScope(fixture.owner.owner,"https://other.test",false);
            assertThrows(Exception.class,()->store.scan(other,root));assertThrows(Exception.class,()->store.scan(otherSite,root));
            assertThrows(Exception.class,()->store.publish(other,root,fixture.grant,request,stage,fixture.store()));
            assertThrows(Exception.class,()->store.publish(fixture.owner,root,fixture.grant,request,new JSONObject(stage.toString()).put("token","forged"),fixture.store()));
            store.publish(fixture.owner,root,fixture.grant,request,stage,fixture.store());
            JSONObject altered=new JSONObject(request.toString());altered.getJSONObject("operation").getJSONObject("mutation").getJSONObject("source").put("version","different");
            assertThrows(Exception.class,()->store.lookup(fixture.owner,root,fixture.grant,altered));
            String second=store.createRoot(fixture.owner,"Second");assertThrows(Exception.class,()->store.lookup(fixture.owner,second,fixture.grant,request));
        }
    }
    @Test public void changedStageAndCorruptOrSymlinkedBlobsCannotPassVerification() throws Exception {
        byte[] bytes={1,2,3};JSONObject request=request("file.bin",bytes,false),stage=stage(request,bytes);
        Files.write(fixture.payload(request).toPath(),new byte[]{3,2,1});
        try(ManagedFileStore store=store()){assertThrows(Exception.class,()->store.publish(fixture.owner,root,fixture.grant,request,stage,fixture.store()));assertEquals(0,store.scan(fixture.owner,root).length());}
        JSONObject good=publish(request("other.bin",bytes,false),bytes);File[] blobs=new File(managed,"blobs").listFiles();assertNotNull(blobs);assertEquals(1,blobs.length);
        Files.write(blobs[0].toPath(),new byte[]{3,2,1});assertThrows(Exception.class,()->read(good.getJSONObject("entry"),0,3));
        JSONObject replacement=request("other.bin",new byte[]{4,5,6},false);
        replacement.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",good.getJSONObject("entry"));
        assertThrows(Exception.class,()->publish(replacement,new byte[]{4,5,6}));
        try(ManagedFileStore store=store()){assertThrows(Exception.class,()->store.scan(fixture.owner,root));}
        Files.delete(blobs[0].toPath());Os.symlink(fixture.payload(request).getPath(),blobs[0].getPath());assertThrows(Exception.class,()->read(good.getJSONObject("entry"),0,3));
    }
    @Test public void twoConcurrentCreatesHaveOneWinnerAndOneReceipt() throws Exception {
        byte[] bytes={9};JSONObject one=request("file.bin",bytes,false),two=request("file.bin",bytes,false),a=stage(one,bytes),b=stage(two,bytes);
        ExecutorService workers=Executors.newFixedThreadPool(2);CountDownLatch ready=new CountDownLatch(2),go=new CountDownLatch(1);
        java.util.List<Future<Boolean>> results=new java.util.ArrayList<>();
        try {
            for(JSONObject[] pair:new JSONObject[][]{{one,a},{two,b}})results.add(workers.submit(()-> {
                try(ManagedFileStore store=store()){ready.countDown();assertTrue(go.await(10,TimeUnit.SECONDS));try{store.publish(fixture.owner,root,fixture.grant,pair[0],pair[1],fixture.store());return true;}catch(FolderReader.Failure conflict){return false;}}
            }));
            assertTrue(ready.await(10,TimeUnit.SECONDS));go.countDown();int wins=0;for(Future<Boolean> result:results)if(result.get(20,TimeUnit.SECONDS))wins++;assertEquals(1,wins);
            try(ManagedFileStore store=store()){assertEquals(1,store.scan(fixture.owner,root).length());String x=store.lookup(fixture.owner,root,fixture.grant,one).getString("status"),y=store.lookup(fixture.owner,root,fixture.grant,two).getString("status");assertNotEquals(x,y);}
        } finally {workers.shutdownNow();}
    }
    @Test public void binaryReadRangeVerifiesFullContentAndRejectsStaleVersions() throws Exception {
        byte[] bytes=new byte[2*1024*1024+17];new java.util.Random(31).nextBytes(bytes);
        JSONObject entry=publish(request("binary.bin",bytes,true),bytes).getJSONObject("entry");
        try(ManagedFileStore store=store()) {
            FolderReader.Range range=store.readRange(fixture.owner,root,"binary.bin",entry.getString("version"),3,bytes.length-3);
            assertArrayEquals(java.util.Arrays.copyOfRange(bytes,3,bytes.length),range.bytes);
            assertFalse(range.metadata().has("data"));
            assertThrows(Exception.class,()->store.readRange(fixture.owner,root,"binary.bin","changed",0,1));
            assertThrows(Exception.class,()->store.readRange(fixture.owner,root,"binary.bin",entry.getString("version"),bytes.length-1,2));
        }
    }

}
