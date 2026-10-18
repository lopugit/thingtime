package com.thingtime.mobile;

import android.content.Context;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.TreeSet;
import java.util.UUID;

/** Durable app-private downloads, using the shared mobile staging contract.
 * This is neither a folder write grant nor a publication receipt. No provider
 * document is opened for writing here. The bridge authenticates each call. */
final class SyncStaging {
    private static final long MAX_SAFE=9007199254740991L;
    private static final int MAX_RECORD=65536;
    // POSIX record locks are process-scoped: closing a second descriptor can
    // release another thread's lock. Never open competing lock descriptors in
    // one process; retain a kernel lock as well for separate app processes.
    private static final java.util.concurrent.locks.ReentrantLock PROCESS_LOCK=new java.util.concurrent.locks.ReentrantLock(true);
    private final File directory;
    private final PairingEngine.Check check;
    private final PairingEngine.Check afterBytesFlushed;

    SyncStaging(Context context,PairingEngine.Check check) {
        this(new File(context.getNoBackupFilesDir(),"MobileSyncStaging-v1"),check,()->{});
    }
    SyncStaging(File directory,PairingEngine.Check check,PairingEngine.Check afterBytesFlushed) {
        this.directory=directory;this.check=check;this.afterBytesFlushed=afterBytesFlushed;
    }
    private static FolderReader.Failure invalid() { return new FolderReader.Failure("Invalid download operation."); }
    private static FolderReader.Failure changed() { return new FolderReader.Failure("Saved download bytes or operation changed. Keep both versions and retry with a new operation."); }
    private static FolderReader.Failure storage() { return new FolderReader.Failure("Download storage is unavailable. Free space and retry to resume saved work."); }
    static String text(JSONObject object,String key,int maximum) throws Exception {
        Object value=object.get(key);
        if(!(value instanceof String) || ((String)value).isEmpty() || ((String)value).length()>maximum) throw invalid();
        String result=(String)value;
        // Reject malformed UTF-16 instead of hashing replacement characters.
        for(int i=0;i<result.length();i++) {
            char c=result.charAt(i);
            if(Character.isHighSurrogate(c)) { if(++i==result.length() || !Character.isLowSurrogate(result.charAt(i))) throw invalid(); }
            else if(Character.isLowSurrogate(c)) throw invalid();
        }
        return result;
    }
    static long integer(JSONObject object,String key,long maximum) throws Exception {
        Object value=object.get(key);
        if(!(value instanceof Number)) throw invalid();
        double number=((Number)value).doubleValue();
        if(!Double.isFinite(number) || number<0 || number>maximum || number!=Math.rint(number)) throw invalid();
        return (long)number;
    }
    static String uuid(JSONObject object,String key) throws Exception {
        String id=text(object,key,36);
        if(!UUID.fromString(id).toString().equalsIgnoreCase(id)) throw invalid();
        return id;
    }
    private static String digest(JSONObject object,String key) throws Exception {
        String value=text(object,key,64);if(!value.matches("[0-9a-f]{64}")) throw invalid();return value;
    }
    private static long partSize(long size) {
        long mib=1048576L;return ((Math.max(8*mib,(size+9999)/10000)+mib-1)/mib)*mib;
    }
    static JSONObject entry(JSONObject input) throws Exception {
        String path=text(input,"path",4096),kind=text(input,"kind",6);
        FolderReader.path(path);long size=integer(input,"size",MAX_SAFE);
        JSONObject entry=new JSONObject().put("path",path).put("kind",kind).put("size",size).put("sha256",JSONObject.NULL)
            .put("id",text(input,"id",512)).put("version",text(input,"version",512));
        if(kind.equals("folder")) {
            if(size!=0 || !input.isNull("sha256") || !input.isNull("fingerprint")) throw invalid();
        } else if(kind.equals("file")) {
            if(!input.isNull("fingerprint")) {
                JSONObject fingerprint=input.getJSONObject("fingerprint");long part=partSize(size);
                if(size==0 || !input.isNull("sha256") || part>5L*1024*1048576 ||
                    !text(fingerprint,"algorithm",32).equals("sha256-parts-v1") ||
                    integer(fingerprint,"partSizeBytes",MAX_SAFE)!=part || integer(fingerprint,"partCount",10000)!=(size+part-1)/part) throw invalid();
                entry.put("fingerprint",new JSONObject().put("algorithm","sha256-parts-v1").put("partSizeBytes",part)
                    .put("partCount",(size+part-1)/part).put("sha256",digest(fingerprint,"sha256")));
            } else entry.put("sha256",digest(input,"sha256"));
        } else throw invalid();
        return entry;
    }
    /** Project the same immutable request fields used on iOS. JSON key order,
     * optional nulls and integral-number encoding are not operation identity. */
    static JSONObject request(JSONObject input,DeviceScope owner,String grantId) throws Exception {
        if(input.toString().getBytes(StandardCharsets.UTF_8).length>MAX_RECORD) throw invalid();
        JSONObject scope=input.getJSONObject("scope"),operation=input.getJSONObject("operation"),mutation=operation.getJSONObject("mutation");
        if(!owner.matches(text(scope,"ownerId",128),text(scope,"origin",4096)) || !text(scope,"dataPlane",16).equals("home") ||
            !uuid(input,"rootId").equals(grantId) || !Boolean.FALSE.equals(operation.get("confirmed")) ||
            !text(mutation,"kind",16).equals("copy") || !text(mutation,"from",16).equals("remote")) throw invalid();
        JSONObject boundScope=new JSONObject().put("origin",owner.origin).put("ownerId",owner.owner).put("dataPlane","home")
            .put("rootId",text(scope,"rootId",4096)).put("deviceId",text(scope,"deviceId",4096));
        JSONObject source=entry(mutation.getJSONObject("source"));String path=text(mutation,"path",4096);
        if(!path.equals(source.getString("path"))) throw invalid();
        JSONObject boundMutation=new JSONObject().put("kind","copy").put("from","remote").put("path",path).put("source",source);
        if(!mutation.isNull("expectedTarget")) {
            JSONObject expected=entry(mutation.getJSONObject("expectedTarget"));
            if(!path.equals(expected.getString("path")) || !source.getString("kind").equals(expected.getString("kind")) || source.getString("kind").equals("folder")) throw invalid();
            boundMutation.put("expectedTarget",expected);
        }
        return new JSONObject().put("scope",boundScope).put("rootId",grantId).put("operation",
            new JSONObject().put("id",uuid(operation,"id")).put("confirmed",false).put("mutation",boundMutation));
    }
    static String canonical(Object value) throws Exception {
        if(value==null || value==JSONObject.NULL) return "null";
        if(value instanceof JSONObject) {
            JSONObject object=(JSONObject)value;TreeSet<String> keys=new TreeSet<>();object.keys().forEachRemaining(keys::add);
            StringBuilder result=new StringBuilder("{");
            for(String key:keys) { if(result.length()>1)result.append(',');result.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key))); }
            return result.append('}').toString();
        }
        if(value instanceof JSONArray) {
            JSONArray array=(JSONArray)value;StringBuilder result=new StringBuilder("[");
            for(int i=0;i<array.length();i++){if(i>0)result.append(',');result.append(canonical(array.get(i)));}
            return result.append(']').toString();
        }
        if(value instanceof String) return JSONObject.quote((String)value);
        if(value instanceof Boolean) return value.toString();
        if(value instanceof Number) { double n=((Number)value).doubleValue();if(!Double.isFinite(n) || Math.abs(n)>MAX_SAFE || n!=Math.rint(n)) throw invalid();return Long.toString((long)n); }
        throw invalid();
    }
    static String key(JSONObject request) throws Exception {
        JSONObject scope=request.getJSONObject("scope");
        return FolderReader.hash(new JSONArray().put(scope.getString("origin")).put(scope.getString("ownerId"))
            .put(scope.getString("dataPlane")).put(scope.getString("rootId")).put(scope.getString("deviceId"))
            .put(request.getString("rootId")).put(request.getJSONObject("operation").getString("id")).toString());
    }
    private static JSONObject source(JSONObject request) throws Exception { return request.getJSONObject("operation").getJSONObject("mutation").getJSONObject("source"); }
    private static StructStat stat(File file) throws Exception { return Os.lstat(file.getPath()); }
    private static boolean exists(File file) throws Exception {
        try { stat(file);return true; } catch(ErrnoException missing) { if(missing.errno==OsConstants.ENOENT)return false;throw missing; }
    }
    private static void directory(File file) throws Exception {
        if(!OsConstants.S_ISDIR(stat(file).st_mode)) throw storage();
    }
    private static FileDescriptor open(File file,int flags,boolean folder) throws Exception {
        // Android's Linux ABI has always used 02000000 for O_CLOEXEC; the
        // Java field was only exposed in API 27. Keep atomic close-on-exec on
        // API 26 too (bionic libc/kernel/uapi/asm-generic/fcntl.h).
        int closeOnExec=android.os.Build.VERSION.SDK_INT>=27?OsConstants.O_CLOEXEC:02000000;
        FileDescriptor fd=Os.open(file.getPath(),flags|OsConstants.O_NOFOLLOW|closeOnExec|OsConstants.O_NONBLOCK,0600);
        try {
            StructStat info=Os.fstat(fd);
            if(folder?!OsConstants.S_ISDIR(info.st_mode):(!OsConstants.S_ISREG(info.st_mode) || info.st_nlink!=1)) throw storage();
            return fd;
        } catch(Exception error) { Os.close(fd);throw error; }
    }
    static void syncDirectory(File file) throws Exception {
        FileDescriptor fd=open(file,OsConstants.O_RDONLY,true);
        try { Os.fsync(fd); } finally { Os.close(fd); }
    }
    private void ensureDirectory(File file) throws Exception {
        if(!exists(file)) {
            try { Os.mkdir(file.getPath(),0700); }
            catch(ErrnoException raced) { if(raced.errno!=OsConstants.EEXIST)throw raced; }
            syncDirectory(file.getParentFile());
        }
        directory(file);
    }
    private static String stamp(StructStat info) throws Exception {
        long modifiedNanos=0,changedNanos=0;
        if(android.os.Build.VERSION.SDK_INT>=27) { modifiedNanos=info.st_mtim.tv_nsec;changedNanos=info.st_ctim.tv_nsec; }
        return FolderReader.hash(info.st_dev+":"+info.st_ino+":"+info.st_mode+":"+info.st_size+":"+
            info.st_mtime+":"+modifiedNanos+":"+info.st_ctime+":"+changedNanos);
    }
    private interface Work { JSONObject run(File folder,JSONObject row,JSONObject request) throws Exception; }
    private JSONObject withRecord(JSONObject input,DeviceScope owner,String grantId,boolean create,Work work) throws Exception {
        JSONObject request=request(input,owner,grantId);check.run();
        while(!PROCESS_LOCK.tryLock(10,java.util.concurrent.TimeUnit.MILLISECONDS))check.run();
        try {
          check.run();ensureDirectory(directory);
          FileDescriptor lockFd=open(new File(directory,"lock"),OsConstants.O_RDWR|OsConstants.O_CREAT,false);
          try(FileOutputStream stream=new FileOutputStream(lockFd)) {
            FileLock lock=null;
            while(lock==null) {
                check.run();
                try { lock=stream.getChannel().tryLock(); } catch(OverlappingFileLockException busy) { /* Another native caller owns the journal. */ }
                if(lock==null) Thread.sleep(10);
            }
            try {
                check.run();directory(directory);File folder=new File(directory,key(request));
                if(!exists(folder)) {
                    if(!create) throw changed();
                    String[] names=directory.list();if(names==null || names.length>=FolderReader.MAX_ENTRIES) throw storage();
                    ensureDirectory(folder);
                }
                directory(folder);JSONObject row=readRecord(folder);
                if(row==null) {
                    if(!create) throw changed();
                    // An interruption before the first atomic record rename has
                    // no acknowledged bytes. Only our private temp records may remain.
                    String[] names=folder.list();if(names==null)throw storage();
                    for(String name:names) if(!name.matches("checkpoint-[a-f0-9-]{36}")) throw changed();
                    row=new JSONObject().put("version",1).put("request",request).put("received",0);save(folder,row);
                }
                if(integer(row,"version",1)!=1 || !canonical(row.getJSONObject("request")).equals(canonical(request)) ||
                    integer(row,"received",MAX_SAFE)>source(request).getLong("size")) throw changed();
                return work.run(folder,row,request);
            } finally { lock.release(); }
          } finally { if(lockFd.valid())Os.close(lockFd); }
        } finally { PROCESS_LOCK.unlock(); }
    }
    private JSONObject readRecord(File folder) throws Exception {
        File record=new File(folder,"record.json");if(!exists(record))return null;
        FileDescriptor fd=open(record,OsConstants.O_RDONLY,false);
        try {
            long size=Os.fstat(fd).st_size;if(size<=0 || size>MAX_RECORD)throw storage();
            byte[] bytes=new byte[(int)size];int at=0;
            while(at<bytes.length) { check.run();int n=Os.read(fd,bytes,at,bytes.length-at);if(n<=0)throw storage();at+=n; }
            if(Os.read(fd,new byte[1],0,1)!=0)throw changed();
            return new JSONObject(new String(bytes,StandardCharsets.UTF_8));
        } finally { Os.close(fd); }
    }
    private void save(File folder,JSONObject row) throws Exception {
        byte[] bytes=canonical(row).getBytes(StandardCharsets.UTF_8);if(bytes.length>MAX_RECORD)throw storage();
        File temporary=new File(folder,"checkpoint-"+UUID.randomUUID());FileDescriptor fd=open(temporary,OsConstants.O_WRONLY|OsConstants.O_CREAT|OsConstants.O_EXCL,false);
        try {
            int at=0;while(at<bytes.length) { check.run();int n=Os.write(fd,bytes,at,bytes.length-at);if(n<=0)throw storage();at+=n; }
            Os.fsync(fd);check.run();Os.rename(temporary.getPath(),new File(folder,"record.json").getPath());syncDirectory(folder);
        } finally { Os.close(fd);if(exists(temporary))Os.remove(temporary.getPath()); }
    }
    private FileDescriptor payload(File folder,JSONObject row,JSONObject request,boolean create) throws Exception {
        boolean isFolder=source(request).getString("kind").equals("folder");File file=new File(folder,"payload");
        if(create && isFolder && !exists(file))ensureDirectory(file);
        FileDescriptor fd=open(file,isFolder?OsConstants.O_RDONLY:OsConstants.O_RDWR|(create?OsConstants.O_CREAT:0),isFolder);
        try {
            long received=row.getLong("received"),size=Os.fstat(fd).st_size;
            if(!isFolder) {
                if(size<received)throw changed();
                if(size>received) { if(!row.isNull("stage"))throw changed();Os.ftruncate(fd,received);Os.fsync(fd); }
            }
            return fd;
        } catch(Exception error) { Os.close(fd);throw error; }
    }
    private static JSONObject progress(JSONObject row) throws Exception {
        JSONObject result=new JSONObject().put("received",row.getLong("received"));
        if(!row.isNull("stage"))result.put("stage",new JSONObject(row.getJSONObject("stage").toString()));
        return result;
    }
    JSONObject begin(JSONObject input,DeviceScope owner,String grantId) throws Exception {
        return withRecord(input,owner,grantId,true,(folder,row,request)-> {
            FileDescriptor fd=payload(folder,row,request,row.getLong("received")==0 && row.isNull("stage"));
            try { if(!row.isNull("stage"))verify(folder,fd,row,request);Os.fsync(fd);syncDirectory(folder);return progress(row); }
            finally { Os.close(fd); }
        });
    }
    interface FrameReader { byte[] read(long offset,int length) throws Exception; }
    JSONObject append(JSONObject input,DeviceScope owner,String grantId,long offset,byte[] bytes) throws Exception {
        if(bytes==null || bytes.length==0 || bytes.length>FolderReader.MAX_READ)throw invalid();
        return appendRange(input,owner,grantId,offset,bytes.length,(at,length)->Arrays.copyOfRange(bytes,(int)at,(int)at+length));
    }
    /** Keep the lock through all frames; acknowledge only after bytes and offset are durable. */
    JSONObject appendRange(JSONObject input,DeviceScope owner,String grantId,long offset,long length,FrameReader reader) throws Exception {
        if(offset<0 || length<1 || length>32*1024*1024 || reader==null)throw invalid();
        return withRecord(input,owner,grantId,false,(folder,row,request)-> {
            long received=row.getLong("received");JSONObject source=source(request);
            if(!source.getString("kind").equals("file") || offset>received || offset>source.getLong("size")-length)throw invalid();
            FileDescriptor fd=payload(folder,row,request,false);
            try {
                boolean replay=offset<received || !row.isNull("stage");
                if(replay && offset+length>received)throw changed();
                for(long at=0;at<length;) {
                    check.run();int wanted=(int)Math.min(FolderReader.MAX_READ,length-at);
                    byte[] bytes=reader.read(at,wanted);check.run();
                    if(bytes==null || bytes.length!=wanted)throw invalid();
                    if(replay) {
                        byte[] saved=new byte[wanted];int read=0;
                        while(read<wanted) { check.run();int n=Os.pread(fd,saved,read,wanted-read,offset+at+read);if(n<=0)throw changed();read+=n; }
                        if(!Arrays.equals(saved,bytes))throw changed();
                    } else {
                        int written=0;while(written<wanted) { check.run();int n=Os.pwrite(fd,bytes,written,wanted-written,offset+at+written);if(n<=0)throw storage();written+=n; }
                    }
                    at+=wanted;
                }
                check.run();if(replay)return progress(row);
                Os.fsync(fd);afterBytesFlushed.run();check.run();row.put("received",received+length);save(folder,row);return progress(row);
            } finally { Os.close(fd); }
        });
    }
    private JSONObject verify(File folder,FileDescriptor fd,JSONObject row,JSONObject request) throws Exception {
        JSONObject source=source(request);long size=source.getLong("size");StructStat before=Os.fstat(fd);
        if(row.getLong("received")!=size)throw changed();
        if(source.getString("kind").equals("folder")) {
            String[] names=new File(folder,"payload").list();if(names==null || names.length!=0)throw changed();
        } else {
            if(before.st_size!=size)throw changed();
            MessageDigest hash=MessageDigest.getInstance("SHA-256"),part=MessageDigest.getInstance("SHA-256");
            boolean multipart=!source.isNull("fingerprint");long partSize=partSize(size),at=0,inPart=0;byte[] bytes=new byte[FolderReader.MAX_READ];
            while(at<size) {
                check.run();int wanted=(int)Math.min(bytes.length,Math.min(size-at,partSize-inPart));
                int n=Os.pread(fd,bytes,0,wanted,at);if(n<=0)throw changed();
                if(multipart)part.update(bytes,0,n);else hash.update(bytes,0,n);at+=n;inPart+=n;
                if(inPart==partSize || at==size) { if(multipart)hash.update(part.digest());inPart=0; }
            }
            String expected=multipart?source.getJSONObject("fingerprint").getString("sha256"):source.getString("sha256");
            if(!FolderReader.hex(hash.digest()).equals(expected))throw changed();
        }
        check.run();if(!stamp(before).equals(stamp(Os.fstat(fd))))throw changed();
        JSONObject entry=new JSONObject(source.toString()).put("id",before.st_dev+":"+before.st_ino).put("version",stamp(before));
        JSONObject stage=new JSONObject().put("operationId",request.getJSONObject("operation").getString("id"))
            .put("scope",request.getJSONObject("scope")).put("token",key(request)).put("entry",entry);
        if(!row.isNull("stage") && !canonical(stage).equals(canonical(row.getJSONObject("stage"))))throw changed();
        return stage;
    }
    JSONObject finish(JSONObject input,DeviceScope owner,String grantId) throws Exception {
        return withRecord(input,owner,grantId,false,(folder,row,request)-> {
            FileDescriptor fd=payload(folder,row,request,false);
            try { JSONObject stage=verify(folder,fd,row,request);if(row.isNull("stage")){row.put("stage",stage);save(folder,row);}return progress(row); }
            finally { Os.close(fd); }
        });
    }
    interface VerifiedPayload { JSONObject copy(FileDescriptor payload,JSONObject source) throws Exception; }
    /** A native sink may copy verified bytes while the stage lock is held.
     * It must not publish until this method returns: the final verification
     * rejects a source altered during the copy. No pathname crosses the bridge. */
    JSONObject withVerifiedPayload(JSONObject input,DeviceScope owner,String grantId,JSONObject stage,VerifiedPayload sink) throws Exception {
        return withRecord(input,owner,grantId,false,(folder,row,request)-> {
            JSONObject offeredScope=stage.getJSONObject("scope"),boundScope=request.getJSONObject("scope");
            for(String field:new String[]{"origin","ownerId","dataPlane","rootId","deviceId"})
                if(!text(offeredScope,field,4096).equals(boundScope.getString(field)))throw changed();
            // Project only the shared fields before canonical comparison; never
            // recursively walk arbitrary extra objects supplied by a caller.
            JSONObject offered=new JSONObject().put("operationId",uuid(stage,"operationId")).put("scope",boundScope)
                .put("token",digest(stage,"token")).put("entry",entry(stage.getJSONObject("entry")));
            if(row.isNull("stage") || !canonical(offered).equals(canonical(row.getJSONObject("stage")))) throw changed();
            FileDescriptor fd=open(new File(folder,"payload"),OsConstants.O_RDONLY,source(request).getString("kind").equals("folder"));
            try {
                verify(folder,fd,row,request);
                JSONObject copied=sink.copy(fd,new JSONObject(source(request).toString()));
                verify(folder,fd,row,request);return copied;
            } finally { Os.close(fd); }
        });
    }
}
