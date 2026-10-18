package com.thingtime.mobile;

import android.os.Process;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Opt-in two-process acceptance with synthetic bytes and transport. The second
 * invocation must follow force-stop; it proves disk recovery, not OS scheduling. */
public class NativeUploadRecoveryTest {
    @Test public void recoverNativeUploadAcrossProcessRestart() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("nativeUploadRecovery","");
        assumeTrue(phase.equals("capture")||phase.equals("recover"));
        Path root=InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir().toPath().resolve("UploadRecoveryAcceptance-v1");
        Memory memory=new Memory();FolderReader reader=new FolderReader(memory,()->{});JSONObject source=reader.scan().getJSONObject(0);memory.readBytes=0;
        DeviceScope owner=new DeviceScope("native-upload-recovery-fixture","https://recovery.test",false);
        String rootId="11111111-1111-4111-8111-111111111111";
        JSONObject config=new JSONObject().put("configurationVersion",1).put("name","Recovery fixture").put("deviceId","device")
            .put("localRootId",rootId).put("remoteFolderId","folder").put("mode","upload").put("paused",false).put("propagateDeletes",false)
            .put("network","wifi").put("chargingOnly",false).put("excludedPaths",new JSONArray());
        JSONObject scope=new JSONObject().put("ownerId",owner.owner).put("origin",owner.origin).put("deviceId","device").put("rootId","connection").put("dataPlane","home");
        NativeUploadRequest request=new NativeUploadRequest(new JSONObject().put("source",source).put("uploadId","recovery-upload").put("requestId","recovery-operation")
            .put("authorization",new JSONObject().put("id","connection").put("updatedAt","2026-10-18T00:00:00.000Z").put("scope",scope).put("configuration",config)),owner,rootId,false);
        NativeUploadPartStore.Binding binding=new NativeUploadPartStore.Binding(owner,rootId,"a".repeat(64));
        final int[] puts={0},completions={0};
        NativeUploadJob.Transport cloud=new NativeUploadJob.Transport() {
            public JSONObject json(String path,JSONObject body) throws Exception {
                if(path.equals("/api/v1/attachments/uploads")) {
                    assertEquals("recovery-operation",body.getString("requestId"));
                    return new JSONObject().put("ok",true).put("upload",new JSONObject().put("id","recovery-upload").put("partSizeBytes",request.partSize).put("partCount",2).put("state","uploading"));
                }
                assertEquals("recovery-upload",body.getString("uploadId"));
                if(path.endsWith("/complete"))completions[0]++;
                return new JSONObject().put("ok",true);
            }
            public void put(JSONObject signed,Path file,String checksum,long length,int number) throws Exception {
                byte[] actual=Files.readAllBytes(file);
                assertEquals(length,actual.length);assertArrayEquals(Arrays.copyOfRange(memory.bytes,(int)request.offset(number),(int)(request.offset(number)+length)),actual);
                assertEquals(checksum,Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(actual)));puts[0]++;
                if(phase.equals("capture"))throw new IOException("Simulated lost PUT reply");
            }
        };
        if(phase.equals("capture")) {
            assertFalse("Do not overwrite a prior recovery fixture",Files.exists(root,LinkOption.NOFOLLOW_LINKS));Files.createDirectory(root);
            try(NativeUploadJob job=new NativeUploadJob(root.resolve("parts"),binding,()->{})) {
                assertThrows(IOException.class,()->job.run(request,reader.uploadSource(source),cloud,()->{},n->{}));
            }
            assertEquals(1,puts[0]);assertEquals(0,completions[0]);
            Path receipt=root.resolve("captured.json");
            try(FileOutputStream output=new FileOutputStream(receipt.toFile())) {
                output.write(new JSONObject().put("pid",Process.myPid()).put("source",source).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));output.getFD().sync();
            }
            SyncStaging.syncDirectory(root.toFile());
        } else {
            JSONObject captured=new JSONObject(new String(Files.readAllBytes(root.resolve("captured.json")),java.nio.charset.StandardCharsets.UTF_8));
            assertNotEquals("Recovery must run in a fresh app process",captured.getInt("pid"),Process.myPid());
            assertEquals(SyncStaging.canonical(source),SyncStaging.canonical(captured.getJSONObject("source")));
            try(NativeUploadJob job=new NativeUploadJob(root.resolve("parts"),binding,()->{})) {
                job.run(request,reader.uploadSource(source),cloud,()->{},n->{});
            }
            assertEquals(2,puts[0]);assertEquals(1,completions[0]);
            assertEquals("First part must reuse disk bytes; full source proofs still run",2*request.size+17,memory.readBytes);
            try(java.util.stream.Stream<Path> files=Files.list(root.resolve("parts"))){assertEquals(1,files.count());}
            try(java.util.stream.Stream<Path> files=Files.walk(root)) {
                for(Path file:files.sorted(Comparator.reverseOrder()).toArray(Path[]::new))Files.delete(file);
            }
        }
    }
    private static final class Memory implements FolderReader.Provider {
        final byte[] bytes=new byte[8*1024*1024+17];long readBytes;
        Memory(){new Random(71).nextBytes(bytes);}
        public FolderReader.Doc root(){return new FolderReader.Doc("root","Fixture",true,0,1);}
        public FolderReader.Doc stat(String id){return id.equals("root")?root():new FolderReader.Doc("file","recovery.bin",false,bytes.length,1);}
        public List<FolderReader.Doc> children(String id){return id.equals("root")?Collections.singletonList(stat("file")):Collections.emptyList();}
        public InputStream open(String id){return new ByteArrayInputStream(bytes){
            @Override public synchronized int read(byte[] b,int offset,int length){int count=super.read(b,offset,length);if(count>0)readBytes+=count;return count;}
        };}
    }
}
