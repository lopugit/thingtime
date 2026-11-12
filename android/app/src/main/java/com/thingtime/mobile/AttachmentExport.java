package com.thingtime.mobile;

import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;

/** Exact attachment reads only. No caller URLs, redirects, or storage credentials. */
final class AttachmentExport {
    static final int RANGE_BYTES=2*1024*1024;
    final String id,version,name;
    final long size,partSize;
    final JSONObject entry;
    AttachmentExport(JSONObject payload) throws Exception {
        name=payload.getString("name");
        if(name.isBlank() || name.length()>255 || name.equals(".") || name.equals("..") || name.matches(".*[\\\\/\\p{Cntrl}].*")) throw invalid();
        JSONObject content=payload.getJSONObject("content");
        id=content.getString("attachmentId");version=content.getString("version");
        if(!id.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,199}") || !version.matches("[a-f0-9]{64}")) throw invalid();
        entry=SyncStaging.entry(new JSONObject().put("path",name).put("kind","file").put("id",id).put("version",version)
            .put("size",content.get("size")).put("fingerprint",content.getJSONObject("fingerprint")).put("sha256",JSONObject.NULL));
        size=entry.getLong("size");partSize=entry.getJSONObject("fingerprint").getLong("partSizeBytes");
    }
    private static IOException invalid() { return new IOException("Invalid file version."); }
    String fingerprintPath() { return "/api/v1/attachments/content?id="+id+"&fingerprint=1"; }
    void match(JSONObject result) throws Exception {
        if(!Boolean.TRUE.equals(result.opt("ok")) || !id.equals(result.optString("id")) || !version.equals(result.optString("version")) ||
            SyncStaging.integer(result,"size",9007199254740991L)!=size ||
            !SyncStaging.canonical(entry.getJSONObject("fingerprint")).equals(SyncStaging.canonical(result.getJSONObject("fingerprint")))) throw invalid();
    }
    interface RangeReader { InputStream open(long offset,int length) throws Exception; }
    /** Buffered by one small frame; fingerprint boundaries need not match HTTP ranges. */
    void download(OutputStream output,RangeReader source,PairingEngine.Check check) throws Exception {
        MessageDigest whole=MessageDigest.getInstance("SHA-256"),part=MessageDigest.getInstance("SHA-256");
        long at=0,inPart=0;byte[] bytes=new byte[64*1024];
        while(at<size) {
            int length=(int)Math.min(RANGE_BYTES,size-at),received=0;
            check.run();
            try(InputStream input=source.open(at,length)) {
                while(received<length) {
                    check.run();int wanted=(int)Math.min(bytes.length,Math.min(length-received,partSize-inPart));
                    int count=input.read(bytes,0,wanted);check.run();if(count<=0)throw invalid();
                    output.write(bytes,0,count);part.update(bytes,0,count);at+=count;inPart+=count;received+=count;
                    if(inPart==partSize || at==size) { whole.update(part.digest());inPart=0; }
                }
                check.run();if(input.read()!=-1)throw invalid();
            }
        }
        check.run();if(!FolderReader.hex(whole.digest()).equals(entry.getJSONObject("fingerprint").getString("sha256")))throw invalid();
    }
    /** Also used to read back the actual provider document before reporting success. */
    void verify(InputStream input,PairingEngine.Check check) throws Exception {
        MessageDigest whole=MessageDigest.getInstance("SHA-256"),part=MessageDigest.getInstance("SHA-256");
        long at=0,inPart=0;byte[] bytes=new byte[64*1024];
        while(at<size) {
            check.run();int count=input.read(bytes,0,(int)Math.min(bytes.length,Math.min(size-at,partSize-inPart)));
            if(count<=0)throw invalid();part.update(bytes,0,count);at+=count;inPart+=count;
            if(inPart==partSize || at==size){whole.update(part.digest());inPart=0;}
        }
        check.run();if(input.read()!=-1 || !FolderReader.hex(whole.digest()).equals(entry.getJSONObject("fingerprint").getString("sha256")))throw invalid();
    }
    InputStream range(DeviceScope scope,String cookie,long offset,int length,PairingEngine.Check check) throws Exception {
        if(offset<0 || length<=0 || length>RANGE_BYTES || offset>size-length)throw invalid();
        HttpURLConnection connection=(HttpURLConnection)new URL(scope.origin+"/api/v1/attachments/content?id="+id+"&range=1&version="+version+"&offset="+offset+"&length="+length).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);
            connection.setRequestProperty("Cookie",cookie);connection.setRequestProperty("Origin",scope.origin);
            connection.setRequestProperty("X-Thingtime-Expected-Actor",scope.owner);connection.setRequestProperty("X-Thingtime-Expected-Data-Plane","home");
            connection.setRequestProperty("Accept-Encoding","identity");check.run();
            int status=connection.getResponseCode();check.run();
            String encoding=connection.getHeaderField("Content-Encoding"),lengthHeader=connection.getHeaderField("Content-Length");
            if(status!=206 || !("\""+version+"\"").equals(connection.getHeaderField("ETag")) ||
                !("bytes "+offset+"-"+(offset+length-1)+"/"+size).equals(connection.getHeaderField("Content-Range")) ||
                (lengthHeader!=null && !Integer.toString(length).equals(lengthHeader)) || (encoding!=null && !encoding.equals("identity"))) throw invalid();
            return new FilterInputStream(connection.getInputStream()) {
                @Override public void close() throws IOException { try { super.close(); } finally { connection.disconnect(); } }
            };
        } catch(Exception error) { connection.disconnect();throw error; }
    }
}
