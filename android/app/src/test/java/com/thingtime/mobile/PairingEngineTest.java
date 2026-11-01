package com.thingtime.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;
import java.util.*;
import java.time.Instant;

public class PairingEngineTest {
    final DeviceScope scope;
    public PairingEngineTest() throws Exception { scope=new DeviceScope("owner","https://thingtime.test",false); }
    static class Memory implements PairingEngine.Store {
        String bytes;
        public JSONObject load(DeviceScope scope) throws Exception { return bytes==null?null:new JSONObject(bytes); }
        public void save(DeviceScope scope,JSONObject value) { bytes=value.toString(); }
    }
    final class Server implements PairingEngine.Transport {
        int creates,prepares,completes,publishes; boolean loseResponse,revoked,wrongOwner,oldManifest; String firstComplete; long lastRevision;
        public JSONObject request(DeviceScope s,String path,String bytes,String credential,boolean authenticated) throws Exception {
            if(path.contains("well-known")) {
                JSONObject features=new JSONObject(); for(Map.Entry<String,String> e:PairingEngine.REQUIREMENTS.entrySet()) features.put(e.getKey(),new JSONObject().put("version",oldManifest?"0.0.0":e.getValue()));
                return new JSONObject().put("schemaVersion",1).put("origin",scope.origin).put("features",features);
            }
            if(path.endsWith("auth/me")) { assertTrue(authenticated); assertNull(credential); return new JSONObject().put("user",new JSONObject().put("id",wrongOwner?"other":scope.owner).put("accountKind","user")); }
            JSONObject body=new JSONObject(bytes);
            if(path.endsWith("/pairing")) {
                assertTrue(authenticated); creates++; return new JSONObject().put("ownerId",scope.owner).put("pairing",new JSONObject().put("pairingSecret","ttpair_"+PairingEngine.base64(new byte[32])).put("expiresAt",Instant.now().plusSeconds(120).toString()));
            }
            assertFalse(authenticated);
            if(path.endsWith("/claim") && body.getString("op").equals("prepare")) {
                prepares++; return new JSONObject().put("proof",new JSONObject().put("pairingId","pairing").put("serverNonce",PairingEngine.base64(new byte[32])).put("expiresAt",Instant.now().plusSeconds(120).toString()));
            }
            if(path.endsWith("/claim")) {
                completes++; if(firstComplete==null) firstComplete=bytes; else assertEquals(firstComplete,bytes);
                JSONObject proof=body.getJSONObject("proof"),claim=new JSONObject(body.toString());
                for(String key:new String[]{"pairingId","publicKey","nonce","serverNonce"}) claim.put(key,proof.getString(key));
                verifySignature(claim,Base64.getUrlDecoder().decode(proof.getString("signature")));
                if(loseResponse) { loseResponse=false; throw new java.io.IOException("Lost completion response"); }
                return new JSONObject().put("credentialStored",true).put("device",new JSONObject().put("id","device-one").put("platform","android"));
            }
            assertTrue(path.endsWith("/node/state")); assertTrue(credential.startsWith("ttnode_"));
            assertTrue(body.getLong("revision")>lastRevision); lastRevision=body.getLong("revision"); publishes++;
            if(revoked) throw new PairingEngine.Failure("revoked",401);
            return new JSONObject().put("ok",true);
        }
    }
    static JSONObject descriptor() throws Exception { return new JSONObject().put("name","Android 📱").put("model","Pixel").put("osVersion","15").put("appVersion","1.0"); }
    static void verifySignature(JSONObject claim,byte[] signature) throws Exception {
        Ed25519Signer verifier=new Ed25519Signer(); verifier.init(false,new Ed25519PublicKeyParameters(Base64.getUrlDecoder().decode(claim.getString("publicKey")),0));
        byte[] bytes=PairingEngine.canonical(claim); verifier.update(bytes,0,bytes.length); assertTrue(verifier.verifySignature(signature));
    }
    @Test public void sharedIosServerSignatureVector() throws Exception {
        JSONObject vector;
        try(java.io.InputStream input=getClass().getResourceAsStream("/mobile-pairing-vector.json")) { assertNotNull(input); vector=new JSONObject(new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)); }
        assertArrayEquals(Base64.getDecoder().decode(vector.getString("canonicalBase64")),PairingEngine.canonical(vector.getJSONObject("claim")));
        verifySignature(vector.getJSONObject("claim"),Base64.getDecoder().decode(vector.getString("signature")));
    }
    @Test public void lostResponseReopensExactCompletionAndSameDevice() throws Exception {
        Memory memory=new Memory(); Server server=new Server(); server.loseResponse=true;
        try { new PairingEngine(memory,server,()->{}).pair(scope,descriptor()); fail(); } catch(java.io.IOException expected) { }
        assertNotNull(new JSONObject(memory.bytes).getString("completeBody"));
        JSONObject changed=descriptor().put("name","New name after restart");
        assertEquals("device-one",new PairingEngine(memory,server,()->{}).pair(scope,changed).getString("deviceId"));
        assertEquals(1,server.creates); assertEquals(1,server.prepares); assertEquals(2,server.completes);
        assertEquals("paired",new PairingEngine(memory,server,()->{}).status(scope).getString("state")); assertEquals(2,server.publishes);
    }
    @Test public void accountChangeBlocksMutations() throws Exception {
        Memory memory=new Memory(); Server server=new Server(); server.wrongOwner=true;
        assertThrows(PairingEngine.Failure.class,()->new PairingEngine(memory,server,()->{}).pair(scope,descriptor())); assertNull(memory.bytes); assertEquals(0,server.creates);
    }
    @Test public void unsupportedDestinationBlocksMutations() throws Exception {
        Memory memory=new Memory(); Server server=new Server(); server.oldManifest=true;
        assertThrows(PairingEngine.Failure.class,()->new PairingEngine(memory,server,()->{}).pair(scope,descriptor())); assertNull(memory.bytes); assertEquals(0,server.creates);
    }
    @Test public void cancellationAfterChallengeCannotSaveOrPrepare() throws Exception {
        Memory memory=new Memory(); Server server=new Server();
        PairingEngine.Check check=()->{ if(server.creates>0) throw new java.util.concurrent.CancellationException(); };
        assertThrows(java.util.concurrent.CancellationException.class,()->new PairingEngine(memory,server,check).pair(scope,descriptor()));
        assertNull(memory.bytes); assertEquals(0,server.prepares);
    }
    @Test public void revokedDeviceStaysRevokedUntilExplicitPair() throws Exception {
        Memory memory=new Memory(); Server server=new Server(); PairingEngine engine=new PairingEngine(memory,server,()->{});
        engine.pair(scope,descriptor()); server.revoked=true;
        assertEquals("revoked",engine.status(scope).getString("state")); int count=server.publishes;
        assertEquals("revoked",engine.status(scope).getString("state")); assertEquals(count,server.publishes);
    }
    @Test public void savedAccountMismatchFailsClosed() throws Exception {
        Memory memory=new Memory(); Server server=new Server(); memory.bytes=new JSONObject().put("schema",1).put("owner","other").put("origin",scope.origin).put("revision",0).toString();
        assertThrows(PairingEngine.Failure.class,()->new PairingEngine(memory,server,()->{}).pair(scope,descriptor())); assertEquals(0,server.creates);
    }
    @Test public void originsAreCanonicalAndIsolated() throws Exception {
        assertEquals("https://thingtime.test",DeviceScope.origin("https://THINGTIME.test:443/path?q=x",false));
        assertThrows(Exception.class,()->DeviceScope.origin("http://thingtime.test",true));
        assertThrows(Exception.class,()->DeviceScope.origin("https://user:pass@thingtime.test",false));
        assertThrows(Exception.class,()->DeviceScope.origin("http://localhost:14900",false));
        assertEquals("http://127.0.0.1:14900",DeviceScope.origin("http://127.0.0.1:14900",true));
        assertNotEquals(scope.key(),new DeviceScope("other",scope.origin,false).key());
        assertNotEquals(scope.key(),new DeviceScope(scope.owner,"https://other.test",false).key());
    }
    @Test public void capabilityVersionsRequireCompatibleMajor() {
        assertTrue(PairingEngine.compatible("1.10.1","1.10.0")); assertFalse(PairingEngine.compatible("2.0.0","1.10.0"));
        assertFalse(PairingEngine.compatible("1.9.9","1.10.0")); assertFalse(PairingEngine.compatible("1.10.0-preview","1.10.0"));
    }
}
