package com.thingtime.mobile;

import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.util.*;
import org.json.JSONObject;

/** Bounded private transfer cache, never history or authority. One native job
 * holds the lock through capture, upload and release. No credentials are saved. */
final class NativeUploadPartStore implements AutoCloseable {
    interface Disk {
        void sync(Path directory) throws Exception;
        void regular(Path file) throws Exception;
    }
    static final Disk ANDROID=new Disk() {
        public void sync(Path directory) throws Exception {SyncStaging.syncDirectory(directory.toFile());}
        public void regular(Path file) throws Exception {
            android.system.StructStat s=android.system.Os.lstat(file.toString());
            if(!android.system.OsConstants.S_ISREG(s.st_mode)||s.st_nlink!=1)throw NativeUploadRequest.invalid();
        }
    };
    static final class Binding {
        final DeviceScope owner; final String root,grantHash;
        Binding(DeviceScope owner,String root,String grantHash) throws Exception {
            if(!UUID.fromString(root).toString().equalsIgnoreCase(root)||!grantHash.matches("[a-f0-9]{64}"))throw NativeUploadRequest.invalid();
            this.owner=owner;this.root=root;this.grantHash=grantHash;
        }
        JSONObject identity(NativeUploadRequest.Part p) throws Exception {
            return new JSONObject().put("owner",owner.owner).put("origin",owner.origin).put("root",root)
                .put("uploadId",p.uploadId).put("requestId",p.operationId).put("part",p.number);
        }
        JSONObject request(NativeUploadRequest.Part p) throws Exception {
            return identity(p).put("grantHash",grantHash).put("source",p.source).put("offset",p.offset).put("length",p.length);
        }
    }
    static final class Part {
        final Path file;final String sha256;final boolean reused;
        Part(Path file,String sha256,boolean reused){this.file=file;this.sha256=sha256;this.reused=reused;}
    }
    private final Path directory;
    private final PairingEngine.Check check;
    private final Disk disk;
    private final FileChannel lockChannel;
    private final FileLock lock;
    private final int maximumParts;
    private final long maximumBytes;
    private final PairingEngine.Check afterPayloadFlushed;
    NativeUploadPartStore(Path directory,PairingEngine.Check check,Disk disk) throws Exception {
        this(directory,check,disk,32,5L*1024*1024*1024,()->{});
    }
    NativeUploadPartStore(Path directory,PairingEngine.Check check,Disk disk,int maximumParts,long maximumBytes,PairingEngine.Check afterPayloadFlushed) throws Exception {
        if(maximumParts<1||maximumParts>32||maximumBytes<1||maximumBytes>5L*1024*1024*1024)throw NativeUploadRequest.invalid();
        this.directory=directory;this.check=check;this.disk=disk;this.maximumParts=maximumParts;this.maximumBytes=maximumBytes;this.afterPayloadFlushed=afterPayloadFlushed;
        check.run();
        if(!Files.exists(directory,LinkOption.NOFOLLOW_LINKS)) {
            Files.createDirectory(directory,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            disk.sync(directory.getParent());
        }
        requireDirectory(directory);
        lockChannel=FileChannel.open(directory.resolve(".lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);
        FileLock acquired=null;
        try {
            disk.regular(directory.resolve(".lock"));acquired=lockChannel.tryLock();if(acquired==null)throw NativeUploadRequest.invalid();
            recover();
        } catch(Exception error) {try{if(acquired!=null)acquired.close();}finally{lockChannel.close();}throw error;}
        lock=acquired;
    }
    private static void requireDirectory(Path path) throws Exception {
        if(!Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS)||Files.isSymbolicLink(path))throw NativeUploadRequest.invalid();
    }
    private static String hash(String text) throws Exception {return FolderReader.hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
    private String key(Binding binding,NativeUploadRequest.Part part) throws Exception {return hash(SyncStaging.canonical(binding.identity(part)));}
    private List<Path> children(Path path,int maximum) throws Exception {
        requireDirectory(path);List<Path> result=new ArrayList<>();
        try(DirectoryStream<Path> rows=Files.newDirectoryStream(path)) {
            for(Path row:rows){check.run();if(result.size()>=maximum)throw NativeUploadRequest.invalid();result.add(row);}
        }return result;
    }
    private void removeDirectory(Path path) throws Exception {
        for(Path child:children(path,3)) {
            if(!Arrays.asList("record.json","record.tmp","payload").contains(child.getFileName().toString()))throw NativeUploadRequest.invalid();
            disk.regular(child);Files.delete(child);
        }
        Files.delete(path);disk.sync(directory);
    }
    private void recover() throws Exception {
        // Old ephemeral parts, pre-reservation directories and committed discards
        // are the only entries recovery may remove. Unknown state fails closed.
        for(Path row:children(directory,129)) {
            String name=row.getFileName().toString();if(name.equals(".lock"))continue;
            if(name.matches("part-[A-Za-z0-9-]+\\.bin")){disk.regular(row);Files.delete(row);continue;}
            if(name.matches("discard-[a-f0-9]{64}")){removeDirectory(row);continue;}
            if(!name.matches("[a-f0-9]{64}"))throw NativeUploadRequest.invalid();
            requireDirectory(row);
            if(!Files.exists(row.resolve("record.json"),LinkOption.NOFOLLOW_LINKS)) {
                for(Path child:children(row,1)) {
                    if(!child.getFileName().toString().equals("record.tmp"))throw NativeUploadRequest.invalid();disk.regular(child);
                }
                removeDirectory(row);
            } else read(row);
        }
        disk.sync(directory);
    }
    private JSONObject read(Path location) throws Exception {
        for(Path child:children(location,3)) {
            if(!Arrays.asList("record.json","record.tmp","payload").contains(child.getFileName().toString()))throw NativeUploadRequest.invalid();disk.regular(child);
        }
        Path file=location.resolve("record.json");disk.regular(file);
        byte[] bytes;
        try(FileChannel channel=FileChannel.open(file,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)) {
            long length=channel.size();if(length<1||length>65536)throw NativeUploadRequest.invalid();
            ByteBuffer buffer=ByteBuffer.allocate((int)length);while(buffer.hasRemaining()){check.run();if(channel.read(buffer)<1)throw NativeUploadRequest.invalid();}
            if(channel.size()!=length)throw NativeUploadRequest.invalid();bytes=buffer.array();
        }
        JSONObject row=new JSONObject(new String(bytes,StandardCharsets.UTF_8)),request=row.getJSONObject("request");
        if(row.length()!=3||row.getInt("version")!=1||(!row.isNull("sha256")&&!row.getString("sha256").matches("[a-f0-9]{64}")))throw NativeUploadRequest.invalid();
        DeviceScope scope=new DeviceScope(request.getString("owner"),request.getString("origin"),BuildConfig.DEBUG);
        Binding binding=new Binding(scope,request.getString("root"),request.getString("grantHash"));
        NativeUploadRequest.Part part=new NativeUploadRequest.Part(new JSONObject().put("source",request.getJSONObject("source"))
            .put("uploadId",request.getString("uploadId")).put("requestId",request.getString("requestId"))
            .put("partNumber",request.getInt("part")).put("offset",request.getLong("offset")).put("length",request.getLong("length")));
        if(!key(binding,part).equals(location.getFileName().toString())||!SyncStaging.canonical(binding.request(part)).equals(SyncStaging.canonical(request)))throw NativeUploadRequest.invalid();
        return row;
    }
    private void save(Path location,JSONObject row) throws Exception {
        byte[] bytes=row.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>65536)throw NativeUploadRequest.invalid();
        Path temporary=location.resolve("record.tmp");
        if(Files.exists(temporary,LinkOption.NOFOLLOW_LINKS)){disk.regular(temporary);Files.delete(temporary);}
        try(FileChannel channel=FileChannel.open(temporary,EnumSet.of(StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE),PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))) {
            ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining()){check.run();channel.write(buffer);}channel.force(true);
        }
        check.run();Files.move(temporary,location.resolve("record.json"),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);disk.sync(location);
    }
    Part prepare(Binding binding,NativeUploadRequest.Part part,NativeUploadSource source) throws Exception {
        check.run();source.matches(part.source);Path location=directory.resolve(key(binding,part));JSONObject request=binding.request(part);
        List<Path> rows=children(directory,33);long reserved=0;int count=0;JSONObject existing=null;
        for(Path row:rows) {
            if(row.getFileName().toString().equals(".lock"))continue;
            JSONObject saved=read(row);reserved+=saved.getJSONObject("request").getLong("length");count++;
            if(row.equals(location))existing=saved;
        }
        if(existing!=null) {
            if(!SyncStaging.canonical(existing.getJSONObject("request")).equals(SyncStaging.canonical(request)))throw NativeUploadRequest.invalid();
            if(!existing.isNull("sha256"))return validate(location,part,source,existing.getString("sha256"),true);
        } else {
            if(count>=maximumParts||reserved>maximumBytes-part.length)throw new FolderReader.Failure("Upload recovery storage is full. Retry pending uploads or remove their folder selections to clear cached parts.");
            Files.createDirectory(location,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
            save(location,new JSONObject().put("version",1).put("request",request).put("sha256",JSONObject.NULL));disk.sync(directory);
        }
        Path payload=location.resolve("payload");
        if(Files.exists(payload,LinkOption.NOFOLLOW_LINKS)){disk.regular(payload);Files.delete(payload);}
        if(directory.toFile().getUsableSpace()<part.length+16L*1024*1024)throw new FolderReader.Failure("Free space on this device before retrying the upload.");
        String digest;
        try(FileChannel output=FileChannel.open(payload,EnumSet.of(StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE),PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))) {
            OutputStream stream=Channels.newOutputStream(output);digest=source.capture(part.number,stream);stream.flush();output.force(true);
            if(output.size()!=part.length)throw NativeUploadRequest.invalid();
        }
        disk.sync(location);afterPayloadFlushed.run();check.run();
        save(location,new JSONObject().put("version",1).put("request",request).put("sha256",digest));
        return validate(location,part,source,digest,false);
    }
    private Part validate(Path location,NativeUploadRequest.Part part,NativeUploadSource source,String expected,boolean reused) throws Exception {
        Path payload=location.resolve("payload");disk.regular(payload);MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try(FileChannel input=FileChannel.open(payload,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)) {
            if(input.size()!=part.length)throw NativeUploadRequest.invalid();ByteBuffer buffer=ByteBuffer.allocate(65536);long length=0;
            while(length<part.length){check.run();buffer.clear();buffer.limit((int)Math.min(buffer.capacity(),part.length-length));int count=input.read(buffer);if(count<1)throw NativeUploadRequest.invalid();hash.update(buffer.array(),0,count);length+=count;}
            if(input.size()!=part.length)throw NativeUploadRequest.invalid();
        }
        check.run();String actual=FolderReader.hex(hash.digest());
        if(!actual.equals(expected)||!actual.equals(source.digest(part.number)))throw NativeUploadRequest.invalid();
        return new Part(payload,actual,reused);
    }
    void release(Binding binding,NativeUploadRequest.Part part) throws Exception {
        check.run();Path location=directory.resolve(key(binding,part));
        if(!Files.exists(location,LinkOption.NOFOLLOW_LINKS))return;
        if(!SyncStaging.canonical(read(location).getJSONObject("request")).equals(SyncStaging.canonical(binding.request(part))))throw NativeUploadRequest.invalid();
        discard(location);
    }
    private void discard(Path location) throws Exception {
        Path discarded=directory.resolve("discard-"+location.getFileName());
        if(Files.exists(discarded,LinkOption.NOFOLLOW_LINKS))throw NativeUploadRequest.invalid();
        Files.move(location,discarded,StandardCopyOption.ATOMIC_MOVE);disk.sync(directory);removeDirectory(discarded);
    }
    void remove(DeviceScope owner,String root) throws Exception {
        for(Path location:children(directory,33)) {
            if(location.getFileName().toString().equals(".lock"))continue;
            JSONObject request=read(location).getJSONObject("request");
            if(owner.matches(request.getString("owner"),request.getString("origin"))&&root.equals(request.getString("root")))discard(location);
        }
    }
    @Override public void close() throws Exception {try{lock.close();}finally{lockChannel.close();}}
}
