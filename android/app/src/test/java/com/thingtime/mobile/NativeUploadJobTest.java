package com.thingtime.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import java.nio.file.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;

public class NativeUploadJobTest {
    static void remove(Path root) throws Exception {try(java.util.stream.Stream<Path> paths=Files.walk(root)){for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.delete(p);}}
    static final class Cloud implements NativeUploadJob.Transport {
        final NativeUploadRequest request;
        final Map<Integer,byte[]> parts=new HashMap<>();
        int reservations,puts,completions;boolean ready,losePart,loseCompletion;
        Runnable afterPut=()->{};
        Cloud(NativeUploadRequest request){this.request=request;}
        @Override public JSONObject json(String path,JSONObject body) throws Exception {
            if(path.equals("/api/v1/attachments/uploads")) {
                reservations++;assertEquals(request.operationId,body.getString("requestId"));
                return new JSONObject().put("ok",true).put("upload",new JSONObject().put("id",request.uploadId).put("partSizeBytes",request.partSize)
                    .put("partCount",request.partCount).put("state",ready?"ready":"uploading"));
            }
            assertEquals(request.uploadId,body.getString("uploadId"));
            if(path.endsWith("/complete")) {completions++;ready=true;if(loseCompletion){loseCompletion=false;throw new IOException("lost completion reply");}return new JSONObject().put("ok",true);}
            assertTrue(path.endsWith("/parts"));return new JSONObject().put("ok",true).put("parts",body.getJSONArray("parts"));
        }
        @Override public void put(JSONObject signed,Path file,String checksum,long length,int number) throws Exception {
            byte[] bytes=Files.readAllBytes(file);assertEquals(length,bytes.length);
            assertEquals(checksum,Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes)));
            assertEquals(number,signed.getJSONArray("parts").getJSONObject(0).getInt("partNumber"));
            byte[] old=parts.put(number,bytes);if(old!=null)assertArrayEquals(old,bytes);puts++;afterPut.run();
            if(losePart){losePart=false;throw new IOException("lost part reply");}
        }
    }
    @Test public void wholeJobStreamsPartsAndKeepsSharedIdentitiesAfterLostReplies() throws Exception {
        NativeUploadFixture f=new NativeUploadFixture(8*1024*1024+37);NativeUploadRequest r=f.request();Cloud cloud=new Cloud(r);
        Path root=Files.createTempDirectory("native-upload-job-");
        try {
            cloud.losePart=true;
            try(NativeUploadJob job=new NativeUploadJob(root.resolve("parts"),()->{})) {
                assertThrows(IOException.class,()->job.run(r,f.reader.uploadSource(r.source),cloud,()->{},n->{}));
            }
            assertEquals(0,cloud.completions);assertEquals(1,cloud.puts);
            List<Long> progress=new ArrayList<>();f.readBytes=0;
            try(NativeUploadJob job=new NativeUploadJob(root.resolve("parts"),()->{})) {job.run(r,f.reader.uploadSource(r.source),cloud,()->r.authorize(f.row(),"wifi",false,"device"),progress::add);}
            assertEquals(1,cloud.completions);assertEquals(3,cloud.puts);assertEquals(2,cloud.reservations);
            assertEquals(List.of(r.partSize,r.size),progress);assertEquals(3*r.size,f.readBytes);assertTrue(f.maxRead<=65536);
            ByteArrayOutputStream restored=new ByteArrayOutputStream();for(int i=1;i<=r.partCount;i++)restored.write(cloud.parts.get(i));assertArrayEquals(f.bytes,restored.toByteArray());
            try(java.util.stream.Stream<Path> files=Files.list(root.resolve("parts"))){assertEquals(List.of(".lock"),files.map(p->p.getFileName().toString()).toList());}
        } finally {remove(root);}
    }
    @Test public void acceptedCompletionResumesWithoutAnotherSourceReadOrUpload() throws Exception {
        NativeUploadFixture f=new NativeUploadFixture(1031);NativeUploadRequest r=f.request();Cloud cloud=new Cloud(r);cloud.loseCompletion=true;
        Path root=Files.createTempDirectory("native-upload-complete-");
        try {
            try(NativeUploadJob job=new NativeUploadJob(root.resolve("parts"),()->{})){assertThrows(IOException.class,()->job.run(r,f.reader.uploadSource(r.source),cloud,()->{},n->{}));}
            try(NativeUploadJob job=new NativeUploadJob(root.resolve("parts"),()->{})){job.run(r,work->{throw new AssertionError("Already completed bytes must not be read again");},cloud,()->{},n->assertEquals(r.size,n));}
            assertEquals(1,cloud.puts);assertEquals(1,cloud.completions);
        }finally{remove(root);}
    }
    @Test public void sourceEditAfterPutCannotCompleteAndCancelledCaptureCleansItsPrivateFile() throws Exception {
        NativeUploadFixture f=new NativeUploadFixture(70000);NativeUploadRequest r=f.request();Cloud cloud=new Cloud(r);
        cloud.afterPut=()->f.bytes[0]^=1;Path root=Files.createTempDirectory("native-upload-changed-");
        try {
            try(NativeUploadJob job=new NativeUploadJob(root.resolve("parts"),()->{})){assertThrows(Exception.class,()->job.run(r,f.reader.uploadSource(r.source),cloud,()->{},n->{}));}
            assertEquals(0,cloud.completions);f.bytes[0]^=1;
            NativeUploadSource source=NativeUploadSource.verify(r.source,f.reader.uploadSource(r.source),()->{});f.bytes[1]^=1;
            assertThrows(Exception.class,()->source.capture(1,new ByteArrayOutputStream()));
            boolean[] stopped={false};PairingEngine.Check check=()->{if(stopped[0])throw new java.util.concurrent.CancellationException();};
            try(NativeUploadJob job=new NativeUploadJob(root.resolve("parts"),check)) {
                stopped[0]=true;assertThrows(java.util.concurrent.CancellationException.class,()->job.run(r,f.reader.uploadSource(r.source),cloud,()->{},n->{}));
            }
            try(java.util.stream.Stream<Path> files=Files.list(root.resolve("parts"))){assertEquals(1,files.count());}
        } finally {remove(root);}
    }
    @Test public void pathReplacementChangedMetadataAndForeignPolicyRefuse() throws Exception {
        NativeUploadFixture f=new NativeUploadFixture(7);NativeUploadRequest r=f.request();
        r.authorize(f.row(),"wifi",false,"device");
        assertThrows(Exception.class,()->r.authorize(f.row(),"cellular",false,"device"));
        assertThrows(Exception.class,()->r.authorize(f.row(),"wifi",false,"other"));
        JSONObject power=new JSONObject(f.input.toString());power.getJSONObject("authorization").getJSONObject("configuration").put("chargingOnly",true);
        NativeUploadRequest powered=new NativeUploadRequest(power,f.owner,f.root,false);
        assertThrows(Exception.class,()->powered.conditions("wifi",false));assertThrows(Exception.class,()->powered.conditions("wifi",null));powered.conditions("wifi",true);
        JSONObject row=f.row();row.getJSONObject("thing").put("acl",new JSONArray().put("tt:public"));assertThrows(Exception.class,()->r.authorize(row,"wifi",false,"device"));
        JSONObject other=f.row();other.getJSONObject("thing").put("updatedAt","2026-10-19T00:00:00.000Z");assertThrows(Exception.class,()->r.authorize(other,"wifi",false,"device"));
        f.fileId="replacement";assertThrows(Exception.class,()->NativeUploadSource.verify(r.source,f.reader.uploadSource(r.source),()->{}));
        f.fileId="file";f.modified++;assertThrows(Exception.class,()->NativeUploadSource.verify(r.source,f.reader.uploadSource(r.source),()->{}));
        JSONObject wrong=new JSONObject(f.input.toString());wrong.getJSONObject("authorization").getJSONObject("scope").put("ownerId","foreign");
        assertThrows(Exception.class,()->new NativeUploadRequest(wrong,f.owner,f.root,false));
        JSONObject extra=new JSONObject(f.input.toString());extra.getJSONObject("authorization").getJSONObject("configuration").put("futurePolicy",true);
        assertThrows(Exception.class,()->new NativeUploadRequest(extra,f.owner,f.root,false));
        assertThrows(Exception.class,()->new NativeUploadRequest(f.input,f.owner,f.root,true));
    }
    @Test public void orphanPartsArePrivateAndConcurrentWritersOrLinksCannotEnter() throws Exception {
        Path root=Files.createTempDirectory("native-upload-lock-");
        try {
            Path parts=root.resolve("parts");Files.createDirectory(parts);Files.write(parts.resolve("part-old.bin"),"orphan".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            try(NativeUploadJob job=new NativeUploadJob(parts,()->{})) {
                assertFalse(Files.exists(parts.resolve("part-old.bin")));
                assertThrows(Exception.class,()->{try(NativeUploadJob ignored=new NativeUploadJob(parts,()->{})){fail("Concurrent writer");}});
            }
            Path link=root.resolve("alias");Files.createSymbolicLink(link,parts);assertThrows(Exception.class,()->new NativeUploadJob(link,()->{}));Files.delete(link);
        } finally {remove(root);}
    }
}
