package com.thingtime.mobile;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.text.Normalizer;
import java.util.HashSet;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/** The existing shared native upload contract. A reviewed Thing describes work;
 * it never replaces current account, device, grant or network authorization. */
final class NativeUploadRequest {
    final JSONObject source,configuration;
    final String uploadId,operationId,connectionId,revision,deviceId,rootId;
    final DeviceScope owner;
    final long size,partSize;
    final int partCount;
    NativeUploadRequest(JSONObject input,DeviceScope owner,String rootId,boolean photos) throws Exception {
        if(input.toString().getBytes(StandardCharsets.UTF_8).length>32768)throw invalid();
        this.owner=owner;this.rootId=rootId;
        uploadId=id(input,"uploadId");operationId=id(input,"requestId");
        source=SyncStaging.entry(input.getJSONObject("source"));size=source.getLong("size");
        if(!source.getString("kind").equals("file") || size<1 || source.isNull("fingerprint"))throw invalid();
        JSONObject fingerprint=source.getJSONObject("fingerprint");
        partSize=fingerprint.getLong("partSizeBytes");partCount=fingerprint.getInt("partCount");
        JSONObject approval=input.getJSONObject("authorization"),scope=approval.getJSONObject("scope");
        connectionId=id(approval,"id");revision=SyncStaging.text(approval,"updatedAt",128);Instant.parse(revision);
        deviceId=id(scope,"deviceId");
        if(!owner.matches(SyncStaging.text(scope,"ownerId",128),SyncStaging.text(scope,"origin",4096)) ||
            !"home".equals(scope.getString("dataPlane")) || !connectionId.equals(id(scope,"rootId")))throw invalid();
        configuration=configuration(approval.getJSONObject("configuration"));
        if(!deviceId.equals(configuration.getString("deviceId")) || !rootId.equals(configuration.getString("localRootId")) ||
            photos != "photos".equals(configuration.optString("sourceKind")) || configuration.getBoolean("paused") ||
            "download".equals(configuration.getString("mode")))throw invalid();
    }
    static FolderReader.Failure invalid() {return new FolderReader.Failure("The native upload request or connection changed. Review the connection and retry.");}
    static String id(JSONObject value,String key) throws Exception {
        String result=SyncStaging.text(value,key,200);if(!result.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,199}"))throw invalid();return result;
    }
    static JSONObject configuration(JSONObject value) throws Exception {
        if(value.toString().getBytes(StandardCharsets.UTF_8).length>24576 || SyncStaging.integer(value,"configurationVersion",1)!=1)throw invalid();
        String name=SyncStaging.text(value,"name",120);
        if(!name.equals(name.trim()) || name.codePoints().anyMatch(c->Character.isISOControl(c)||Character.getType(c)==Character.FORMAT))throw invalid();
        JSONObject c=new JSONObject().put("configurationVersion",1).put("name",name)
            .put("deviceId",id(value,"deviceId")).put("localRootId",id(value,"localRootId")).put("remoteFolderId",id(value,"remoteFolderId"));
        for(String key:new String[]{"paused","propagateDeletes","chargingOnly"}) {
            if(!(value.get(key) instanceof Boolean))throw invalid();c.put(key,value.getBoolean(key));
        }
        String mode=SyncStaging.text(value,"mode",16),network=SyncStaging.text(value,"network",16);
        if(!java.util.Arrays.asList("upload","download","two-way","backup").contains(mode) ||
            !java.util.Arrays.asList("wifi","any").contains(network) || mode.equals("backup")&&c.getBoolean("propagateDeletes"))throw invalid();
        c.put("mode",mode).put("network",network);
        if(value.has("sourceKind")) {
            String kind=SyncStaging.text(value,"sourceKind",16);
            if(!kind.equals("folder")&&!kind.equals("photos") || kind.equals("photos")&&(!mode.equals("backup")||c.getBoolean("propagateDeletes")))throw invalid();
            c.put("sourceKind",kind);
        }
        JSONArray exclusions=value.getJSONArray("excludedPaths"),copy=new JSONArray();int bytes=0;HashSet<String> paths=new HashSet<>();
        if(exclusions.length()>100)throw invalid();
        for(int i=0;i<exclusions.length();i++) {
            Object entry=exclusions.get(i);if(!(entry instanceof String))throw invalid();String path=(String)entry;
            FolderReader.path(path);bytes+=path.getBytes(StandardCharsets.UTF_8).length;
            if(bytes>16384 || !paths.add(Normalizer.normalize(path,Normalizer.Form.NFC).toLowerCase(Locale.ROOT)))throw invalid();copy.put(path);
        }
        c.put("excludedPaths",copy);
        // Unknown policy fields must never be silently discarded by the native host.
        if(c.length()!=value.length())throw invalid();return c;
    }
    void authorize(JSONObject response,String network,Boolean charging,String currentDevice) throws Exception {
        if(!Boolean.TRUE.equals(response.opt("ok")) || !deviceId.equals(currentDevice))throw invalid();
        JSONObject row=response.getJSONObject("thing");
        if(!connectionId.equals(row.getString("id")) || !revision.equals(row.getString("updatedAt")) ||
            !owner.owner.equals(row.getJSONObject("author").getString("id")) || !row.isNull("appId") || !row.isNull("targetId") ||
            !SyncStaging.canonical(row.getJSONArray("acl")).equals("[\"tt:user\"]") ||
            !SyncStaging.canonical(row.getJSONArray("thingtime")).equals("[\"file-sync\"]") ||
            !SyncStaging.canonical(configuration(row.getJSONObject("crystal"))).equals(SyncStaging.canonical(configuration)))throw invalid();
        conditions(network,charging);
    }
    void conditions(String network,Boolean charging) throws Exception {
        if(!java.util.Arrays.asList("wifi","cellular","ethernet").contains(network) || configuration.getString("network").equals("wifi")&&!network.equals("wifi") ||
            configuration.getBoolean("chargingOnly")&&!Boolean.TRUE.equals(charging))
            throw new FolderReader.Failure("Upload paused. Check the connection's network and charging settings.");
    }
    long offset(int part) throws Exception { if(part<1||part>partCount)throw invalid();return (long)(part-1)*partSize; }
    long length(int part) throws Exception {return Math.min(partSize,size-offset(part));}
    boolean verifyPlan(JSONObject response) throws Exception {
        JSONObject upload=response.getJSONObject("upload");
        if(!Boolean.TRUE.equals(response.opt("ok")) || !uploadId.equals(upload.getString("id")) ||
            SyncStaging.integer(upload,"partSizeBytes",Long.MAX_VALUE)!=partSize || SyncStaging.integer(upload,"partCount",10000)!=partCount)throw invalid();
        return "ready".equals(upload.optString("state"));
    }
    JSONObject reservation() throws Exception {String path=source.getString("path");return new JSONObject().put("requestId",operationId)
        .put("filename",path.substring(path.lastIndexOf('/')+1)).put("contentType","application/octet-stream").put("sizeBytes",size).put("purpose","file");}
    Part part(int number) throws Exception {return new Part(new JSONObject().put("source",source).put("uploadId",uploadId).put("requestId",operationId)
        .put("partNumber",number).put("offset",offset(number)).put("length",length(number)));}
    static final class Part {
        final JSONObject source;final String uploadId,operationId;final int number;final long offset,length,size,partSize;final int partCount;
        Part(JSONObject input) throws Exception {
            if(input.toString().getBytes(StandardCharsets.UTF_8).length>32768)throw invalid();
            source=SyncStaging.entry(input.getJSONObject("source"));uploadId=id(input,"uploadId");operationId=id(input,"requestId");size=source.getLong("size");
            if(!source.getString("kind").equals("file") || size<1 || source.isNull("fingerprint"))throw invalid();
            JSONObject fingerprint=source.getJSONObject("fingerprint");partSize=fingerprint.getLong("partSizeBytes");partCount=fingerprint.getInt("partCount");
            number=(int)SyncStaging.integer(input,"partNumber",partCount);offset=SyncStaging.integer(input,"offset",9007199254740991L);length=SyncStaging.integer(input,"length",partSize);
            if(number<1 || offset!=(long)(number-1)*partSize || length!=Math.min(partSize,size-offset))throw invalid();
        }
        JSONObject reservation() throws Exception {String path=source.getString("path");return new JSONObject().put("requestId",operationId)
            .put("filename",path.substring(path.lastIndexOf('/')+1)).put("contentType","application/octet-stream").put("sizeBytes",size).put("purpose","file");}
        boolean verifyPlan(JSONObject response) throws Exception {
            JSONObject upload=response.getJSONObject("upload");
            if(!Boolean.TRUE.equals(response.opt("ok")) || !uploadId.equals(upload.getString("id")) ||
                SyncStaging.integer(upload,"partSizeBytes",Long.MAX_VALUE)!=partSize || SyncStaging.integer(upload,"partCount",10000)!=partCount)throw invalid();
            return "ready".equals(upload.optString("state"));
        }
        JSONObject result(String digest) throws Exception {return new JSONObject().put("uploadId",uploadId).put("requestId",operationId)
            .put("partNumber",number).put("offset",offset).put("length",length).put("version",source.getString("version")).put("size",size).put("sha256",digest);}
    }
    JSONObject result() throws Exception {return new JSONObject().put("uploadId",uploadId).put("requestId",operationId)
        .put("version",source.getString("version")).put("size",size).put("fingerprint",source.getJSONObject("fingerprint"));}
}
