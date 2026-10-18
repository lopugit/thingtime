package com.thingtime.mobile;

import java.io.OutputStream;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.LinkOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Base64;
import org.json.JSONObject;

/** Native multipart orchestration reuses the original server reservation. The
 * shared durable sync journal remains responsible for file/Timeline publication. */
final class NativeUploadJob implements AutoCloseable {
    interface Transport { JSONObject json(String path,JSONObject body) throws Exception; void put(JSONObject signed,Path file,String checksum,long length,int number) throws Exception; }
    interface Progress { void update(long received) throws Exception; }
    private final Path directory;
    private final FileChannel lockChannel;
    private final FileLock lock;
    private final PairingEngine.Check check;
    NativeUploadJob(Path directory,PairingEngine.Check check) throws Exception {
        this.directory=directory;this.check=check;check.run();
        if(!Files.exists(directory,LinkOption.NOFOLLOW_LINKS))Files.createDirectory(directory,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
        if(!Files.isDirectory(directory,LinkOption.NOFOLLOW_LINKS)||Files.isSymbolicLink(directory))throw NativeUploadRequest.invalid();
        lockChannel=FileChannel.open(directory.resolve(".lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS);
        FileLock acquired=null;
        try {
            acquired=lockChannel.tryLock();if(acquired==null)throw NativeUploadRequest.invalid();
            // Only private unfinished part files are cleaned on the next run.
            // A process-wide/native file lock prevents deleting an active part.
            try(java.nio.file.DirectoryStream<Path> paths=Files.newDirectoryStream(directory,"part-*.bin")) {
                int count=0;for(Path path:paths) {
                    check.run();if(++count>64||!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS))throw NativeUploadRequest.invalid();Files.delete(path);
                }
            }
        } catch(Exception error) {try{if(acquired!=null)acquired.close();}finally{lockChannel.close();}throw error;}
        lock=acquired;
    }
    void run(NativeUploadRequest request,NativeUploadSource.Reader reader,Transport transport,PairingEngine.Check authorize,Progress progress) throws Exception {
        check.run();authorize.run();
        if(request.verifyPlan(transport.json("/api/v1/attachments/uploads",request.reservation()))) {check.run();authorize.run();progress.update(request.size);return;}
        NativeUploadSource source=NativeUploadSource.verify(request.source,reader,check);
        for(int number=1;number<=request.partCount;number++) {
            NativeUploadRequest.Part part=request.part(number);
            upload(part,source,transport,authorize,false);check.run();progress.update(part.offset+part.length);
        }
        source.revalidate();authorize.run();check.run();
        JSONObject completed=transport.json("/api/v1/attachments/uploads/complete",new JSONObject().put("uploadId",request.uploadId));
        check.run();if(!Boolean.TRUE.equals(completed.opt("ok")))throw NativeUploadRequest.invalid();authorize.run();check.run();
    }
    String upload(NativeUploadRequest.Part part,NativeUploadSource source,Transport transport,PairingEngine.Check authorize,boolean replay) throws Exception {
        check.run();authorize.run();
        boolean ready=replay&&part.verifyPlan(transport.json("/api/v1/attachments/uploads",part.reservation()));
        // Android refuses Files.getFileStore even for app-private directories.
        if(directory.toFile().getUsableSpace()<part.length+16L*1024*1024)throw new FolderReader.Failure("Free space on this device before retrying the upload.");
        Path file=Files.createTempFile(directory,"part-",".bin",PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        try {
            String digest;
            try(FileChannel output=FileChannel.open(file,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)) {
                OutputStream stream=Channels.newOutputStream(output);digest=source.capture(part.number,stream);stream.flush();output.force(true);
                if(output.size()!=part.length)throw NativeUploadRequest.invalid();
            }
            check.run();authorize.run();
            if(!ready) {
                byte[] hash=new byte[32];for(int i=0;i<32;i++)hash[i]=(byte)Integer.parseInt(digest.substring(i*2,i*2+2),16);
                String checksum=Base64.getEncoder().encodeToString(hash);
                JSONObject signed=transport.json("/api/v1/attachments/uploads/parts",new JSONObject().put("uploadId",part.uploadId)
                    .put("parts",new org.json.JSONArray().put(new JSONObject().put("partNumber",part.number).put("checksumSha256",checksum))));
                check.run();authorize.run();transport.put(signed,file,checksum,part.length,part.number);
            }
            check.run();if(replay)source.revalidate();authorize.run();return digest;
        } finally {Files.deleteIfExists(file);}
    }
    @Override public void close() throws Exception {try{lock.close();}finally{lockChannel.close();}}
}
