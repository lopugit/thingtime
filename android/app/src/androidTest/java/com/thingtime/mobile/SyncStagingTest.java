package com.thingtime.mobile;

import android.system.Os;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Real Android no-backup files, kernel locks, fsync, links and atomic records.
 * Every fixture is private to this test; selected folders are never touched. */
public class SyncStagingTest {
    File directory;DeviceScope owner;String grant;
    @Before public void before() throws Exception {
        directory=Files.createTempDirectory(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir().toPath(),"stage-test-").toFile();
        owner=new DeviceScope("stage-account","https://staging.test",false);grant=UUID.randomUUID().toString();
    }
    @After public void after() throws Exception {
        try(java.util.stream.Stream<java.nio.file.Path> paths=Files.walk(directory.toPath())) {
            for(java.nio.file.Path path:paths.sorted(java.util.Comparator.reverseOrder()).toArray(java.nio.file.Path[]::new))Files.delete(path);
        }
    }
    SyncStaging store() { return new SyncStaging(directory,()->{},()->{}); }
    static String sha(byte[] bytes) throws Exception { return FolderReader.hex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    JSONObject request(byte[] bytes,boolean multipart) throws Exception {
        JSONObject source=new JSONObject().put("path","nested/file.bin").put("id","remote-file").put("version","remote-v1").put("kind","file").put("size",bytes.length).put("sha256",JSONObject.NULL);
        if(multipart) {
            MessageDigest composite=MessageDigest.getInstance("SHA-256");int partSize=8*1024*1024;
            for(int at=0;at<bytes.length;at+=partSize)composite.update(MessageDigest.getInstance("SHA-256").digest(Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+partSize))));
            source.put("fingerprint",new JSONObject().put("algorithm","sha256-parts-v1").put("partSizeBytes",partSize)
                .put("partCount",(bytes.length+partSize-1)/partSize).put("sha256",FolderReader.hex(composite.digest())));
        } else source.put("sha256",sha(bytes));
        return new JSONObject().put("rootId",grant).put("scope",new JSONObject().put("origin",owner.origin).put("ownerId",owner.owner)
            .put("dataPlane","home").put("rootId","editable-sync-configuration").put("deviceId","paired-device"))
            .put("operation",new JSONObject().put("id",UUID.randomUUID().toString()).put("confirmed",false)
                .put("mutation",new JSONObject().put("kind","copy").put("from","remote").put("path","nested/file.bin").put("source",source)));
    }
    JSONObject source(JSONObject request) throws Exception { return request.getJSONObject("operation").getJSONObject("mutation").getJSONObject("source"); }
    File folder(JSONObject request) throws Exception { return new File(directory,SyncStaging.key(SyncStaging.request(request,owner,grant))); }
    File payload(JSONObject request) throws Exception { return new File(folder(request),"payload"); }
    void append(JSONObject request,byte[] bytes) throws Exception {
        for(int at=0;at<bytes.length;at+=FolderReader.MAX_READ)store().append(request,owner,grant,at,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+FolderReader.MAX_READ)));
    }
    @Test public void resumesReplayedChunksAndReturnsTheSameVerifiedStage() throws Exception {
        byte[] bytes=new byte[FolderReader.MAX_READ+17];Arrays.fill(bytes,(byte)13);JSONObject request=request(bytes,false);
        assertEquals(0,store().begin(request,owner,grant).getLong("received"));
        byte[] first=Arrays.copyOf(bytes,FolderReader.MAX_READ);
        assertEquals(first.length,store().append(request,owner,grant,0,first).getLong("received"));
        assertEquals(first.length,store().begin(request,owner,grant).getLong("received"));
        assertEquals(first.length,store().append(request,owner,grant,0,first).getLong("received"));
        assertThrows(Exception.class,()->store().finish(request,owner,grant));
        store().append(request,owner,grant,first.length,Arrays.copyOfRange(bytes,first.length,bytes.length));
        JSONObject stage=store().finish(request,owner,grant).getJSONObject("stage");
        assertEquals(sha(bytes),stage.getJSONObject("entry").getString("sha256"));
        assertEquals(request.getJSONObject("operation").getString("id"),stage.getString("operationId"));
        assertEquals(SyncStaging.canonical(stage),SyncStaging.canonical(store().begin(request,owner,grant).getJSONObject("stage")));
        assertEquals(SyncStaging.canonical(stage),SyncStaging.canonical(store().finish(request,owner,grant).getJSONObject("stage")));
        assertArrayEquals(bytes,Files.readAllBytes(payload(request).toPath()));
    }
    @Test public void multipartMatchesCanonicalRawPartDigestsIncludingTheShortTail() throws Exception {
        byte[] bytes=new byte[8*1024*1024+17];Arrays.fill(bytes,(byte)13);JSONObject request=request(bytes,true);
        // Known cross-platform vector: SHA-256 of concatenated binary part digests.
        assertEquals("65985fd373c72ba706db521887d1a927724d5f3c636214425adffebcbfa09643",source(request).getJSONObject("fingerprint").getString("sha256"));
        store().begin(request,owner,grant);append(request,bytes);
        assertEquals(SyncStaging.canonical(source(request).getJSONObject("fingerprint")),
            SyncStaging.canonical(store().finish(request,owner,grant).getJSONObject("stage").getJSONObject("entry").getJSONObject("fingerprint")));
    }
    @Test public void interruptionAfterPayloadFsyncResumesOnlyAcknowledgedBytes() throws Exception {
        byte[] bytes={1,2,3,4};JSONObject request=request(bytes,false);store().begin(request,owner,grant);
        store().append(request,owner,grant,0,new byte[]{1,2});
        SyncStaging interrupted=new SyncStaging(directory,()->{},()->{throw new java.io.IOException("Simulated interruption after durable bytes");});
        assertThrows(Exception.class,()->interrupted.append(request,owner,grant,2,new byte[]{3,4}));
        assertEquals(4,payload(request).length());
        assertEquals(2,store().begin(request,owner,grant).getLong("received"));assertEquals(2,payload(request).length());
        store().append(request,owner,grant,2,new byte[]{3,4});assertNotNull(store().finish(request,owner,grant).getJSONObject("stage"));
    }
    @Test public void gapsOverlappingDifferentReplaysAndOversizedChunksCannotAdvance() throws Exception {
        JSONObject request=request(new byte[FolderReader.MAX_READ+8],false);store().begin(request,owner,grant);
        assertThrows(Exception.class,()->store().append(request,owner,grant,1,new byte[]{0}));
        assertThrows(Exception.class,()->store().append(request,owner,grant,0,new byte[FolderReader.MAX_READ+1]));
        assertThrows(Exception.class,()->store().append(request,owner,grant,0,new byte[0]));
        store().append(request,owner,grant,0,new byte[]{0,0});
        assertThrows(Exception.class,()->store().append(request,owner,grant,0,new byte[]{1,1}));
        assertThrows(Exception.class,()->store().append(request,owner,grant,1,new byte[]{0,0}));
        assertEquals(2,store().begin(request,owner,grant).getLong("received"));
    }
    @Test public void operationReuseCannotChangeTheRemoteSourceOrExpectedTarget() throws Exception {
        JSONObject request=request(new byte[]{1,2,3},false);store().begin(request,owner,grant);
        JSONObject changed=new JSONObject(request.toString());source(changed).put("version","remote-v2");
        assertThrows(Exception.class,()->store().begin(changed,owner,grant));
        JSONObject expected=new JSONObject(request.toString());expected.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",source(expected));
        assertThrows(Exception.class,()->store().begin(expected,owner,grant));
        assertEquals(0,store().begin(request,owner,grant).getLong("received"));
    }
    @Test public void ownerOriginGrantDeviceAndConfigurationStayIsolated() throws Exception {
        JSONObject request=request(new byte[]{1},false);store().begin(request,owner,grant);store().append(request,owner,grant,0,new byte[]{1});
        assertThrows(Exception.class,()->store().begin(request,new DeviceScope("another",owner.origin,false),grant));
        assertThrows(Exception.class,()->store().begin(request,new DeviceScope(owner.owner,"https://other.test",false),grant));
        assertThrows(Exception.class,()->store().begin(request,owner,UUID.randomUUID().toString()));
        for(String field:new String[]{"deviceId","rootId"}) {
            JSONObject other=new JSONObject(request.toString());other.getJSONObject("scope").put(field,"another-binding");
            assertEquals(0,store().begin(other,owner,grant).getLong("received"));
        }
        assertEquals(1,store().begin(request,owner,grant).getLong("received"));
    }
    @Test public void sameLengthEditsTruncationAndForgedStagesFailClosed() throws Exception {
        JSONObject request=request(new byte[]{1,2,3},false);store().begin(request,owner,grant);append(request,new byte[]{1,2,3});
        store().finish(request,owner,grant);Files.write(payload(request).toPath(),new byte[]{4,5,6});
        assertThrows(Exception.class,()->store().begin(request,owner,grant));assertThrows(Exception.class,()->store().finish(request,owner,grant));
        Files.write(payload(request).toPath(),new byte[]{1});assertThrows(Exception.class,()->store().begin(request,owner,grant));
        JSONObject second=request(new byte[]{7},false);store().begin(second,owner,grant);append(second,new byte[]{7});store().finish(second,owner,grant);
        File record=new File(folder(second),"record.json");JSONObject row=new JSONObject(new String(Files.readAllBytes(record.toPath()),java.nio.charset.StandardCharsets.UTF_8));
        row.getJSONObject("stage").put("token","forged");Files.write(record.toPath(),row.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThrows(Exception.class,()->store().begin(second,owner,grant));
    }
    @Test public void symlinksAndNonregularPayloadsCannotEscapePrivateStorage() throws Exception {
        File outside=new File(directory,"outside");Files.write(outside.toPath(),new byte[]{8,9});
        for(String type:new String[]{"symlink","directory","fifo"}) {
            JSONObject request=request(new byte[]{1,2},false);store().begin(request,owner,grant);File payload=payload(request);assertTrue(payload.delete());
            if(type.equals("symlink"))Os.symlink(outside.getPath(),payload.getPath());
            else if(type.equals("directory"))assertTrue(payload.mkdir());
            else Os.mkfifo(payload.getPath(),0600);
            assertThrows(Exception.class,()->store().begin(request,owner,grant));assertArrayEquals(new byte[]{8,9},Files.readAllBytes(outside.toPath()));
        }
        JSONObject request=request(new byte[0],false);File folder=folder(request);Os.symlink(directory.getPath(),folder.getPath());
        assertThrows(Exception.class,()->store().begin(request,owner,grant));
    }
    @Test public void hardlinksAreRejectedByThePlatformOrByStaging() throws Exception {
        File outside=new File(directory,"outside");Files.write(outside.toPath(),new byte[]{8,9});
        JSONObject request=request(new byte[]{1,2},false);store().begin(request,owner,grant);File payload=payload(request);assertTrue(payload.delete());
        try { Os.link(outside.getPath(),payload.getPath()); }
        catch(android.system.ErrnoException denied) {
            if(denied.errno!=android.system.OsConstants.EACCES && denied.errno!=android.system.OsConstants.EPERM)throw denied;
            assertFalse(payload.exists());assertArrayEquals(new byte[]{8,9},Files.readAllBytes(outside.toPath()));return;
        }
        assertThrows(Exception.class,()->store().begin(request,owner,grant));assertArrayEquals(new byte[]{8,9},Files.readAllBytes(outside.toPath()));
    }
    @Test public void emptyFilesAndFoldersVerifyButPopulatedFolderStagesDoNot() throws Exception {
        JSONObject file=request(new byte[0],false);store().begin(file,owner,grant);
        assertEquals(sha(new byte[0]),store().finish(file,owner,grant).getJSONObject("stage").getJSONObject("entry").getString("sha256"));
        JSONObject folder=request(new byte[0],false);source(folder).put("kind","folder").remove("sha256");store().begin(folder,owner,grant);
        JSONObject folderEntry=store().finish(folder,owner,grant).getJSONObject("stage").getJSONObject("entry");
        assertEquals("folder",folderEntry.getString("kind"));assertTrue(folderEntry.has("sha256"));assertTrue(folderEntry.isNull("sha256"));
        Files.write(new File(payload(folder),"unexpected").toPath(),new byte[]{1});assertThrows(Exception.class,()->store().finish(folder,owner,grant));
    }
    @Test public void cancelledLockWaitDoesNotInterruptTheOtherWriter() throws Exception {
        JSONObject request=request(new byte[]{1,2},false);store().begin(request,owner,grant);
        CountDownLatch flushed=new CountDownLatch(1),release=new CountDownLatch(1),blocked=new CountDownLatch(1);AtomicBoolean cancelled=new AtomicBoolean();ExecutorService workers=Executors.newFixedThreadPool(2);
        try {
            Future<?> first=workers.submit(()-> { try { new SyncStaging(directory,()->{},()->{flushed.countDown();if(!release.await(10,TimeUnit.SECONDS))throw new Exception("Timed out");}).append(request,owner,grant,0,new byte[]{1}); }catch(Exception e){throw new RuntimeException(e);} });
            assertTrue(flushed.await(10,TimeUnit.SECONDS));
            java.util.concurrent.atomic.AtomicInteger checks=new java.util.concurrent.atomic.AtomicInteger();
            Future<?> waiting=workers.submit(()-> { try { new SyncStaging(directory,()->{if(checks.incrementAndGet()>=3)blocked.countDown();if(cancelled.get())throw new CancellationException();},()->{}).begin(request,owner,grant);fail("Expected cancellation"); }catch(CancellationException expected){}catch(Exception e){throw new RuntimeException(e);} });
            assertTrue(blocked.await(10,TimeUnit.SECONDS));assertEquals(1,openPrivateDescriptors("lock"));
            cancelled.set(true);waiting.get(10,TimeUnit.SECONDS);assertEquals(1,openPrivateDescriptors("lock"));
            release.countDown();first.get(10,TimeUnit.SECONDS);
            assertEquals(1,store().begin(request,owner,grant).getLong("received"));store().append(request,owner,grant,1,new byte[]{2});store().finish(request,owner,grant);
        } finally { release.countDown();workers.shutdownNow(); }
    }
    @Test public void malformedCheckpointAndOrphanInitialCheckpointCannotInventProgress() throws Exception {
        JSONObject request=request(new byte[]{1},false);File folder=folder(request);assertTrue(folder.mkdir());
        Files.write(new File(folder,"checkpoint-"+UUID.randomUUID()).toPath(),new byte[]{1,2,3});
        assertEquals(0,store().begin(request,owner,grant).getLong("received"));
        Files.write(new File(folder,"record.json").toPath(),new byte[65537]);assertThrows(Exception.class,()->store().begin(request,owner,grant));
    }
    @Test public void repeatedCallsCloseAllPrivateDescriptors() throws Exception {
        JSONObject request=request(new byte[]{1,2,3},false);store().begin(request,owner,grant);append(request,new byte[]{1,2,3});store().finish(request,owner,grant);
        for(int i=0;i<40;i++)store().begin(request,owner,grant);
        assertEquals(0,openPrivateDescriptors(null));
    }
    private int openPrivateDescriptors(String name) throws Exception {
        int count=0;String[] descriptors=new File("/proc/self/fd").list();assertNotNull(descriptors);
        for(String descriptor:descriptors) {
            String target;
            try { target=Os.readlink("/proc/self/fd/"+descriptor); }
            catch(android.system.ErrnoException gone) { if(gone.errno==android.system.OsConstants.ENOENT)continue;throw gone; }
            if(target.contains("/"+directory.getName()+"/") && (name==null || target.endsWith("/"+name)))count++;
        }
        return count;
    }

    @Test public void verifiedPayloadRejectsMutationDuringNativeCopy() throws Exception {
        byte[] bytes={1,2,3};JSONObject request=request(bytes,false);store().begin(request,owner,grant);append(request,bytes);
        JSONObject stage=store().finish(request,owner,grant).getJSONObject("stage");
        assertThrows(Exception.class,()->store().withVerifiedPayload(request,owner,grant,stage,(fd,source)-> {
            byte[] read=new byte[3];assertEquals(3,Os.pread(fd,read,0,3,0));assertArrayEquals(bytes,read);
            assertThrows(android.system.ErrnoException.class,()->Os.pwrite(fd,new byte[]{9},0,1,0));
            Files.write(payload(request).toPath(),new byte[]{3,2,1});
            return new JSONObject().put("copied",true);
        }));
    }
}
