package com.thingtime.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;

public class WriteApprovalTest {
    private DeviceScope owner() throws Exception { return new DeviceScope("owner","https://folder.test",false); }
    private JSONObject value() throws Exception {
        return new JSONObject().put("scope",new JSONObject().put("ownerId","owner").put("origin","https://folder.test").put("dataPlane","home").put("rootId","root").put("deviceId","device"))
            .put("configurationRevision","revision").put("configurationHash","a".repeat(64));
    }
    @Test public void projectsSharedFieldsAndComparesSemanticIdentity() throws Exception {
        JSONObject raw=value().put("untrustedExtra","ignored");WriteApproval a=new WriteApproval(raw,owner());
        assertFalse(a.json().has("untrustedExtra"));assertTrue(a.matches(new WriteApproval(a.json(),owner())));
        assertFalse(a.matches(new WriteApproval(value().put("configurationRevision","other"),owner())));
        JSONObject other=value();other.getJSONObject("scope").put("deviceId","other");assertFalse(a.sameScope(new WriteApproval(other,owner())));
    }
    @Test public void rejectsWrongOwnerOriginPlaneAndMalformedFields() throws Exception {
        for(String key:new String[]{"ownerId","origin","dataPlane"}) {
            JSONObject raw=value();raw.getJSONObject("scope").put(key,"elsewhere");assertThrows(Exception.class,()->new WriteApproval(raw,owner()));
        }
        for(Object invalid:new Object[]{42,JSONObject.NULL,"","x".repeat(129),"é".repeat(65),"\uD800"}) {
            JSONObject raw=value().put("configurationRevision",invalid);assertThrows(Exception.class,()->new WriteApproval(raw,owner()));
        }
        for(String invalid:new String[]{"A".repeat(64),"a".repeat(63),"z".repeat(64)}) {
            JSONObject raw=value().put("configurationHash",invalid);assertThrows(Exception.class,()->new WriteApproval(raw,owner()));
        }
        for(String key:new String[]{"rootId","deviceId"}) {
            JSONObject raw=value();raw.getJSONObject("scope").put(key,42);assertThrows(Exception.class,()->new WriteApproval(raw,owner()));
        }
    }
}
