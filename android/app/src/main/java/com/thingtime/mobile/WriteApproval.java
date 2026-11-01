package com.thingtime.mobile;

import org.json.JSONObject;
import java.nio.charset.StandardCharsets;

/** Shared mobile approval fields, projected before persistence or comparison. */
final class WriteApproval {
    final String origin,owner,root,device,revision,hash;
    final Boolean allowTrash;
    WriteApproval(JSONObject value,DeviceScope account) throws Exception {
        JSONObject scope=value.getJSONObject("scope");
        if(value.has("allowTrash") && !(value.get("allowTrash") instanceof Boolean))throw invalid();
        allowTrash=value.has("allowTrash")?value.getBoolean("allowTrash"):null;
        origin=text(scope,"origin",4096);owner=text(scope,"ownerId",128);
        if(!account.matches(owner,origin) || !"home".equals(text(scope,"dataPlane",16))) throw invalid();
        root=text(scope,"rootId",4096);device=text(scope,"deviceId",4096);
        revision=text(value,"configurationRevision",128);hash=text(value,"configurationHash",64);
        if(revision.getBytes(StandardCharsets.UTF_8).length>128 || !hash.matches("[0-9a-f]{64}")) throw invalid();
    }
    private static FolderReader.Failure invalid() { return new FolderReader.Failure("Invalid folder write approval."); }
    private static String text(JSONObject value,String key,int maximum) throws Exception {
        Object raw=value.get(key);
        if(!(raw instanceof String) || ((String)raw).isEmpty() || ((String)raw).length()>maximum) throw invalid();
        String text=(String)raw;
        for(int i=0;i<text.length();i++) {
            char c=text.charAt(i);
            if(Character.isHighSurrogate(c)) { if(++i==text.length() || !Character.isLowSurrogate(text.charAt(i))) throw invalid(); }
            else if(Character.isLowSurrogate(c)) throw invalid();
        }
        return text;
    }
    boolean sameScope(WriteApproval other) { return origin.equals(other.origin) && owner.equals(other.owner) && root.equals(other.root) && device.equals(other.device); }
    boolean matches(WriteApproval other) { return sameScope(other) && revision.equals(other.revision) && hash.equals(other.hash) && java.util.Objects.equals(allowTrash,other.allowTrash); }
    JSONObject json() throws Exception {
        return new JSONObject().put("allowTrash",allowTrash).put("scope",new JSONObject().put("origin",origin).put("ownerId",owner).put("rootId",root).put("deviceId",device).put("dataPlane","home"))
            .put("configurationRevision",revision).put("configurationHash",hash);
    }
}
