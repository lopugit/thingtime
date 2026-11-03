package com.thingtime.mobile;

import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;

/** Verify one source with 64 KiB reads and at most 10,000 part digests. Capture
 * each part against that proof before any bytes may leave the native host. */
final class NativeUploadSource {
    interface Read { void run(InputStream input) throws Exception; }
    interface Reader { void read(Read work) throws Exception; }
    private final Reader reader;
    private final PairingEngine.Check check;
    private final long size,partSize;
    private final List<byte[]> digests;
    private final JSONObject entry;
    private NativeUploadSource(Reader reader,PairingEngine.Check check,long size,long partSize,List<byte[]> digests,JSONObject entry) {
        this.reader=reader;this.check=check;this.size=size;this.partSize=partSize;this.digests=digests;this.entry=entry;
    }
    static NativeUploadSource verify(JSONObject input,Reader reader,PairingEngine.Check check) throws Exception {
        JSONObject source=SyncStaging.entry(input);
        if(!"file".equals(source.getString("kind"))||source.isNull("fingerprint"))throw NativeUploadRequest.invalid();
        long size=source.getLong("size"),partSize=source.getJSONObject("fingerprint").getLong("partSizeBytes");
        List<byte[]> digests=new ArrayList<>();MessageDigest composite=MessageDigest.getInstance("SHA-256");
        check.run();reader.read(stream->{
            long at=0,inPart=0;byte[] buffer=new byte[65536];MessageDigest part=MessageDigest.getInstance("SHA-256");
            while(at<size) {
                check.run();int wanted=(int)Math.min(buffer.length,Math.min(size-at,partSize-inPart));
                int count=stream.read(buffer,0,wanted);if(count<=0)throw NativeUploadRequest.invalid();
                part.update(buffer,0,count);at+=count;inPart+=count;
                if(inPart==partSize || at==size) {byte[] digest=part.digest();digests.add(digest);composite.update(digest);inPart=0;}
            }
            check.run();if(stream.read()!=-1)throw NativeUploadRequest.invalid();
        });
        check.run();if(digests.size()!=source.getJSONObject("fingerprint").getInt("partCount") ||
            !FolderReader.hex(composite.digest()).equals(source.getJSONObject("fingerprint").getString("sha256")))throw NativeUploadRequest.invalid();
        return new NativeUploadSource(reader,check,size,partSize,digests,source);
    }
    void matches(JSONObject source) throws Exception {
        if(!SyncStaging.canonical(entry).equals(SyncStaging.canonical(source)))throw NativeUploadRequest.invalid();
    }
    String digest(int number) throws Exception {
        if(number<1||number>digests.size())throw NativeUploadRequest.invalid();return FolderReader.hex(digests.get(number-1));
    }
    void revalidate() throws Exception {verify(entry,reader,check);}
    String capture(int number,OutputStream output) throws Exception {
        if(number<1||number>digests.size())throw NativeUploadRequest.invalid();
        long offset=(long)(number-1)*partSize,length=Math.min(partSize,size-offset);
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        check.run();reader.read(stream->{
            long remaining=offset;
            while(remaining>0) {
                check.run();long skipped=stream.skip(remaining);
                if(skipped<0||skipped>remaining)throw NativeUploadRequest.invalid();
                if(skipped==0){if(stream.read()<0)throw NativeUploadRequest.invalid();skipped=1;}remaining-=skipped;
            }
            byte[] buffer=new byte[65536];long written=0;
            while(written<length) {
                check.run();int count=stream.read(buffer,0,(int)Math.min(buffer.length,length-written));
                if(count<=0)throw NativeUploadRequest.invalid();hash.update(buffer,0,count);output.write(buffer,0,count);written+=count;
            }
            check.run();if(offset+length==size&&stream.read()!=-1)throw NativeUploadRequest.invalid();
        });
        check.run();byte[] actual=hash.digest();if(!Arrays.equals(actual,digests.get(number-1)))throw NativeUploadRequest.invalid();
        return FolderReader.hex(actual);
    }
}
