package com.thingtime.mobile;
import org.json.*;
import java.io.*;
import java.util.*;

final class NativeUploadFixture implements FolderReader.Provider {
    byte[] bytes;
    long modified=1,readBytes;
    int maxRead;
    String fileId="file";
    final DeviceScope owner;
    final String root="11111111-1111-4111-8111-111111111111";
    final JSONObject input;
    final FolderReader reader;
    NativeUploadFixture(int size) throws Exception {
        bytes=new byte[size];new Random(21).nextBytes(bytes);owner=new DeviceScope("owner","https://sync.test",false);
        reader=new FolderReader(this,()->{});JSONObject source=reader.scan().getJSONObject(0);
        JSONObject configuration=new JSONObject().put("configurationVersion",1).put("name","Folder").put("deviceId","device")
            .put("localRootId",root).put("remoteFolderId","folder").put("mode","upload").put("paused",false).put("propagateDeletes",false)
            .put("network","wifi").put("chargingOnly",false).put("excludedPaths",new JSONArray());
        JSONObject scope=new JSONObject().put("ownerId",owner.owner).put("origin",owner.origin).put("deviceId","device").put("rootId","connection").put("dataPlane","home");
        input=new JSONObject().put("source",source).put("uploadId","attachment").put("requestId","original-operation")
            .put("authorization",new JSONObject().put("id","connection").put("updatedAt","2026-10-18T00:00:00.000Z").put("scope",scope).put("configuration",configuration));
        readBytes=0;maxRead=0;
    }
    NativeUploadRequest request() throws Exception{return new NativeUploadRequest(input,owner,root,false);}
    JSONObject row() throws Exception{return new JSONObject().put("ok",true).put("thing",new JSONObject().put("id","connection")
        .put("updatedAt","2026-10-18T00:00:00.000Z").put("author",new JSONObject().put("id",owner.owner))
        .put("acl",new JSONArray().put("tt:user")).put("thingtime",new JSONArray().put("file-sync"))
        .put("crystal",new JSONObject(input.getJSONObject("authorization").getJSONObject("configuration").toString())));}
    @Override public FolderReader.Doc root(){return new FolderReader.Doc("root","Folder",true,0,1);}
    @Override public FolderReader.Doc stat(String id){return id.equals("root")?root():new FolderReader.Doc(fileId,"file.bin",false,bytes.length,modified);}
    @Override public List<FolderReader.Doc> children(String id){return id.equals("root")?List.of(stat(fileId)):List.of();}
    @Override public InputStream open(String id){return new ByteArrayInputStream(bytes){
        @Override public synchronized int read(byte[] b,int at,int length){maxRead=Math.max(maxRead,length);int n=super.read(b,at,length);if(n>0)readBytes+=n;return n;}
    };}
}
