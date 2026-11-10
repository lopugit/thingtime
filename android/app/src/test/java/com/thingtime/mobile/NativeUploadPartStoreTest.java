package com.thingtime.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import org.json.JSONObject;

public class NativeUploadPartStoreTest {
    private static NativeUploadPartStore store(Path directory) throws Exception {return new NativeUploadPartStore(directory,()->{},NativeUploadJobTest.DISK);}
    private static NativeUploadSource source(NativeUploadFixture f) throws Exception {return NativeUploadSource.verify(f.request().source,f.reader.uploadSource(f.request().source),()->{});}
    @Test public void reopenedCacheReusesFlushedBytesAndExactIdentities() throws Exception {
        Path root=Files.createTempDirectory("upload-reuse-");NativeUploadFixture f=new NativeUploadFixture(70000);
        NativeUploadPartStore.Binding binding=NativeUploadJobTest.binding();NativeUploadRequest.Part part=f.request().part(1);
        NativeUploadSource source=source(f);Path payload;
        try {
            try(NativeUploadPartStore store=store(root.resolve("parts"))) {
                NativeUploadPartStore.Part first=store.prepare(binding,part,source);assertFalse(first.reused);payload=first.file;
                assertEquals("rw-------",java.nio.file.attribute.PosixFilePermissions.toString(Files.getPosixFilePermissions(payload)));
                assertEquals("rwx------",java.nio.file.attribute.PosixFilePermissions.toString(Files.getPosixFilePermissions(payload.getParent())));
            }
            long reads=f.readBytes;
            try(NativeUploadPartStore store=store(root.resolve("parts"))) {
                NativeUploadPartStore.Part next=store.prepare(binding,part,source);assertTrue(next.reused);assertEquals(payload,next.file);
                assertEquals(reads,f.readBytes);assertArrayEquals(f.bytes,Files.readAllBytes(next.file));store.release(binding,part);
            }
            try(var files=Files.list(root.resolve("parts"))){assertEquals(1,files.count());}
        }finally{NativeUploadJobTest.remove(root);}
    }
    @Test public void interruptionAfterPayloadFlushRecapturesWithoutInventingSuccess() throws Exception {
        Path root=Files.createTempDirectory("upload-flush-");NativeUploadFixture f=new NativeUploadFixture(70000);
        NativeUploadPartStore.Binding binding=NativeUploadJobTest.binding();NativeUploadRequest.Part part=f.request().part(1);NativeUploadSource source=source(f);
        try {
            try(NativeUploadPartStore store=new NativeUploadPartStore(root.resolve("parts"),()->{},NativeUploadJobTest.DISK,32,5L*1024*1024*1024,()->{throw new IOException("interrupted");})) {
                assertThrows(IOException.class,()->store.prepare(binding,part,source));
            }
            long reads=f.readBytes;
            try(NativeUploadPartStore store=store(root.resolve("parts"))) {
                assertFalse(store.prepare(binding,part,source).reused);assertEquals(reads+f.bytes.length,f.readBytes);store.release(binding,part);
            }
        }finally{NativeUploadJobTest.remove(root);}
    }
    @Test public void changedGrantOrSourceCannotReplaceOriginalReservation() throws Exception {
        Path root=Files.createTempDirectory("upload-identity-");NativeUploadFixture f=new NativeUploadFixture(101);
        NativeUploadPartStore.Binding binding=NativeUploadJobTest.binding();NativeUploadRequest.Part part=f.request().part(1);NativeUploadSource source=source(f);
        try(NativeUploadPartStore store=store(root.resolve("parts"))) {
            NativeUploadPartStore.Part saved=store.prepare(binding,part,source);
            NativeUploadPartStore.Binding changed=new NativeUploadPartStore.Binding(binding.owner,binding.root,"b".repeat(64));
            assertThrows(Exception.class,()->store.prepare(changed,part,source));assertThrows(Exception.class,()->store.release(changed,part));
            JSONObject edited=new JSONObject(f.input.toString());edited.getJSONObject("source").put("path","renamed.bin");
            NativeUploadRequest.Part different=new NativeUploadRequest(edited,f.owner,f.root,false).part(1);
            assertThrows(Exception.class,()->store.prepare(binding,different,source));assertArrayEquals(f.bytes,Files.readAllBytes(saved.file));
            store.remove(new DeviceScope("other",binding.owner.origin,false),binding.root);assertTrue(Files.exists(saved.file));
            store.remove(binding.owner,binding.root);assertFalse(Files.exists(saved.file));
        }finally{NativeUploadJobTest.remove(root);}
    }
    @Test public void corruptBytesAndSymlinkOrHardlinkPayloadsRefuseBeforeUse() throws Exception {
        for(String mode:List.of("bytes","symlink","hardlink")) {
            Path root=Files.createTempDirectory("upload-corrupt-");NativeUploadFixture f=new NativeUploadFixture(101);
            NativeUploadPartStore.Binding binding=NativeUploadJobTest.binding();NativeUploadRequest.Part part=f.request().part(1);NativeUploadSource source=source(f);
            try {
                Path payload;
                try(NativeUploadPartStore store=store(root.resolve("parts"))){payload=store.prepare(binding,part,source).file;}
                if(mode.equals("bytes")){byte[] altered=f.bytes.clone();altered[0]^=1;Files.write(payload,altered);}
                else {Path external=root.resolve("external");Files.write(external,f.bytes);Files.delete(payload);
                    if(mode.equals("symlink"))Files.createSymbolicLink(payload,external);else Files.createLink(payload,external);}
                assertThrows(Exception.class,()->{try(NativeUploadPartStore store=store(root.resolve("parts"))){store.prepare(binding,part,source);}});
            }finally{NativeUploadJobTest.remove(root);}
        }
    }
    @Test public void boundedReservationsDoNotEvictUncertainUploads() throws Exception {
        Path root=Files.createTempDirectory("upload-quota-");NativeUploadFixture f=new NativeUploadFixture(101);
        NativeUploadPartStore.Binding binding=NativeUploadJobTest.binding();NativeUploadRequest.Part first=f.request().part(1);NativeUploadSource source=source(f);
        JSONObject other=new JSONObject(f.input.toString()).put("uploadId","second").put("requestId","second-operation");
        NativeUploadRequest.Part second=new NativeUploadRequest(other,f.owner,f.root,false).part(1);
        try {
            try(NativeUploadPartStore store=new NativeUploadPartStore(root.resolve("parts"),()->{},NativeUploadJobTest.DISK,1,101,()->{})) {
                Path payload=store.prepare(binding,first,source).file;
                assertThrows(FolderReader.Failure.class,()->store.prepare(binding,second,source));assertTrue(Files.exists(payload));
                assertTrue(store.prepare(binding,first,source).reused);store.release(binding,first);assertFalse(store.prepare(binding,second,source).reused);
            }
        }finally{NativeUploadJobTest.remove(root);}
    }
    @Test public void recoveryCleansOnlyUncommittedReservationsAndAtomicDiscards() throws Exception {
        Path root=Files.createTempDirectory("upload-orphans-");NativeUploadFixture f=new NativeUploadFixture(101);
        NativeUploadPartStore.Binding binding=NativeUploadJobTest.binding();NativeUploadRequest.Part part=f.request().part(1);NativeUploadSource source=source(f);
        try {
            Path payload;
            try(NativeUploadPartStore store=store(root.resolve("parts"))){payload=store.prepare(binding,part,source).file;}
            Path directory=payload.getParent();Files.move(directory,directory.resolveSibling("discard-"+directory.getFileName()),StandardCopyOption.ATOMIC_MOVE);
            Path orphan=root.resolve("parts").resolve("f".repeat(64));Files.createDirectory(orphan);Files.write(orphan.resolve("record.tmp"),"unfinished".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            try(NativeUploadPartStore store=store(root.resolve("parts"))){assertFalse(store.prepare(binding,part,source).reused);assertFalse(Files.exists(orphan));}
            Files.createDirectory(orphan);Files.write(orphan.resolve("unknown"),"retain".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            assertThrows(Exception.class,()->{try(NativeUploadPartStore ignored=store(root.resolve("parts"))){fail();}});
            assertEquals("retain",new String(Files.readAllBytes(orphan.resolve("unknown")),java.nio.charset.StandardCharsets.UTF_8));
        }finally{NativeUploadJobTest.remove(root);}
    }
    @Test public void retryReauthorizesAndRevalidatesCurrentSourceBeforeCachedDisclosure() throws Exception {
        Path root=Files.createTempDirectory("upload-authority-");NativeUploadFixture f=new NativeUploadFixture(101);NativeUploadRequest request=f.request();
        NativeUploadJobTest.Cloud cloud=new NativeUploadJobTest.Cloud(request);cloud.losePart=true;
        try {
            try(NativeUploadJob job=NativeUploadJobTest.job(root.resolve("parts"),()->{})) {
                assertThrows(IOException.class,()->job.run(request,f.reader.uploadSource(request.source),cloud,()->{},n->{}));
            }
            try(NativeUploadJob job=NativeUploadJobTest.job(root.resolve("parts"),()->{})) {
                assertThrows(IOException.class,()->job.run(request,f.reader.uploadSource(request.source),cloud,()->{throw new IOException("revoked");},n->{}));
            }
            assertEquals(1,cloud.puts);f.bytes[0]^=1;
            try(NativeUploadJob job=NativeUploadJobTest.job(root.resolve("parts"),()->{})) {
                assertThrows(Exception.class,()->job.run(request,f.reader.uploadSource(request.source),cloud,()->{},n->{}));
            }
            assertEquals(1,cloud.puts);assertEquals(0,cloud.completions);
        }finally{NativeUploadJobTest.remove(root);}
    }
}
