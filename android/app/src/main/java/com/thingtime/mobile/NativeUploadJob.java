package com.thingtime.mobile;

import java.nio.file.Path;
import java.util.Base64;
import org.json.JSONObject;

/** Native multipart orchestration reuses the original server reservation. The
 * shared durable sync journal remains responsible for file/Timeline publication. */
final class NativeUploadJob implements AutoCloseable {
    interface Transport { JSONObject json(String path,JSONObject body) throws Exception; void put(JSONObject signed,Path file,String checksum,long length,int number) throws Exception; }
    interface Progress { void update(long received) throws Exception; }
    private final NativeUploadPartStore parts;
    private final NativeUploadPartStore.Binding binding;
    private final PairingEngine.Check check;
    NativeUploadJob(Path directory,NativeUploadPartStore.Binding binding,PairingEngine.Check check) throws Exception {
        this(directory,binding,check,NativeUploadPartStore.ANDROID);
    }
    NativeUploadJob(Path directory,NativeUploadPartStore.Binding binding,PairingEngine.Check check,NativeUploadPartStore.Disk disk) throws Exception {
        this.binding=binding;this.check=check;parts=new NativeUploadPartStore(directory,check,disk);
    }
    void run(NativeUploadRequest request,NativeUploadSource.Reader reader,Transport transport,PairingEngine.Check authorize,Progress progress) throws Exception {
        check.run();authorize.run();
        if(!binding.owner.matches(request.owner.owner,request.owner.origin)||!binding.root.equals(request.rootId))throw NativeUploadRequest.invalid();
        if(request.verifyPlan(transport.json("/api/v1/attachments/uploads",request.reservation()))) {check.run();authorize.run();for(int n=1;n<=request.partCount;n++)parts.release(binding,request.part(n));progress.update(request.size);return;}
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
        NativeUploadPartStore.Part cached=parts.prepare(binding,part,source);
        String digest=cached.sha256;
        check.run();authorize.run();
        if(!ready) {
            byte[] hash=new byte[32];for(int i=0;i<32;i++)hash[i]=(byte)Integer.parseInt(digest.substring(i*2,i*2+2),16);
            String checksum=Base64.getEncoder().encodeToString(hash);
            JSONObject signed=transport.json("/api/v1/attachments/uploads/parts",new JSONObject().put("uploadId",part.uploadId)
                .put("parts",new org.json.JSONArray().put(new JSONObject().put("partNumber",part.number).put("checksumSha256",checksum))));
            check.run();authorize.run();transport.put(signed,cached.file,checksum,part.length,part.number);
        }
        check.run();if(replay)source.revalidate();authorize.run();check.run();parts.release(binding,part);return digest;
    }
    @Override public void close() throws Exception {parts.close();}
}
