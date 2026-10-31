package com.thingtime.mobile;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class SyncStagingContractTest {
    private static final String GRANT="00000000-0000-4000-8000-000000000001";
    private DeviceScope owner() throws Exception { return new DeviceScope("owner","https://sync.test",false); }
    private JSONObject request() throws Exception {
        return new JSONObject("""
            {"rootId":"00000000-0000-4000-8000-000000000001",
             "scope":{"ownerId":"owner","origin":"https://sync.test","dataPlane":"home","rootId":"configuration","deviceId":"device"},
             "operation":{"id":"00000000-0000-4000-8000-000000000002","confirmed":false,
               "mutation":{"kind":"copy","from":"remote","path":"nested/file",
                 "source":{"path":"nested/file","id":"file","version":"v1","kind":"file","size":3,
                   "sha256":"039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"}}}}
            """);
    }
    private JSONObject source(JSONObject r) throws Exception { return r.getJSONObject("operation").getJSONObject("mutation").getJSONObject("source"); }
    @Test public void optionalNullsKeyOrderAndIntegralEncodingsHaveOneBinding() throws Exception {
        JSONObject a=request(),b=request();source(b).put("size",3.0).put("fingerprint",JSONObject.NULL);
        b.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",JSONObject.NULL);
        assertEquals(SyncStaging.canonical(SyncStaging.request(a,owner(),GRANT)),SyncStaging.canonical(SyncStaging.request(b,owner(),GRANT)));
        assertEquals(SyncStaging.key(a),SyncStaging.key(b));
    }
    @Test public void coercibleStringsAndUnsafeNumbersAreRejected() throws Exception {
        for(Object value:new Object[]{"3",-1,1.5,9007199254740992L,true,JSONObject.NULL}) {
            JSONObject r=request();source(r).put("size",value);assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
        }
        for(Object value:new Object[]{"false",0,true,JSONObject.NULL}) {
            JSONObject r=request();r.getJSONObject("operation").put("confirmed",value);assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
        }
        JSONObject r=request();source(r).put("id",12);assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
    }
    @Test public void invalidPathsIdsAndScopeCannotReachStorage() throws Exception {
        for(String path:new String[]{"../file","/file","a//b","a\\b","a/.","a/\u202eb",String.valueOf((char)0xd800)}) {
            JSONObject r=request();source(r).put("path",path);r.getJSONObject("operation").getJSONObject("mutation").put("path",path);
            assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
        }
        for(String field:new String[]{"ownerId","origin","dataPlane"}) {
            JSONObject r=request();r.getJSONObject("scope").put(field,"elsewhere");assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
        }
        JSONObject r=request();r.getJSONObject("operation").put("id","1-1-1-1-1");assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
    }
    @Test public void fingerprintsMustUseCanonicalPartSizingAndOneDigestKind() throws Exception {
        JSONObject base=request();source(base).remove("sha256");
        source(base).put("fingerprint",new JSONObject().put("algorithm","sha256-parts-v1").put("partSizeBytes",8388608)
            .put("partCount",1).put("sha256","a".repeat(64)));
        SyncStaging.request(base,owner(),GRANT);
        for(String field:new String[]{"algorithm","partSizeBytes","partCount","sha256"}) {
            JSONObject r=new JSONObject(base.toString());source(r).getJSONObject("fingerprint").put(field,field.equals("algorithm")?"sha256":field.equals("sha256")?"bad":2);
            assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
        }
        source(base).put("sha256","b".repeat(64));assertThrows(Exception.class,()->SyncStaging.request(base,owner(),GRANT));
    }
    @Test public void destructiveOperationsAndMismatchedExpectedTargetsAreRejected() throws Exception {
        for(String field:new String[]{"kind","from","path"}) {
            JSONObject r=request();r.getJSONObject("operation").getJSONObject("mutation").put(field,field.equals("kind")?"delete":field.equals("from")?"local":"different");
            assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
        }
        JSONObject r=request(),before=new JSONObject(source(r).toString()).put("path","different");
        r.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",before);
        assertThrows(Exception.class,()->SyncStaging.request(r,owner(),GRANT));
        before.put("path","nested/file");SyncStaging.request(r,owner(),GRANT);
    }
}
