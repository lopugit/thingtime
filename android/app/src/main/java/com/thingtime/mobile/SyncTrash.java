package com.thingtime.mobile;

import org.json.JSONObject;
import java.nio.charset.StandardCharsets;

/** Shared native Trash 1.2 fields. A projected immutable request, never a
 * replacement for canonical Timeline history or an independent backup. */
final class SyncTrash {
    private static FolderReader.Failure invalid(){return new FolderReader.Failure("Invalid native recovery request.");}
    static JSONObject request(JSONObject input,DeviceScope owner,String grant) throws Exception {
        if(input.toString().getBytes(StandardCharsets.UTF_8).length>65536)throw invalid();
        JSONObject scope=input.getJSONObject("scope"),operation=input.getJSONObject("operation"),m=operation.getJSONObject("mutation");
        if(!owner.matches(SyncStaging.text(scope,"ownerId",128),SyncStaging.text(scope,"origin",4096)) ||
            !"home".equals(SyncStaging.text(scope,"dataPlane",16)) || !SyncStaging.uuid(input,"rootId").equals(grant) ||
            !Boolean.FALSE.equals(operation.get("confirmed")) || !"trash".equals(m.getString("kind")) || !"local".equals(m.getString("side")))throw invalid();
        String id=SyncStaging.uuid(operation,"id"),path=SyncStaging.text(m,"path",4096);JSONObject expected=SyncStaging.entry(m.getJSONObject("expected"));
        if(!path.equals(expected.getString("path")))throw invalid();
        JSONObject result=new JSONObject().put("rootId",grant).put("scope",new JSONObject().put("origin",owner.origin).put("ownerId",owner.owner)
            .put("dataPlane","home").put("rootId",SyncStaging.text(scope,"rootId",4096)).put("deviceId",SyncStaging.text(scope,"deviceId",4096)))
            .put("operation",new JSONObject().put("id",id).put("confirmed",false).put("mutation",new JSONObject()
                .put("kind","trash").put("side","local").put("path",path).put("expected",expected)));
        if(!input.isNull("parent")) {
            JSONObject p=input.getJSONObject("parent"),entry=SyncStaging.entry(p.getJSONObject("expected"));
            if(!"folder".equals(entry.getString("kind")) || !parent(path).equals(entry.getString("path")))throw invalid();
            JSONObject parent=new JSONObject().put("expected",entry);
            if(!p.isNull("previousOperationId")){String previous=SyncStaging.uuid(p,"previousOperationId");if(id.equals(previous))throw invalid();parent.put("previousOperationId",previous);}
            result.put("parent",parent);
        }
        if(!input.isNull("childrenOperationId")) {
            String previous=SyncStaging.uuid(input,"childrenOperationId");
            if(id.equals(previous) || !"folder".equals(expected.getString("kind")))throw invalid();result.put("childrenOperationId",previous);
        }
        return result;
    }
    static String parent(String path){int slash=path.lastIndexOf('/');return slash<0?"":path.substring(0,slash);}
    static JSONObject mutation(JSONObject request) throws Exception{return request.getJSONObject("operation").getJSONObject("mutation");}
    static JSONObject receipt(JSONObject request) throws Exception{return new JSONObject().put("operationId",request.getJSONObject("operation").getString("id")).put("scope",request.getJSONObject("scope")).put("entry",JSONObject.NULL);}
    static JSONObject restore(JSONObject request,JSONObject input) throws Exception {
        String path=SyncStaging.text(input,"path",4096);FolderReader.path(path);
        JSONObject expected=SyncStaging.entry(input.getJSONObject("expected"));
        if(!expected.getString("path").equals(mutation(request).getString("path")))throw invalid();
        return new JSONObject().put("path",path).put("expected",expected);
    }
    static boolean same(JSONObject a,JSONObject b) throws Exception{return SyncStaging.canonical(a).equals(SyncStaging.canonical(b));}
}
