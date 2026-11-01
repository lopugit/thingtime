package com.thingtime.mobile;

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

/** The wire protocol is shared with the server and iOS; this adapter owns no UI. */
final class PairingEngine {
    interface Store { JSONObject load(DeviceScope scope) throws Exception; void save(DeviceScope scope, JSONObject record) throws Exception; }
    interface Transport { JSONObject request(DeviceScope scope, String path, String body, String credential, boolean authenticated) throws Exception; }
    interface Check { void run() throws Exception; }
    static final class Failure extends Exception {
        final int status;
        Failure(String message) { this(message, 0); }
        Failure(String message, int status) { super(message); this.status = status; }
    }
    static final Map<String,String> REQUIREMENTS = new LinkedHashMap<>();
    static {
        REQUIREMENTS.put("api.auth-me", "1.0.0"); REQUIREMENTS.put("api.devices", "1.13.0");
        REQUIREMENTS.put("api.devices-pairing", "1.0.0"); REQUIREMENTS.put("api.devices-pairing-claim", "1.2.0");
        REQUIREMENTS.put("api.devices-node-state", "1.9.0");
    }
    private final Store store; private final Transport transport; private final Check check;
    PairingEngine(Store store, Transport transport, Check check) { this.store=store; this.transport=transport; this.check=check; }
    private JSONObject request(DeviceScope scope, String path, JSONObject body, String credential, boolean auth) throws Exception {
        return requestBytes(scope, path, body == null ? null : body.toString(), credential, auth);
    }
    private JSONObject requestBytes(DeviceScope scope, String path, String body, String credential, boolean auth) throws Exception {
        check.run(); JSONObject result = transport.request(scope, path, body, credential, auth); check.run(); return result;
    }
    void identity(DeviceScope scope) throws Exception {
        JSONObject me = request(scope,"/api/v1/auth/me",null,null,true).optJSONObject("user");
        if (me==null || !scope.owner.equals(me.optString("id")) || !"user".equals(me.optString("accountKind")) || me.optBoolean("temporary")) {
            throw new Failure("Your account changed. Reopen Things and try again.");
        }
    }
    private void verify(DeviceScope scope) throws Exception {
        JSONObject manifest = request(scope,"/.well-known/thingtime-capabilities.json",null,null,false);
        JSONObject features=manifest.optJSONObject("features");
        if (manifest.optInt("schemaVersion")!=1 || !scope.origin.equals(manifest.optString("origin")) || features==null) throw incompatible();
        for (Map.Entry<String,String> entry: REQUIREMENTS.entrySet()) {
            JSONObject feature=features.optJSONObject(entry.getKey());
            if (feature==null || !compatible(feature.optString("version"),entry.getValue())) throw incompatible();
        }
        identity(scope);
    }
    static boolean compatible(String version,String minimum) {
        if (!version.matches("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")) return false;
        try {
            String[] a=version.split("\\."),b=minimum.split("\\.");
            int major=Integer.parseInt(a[0]),minor=Integer.parseInt(a[1]),patch=Integer.parseInt(a[2]);
            return major==Integer.parseInt(b[0]) && (minor>Integer.parseInt(b[1]) || (minor==Integer.parseInt(b[1]) && patch>=Integer.parseInt(b[2])));
        } catch (RuntimeException e) { return false; }
    }
    private static Failure incompatible() { return new Failure("This destination does not support mobile pairing yet."); }
    private JSONObject load(DeviceScope scope) throws Exception {
        check.run(); JSONObject value=store.load(scope); check.run();
        if (value!=null && (!scope.matches(value.optString("owner"),value.optString("origin")) || value.optInt("schema")!=1)) throw new Failure("The saved account does not match.");
        if (value!=null && (value.optLong("revision",-1)<0 || value.optLong("revision")>=9_007_199_254_740_991L)) throw new Failure("Invalid saved device revision.");
        return value;
    }
    private void save(DeviceScope scope,JSONObject value) throws Exception { check.run(); store.save(scope,value); check.run(); }
    private static JSONObject status(String state,String id) throws Exception { return new JSONObject().put("state",state).put("deviceId",id==null?JSONObject.NULL:id); }
    JSONObject status(DeviceScope scope) throws Exception {
        verify(scope); JSONObject value=load(scope);
        if(value==null) return status("unpaired",null);
        if(value.optBoolean("revoked")) return status("revoked",null);
        String id=value.optString("deviceId");
        if(id.isEmpty()) return status("pending",null);
        value.put("revision",Math.max(value.getLong("revision")+1,System.currentTimeMillis())); save(scope,value);
        JSONObject state=new JSONObject().put("revision",value.getLong("revision")).put("capabilities",new JSONArray()).put("connectors",new JSONArray()).put("state",new JSONObject().put("locked",false));
        try { request(scope,"/api/v1/devices/node/state",state,value.getString("credential"),false); }
        catch(Failure failure) {
            if(failure.status!=401) throw failure;
            value.put("revoked",true); save(scope,value); return status("revoked",null);
        }
        return status("paired",id);
    }
    JSONObject pair(DeviceScope scope,JSONObject descriptor) throws Exception {
        verify(scope); JSONObject value=load(scope);
        if(value!=null && !value.optString("deviceId").isEmpty() && !value.optBoolean("revoked")) return status(scope);
        if(value==null || value.optBoolean("revoked") || (!value.has("completeBody") && value.getLong("expiresAt")<=System.currentTimeMillis())) {
            JSONObject created=request(scope,"/api/v1/devices/pairing",new JSONObject(),null,true);
            JSONObject pairing=created.optJSONObject("pairing");
            if(!scope.owner.equals(created.optString("ownerId")) || pairing==null || !pairing.optString("pairingSecret").matches("ttpair_[A-Za-z0-9_-]{43}")) throw new Failure("Invalid pairing response.");
            long expires=Instant.parse(pairing.getString("expiresAt")).toEpochMilli();
            if(expires<=System.currentTimeMillis()) throw new Failure("Pairing challenge expired. Try again.");
            value=new JSONObject().put("schema",1).put("owner",scope.owner).put("origin",scope.origin).put("privateKey",base64(random()))
                .put("nonce",base64(random())).put("credential","ttnode_"+base64(random())).put("pairingSecret",pairing.getString("pairingSecret"))
                .put("expiresAt",expires).put("revision",0);
            save(scope,value);
        }
        if(!value.has("completeBody")) {
            byte[] seed=Base64.getUrlDecoder().decode(value.getString("privateKey"));
            Ed25519PrivateKeyParameters key=new Ed25519PrivateKeyParameters(seed,0);
            String publicKey=base64(key.generatePublicKey().getEncoded());
            JSONObject prepared=request(scope,"/api/v1/devices/pairing/claim",new JSONObject().put("op","prepare").put("pairingSecret",value.getString("pairingSecret")).put("publicKey",publicKey).put("nonce",value.getString("nonce")),null,false);
            JSONObject proof=prepared.optJSONObject("proof");
            if(proof==null || proof.optString("pairingId").isEmpty() || proof.getString("pairingId").length()>256 || !proof.optString("serverNonce").matches("[A-Za-z0-9_-]{43}") || Instant.parse(proof.getString("expiresAt")).toEpochMilli()<=System.currentTimeMillis()) throw new Failure("Invalid pairing proof.");
            JSONObject device=descriptor(descriptor);
            JSONObject claim=new JSONObject().put("pairingId",proof.getString("pairingId")).put("pairingSecret",value.getString("pairingSecret"))
                .put("credential",value.getString("credential")).put("publicKey",publicKey).put("nonce",value.getString("nonce"))
                .put("serverNonce",proof.getString("serverNonce")).put("device",device).put("capabilities",new JSONArray());
            byte[] message=canonical(claim); Ed25519Signer signer=new Ed25519Signer(); signer.init(true,key); signer.update(message,0,message.length);
            JSONObject envelope=new JSONObject().put("pairingId",proof.getString("pairingId")).put("publicKey",publicKey).put("nonce",value.getString("nonce"))
                .put("serverNonce",proof.getString("serverNonce")).put("signature",base64(signer.generateSignature()));
            JSONObject complete=new JSONObject().put("op","complete").put("pairingSecret",value.getString("pairingSecret")).put("credential",value.getString("credential"))
                .put("device",device).put("capabilities",new JSONArray()).put("proof",envelope);
            value.put("completeBody",complete.toString()); save(scope,value);
        }
        identity(scope);
        JSONObject complete=requestBytes(scope,"/api/v1/devices/pairing/claim",value.getString("completeBody"),null,false);
        JSONObject device=complete.optJSONObject("device");
        if(!complete.optBoolean("credentialStored") || device==null || !"android".equals(device.optString("platform")) || device.optString("id").isEmpty() || device.getString("id").length()>512) throw new Failure("Invalid completed device.");
        value.put("deviceId",device.getString("id")); save(scope,value);
        return status(scope);
    }
    static JSONObject descriptor(JSONObject raw) throws Exception {
        JSONObject result=new JSONObject().put("platform","android");
        String[] names={"name","model","osVersion","appVersion"}; int[] lengths={120,160,80,80};
        for(int i=0;i<names.length;i++) {
            String value=raw.optString(names[i]).trim(); int end=Math.min(value.length(),lengths[i]);
            if(end>0 && Character.isHighSurrogate(value.charAt(end-1))) end--;
            value=value.substring(0,end); if(value.isEmpty() && !names[i].equals("model")) throw new Failure("Invalid device description.");
            result.put(names[i],value);
        }
        return result;
    }
    static byte[] canonical(JSONObject c) throws Exception {
        JSONObject d=c.getJSONObject("device"); JSONArray caps=c.getJSONArray("capabilities");
        String[] fields={"thingtime-device-pairing-claim-v1",c.getString("pairingId"),c.getString("pairingSecret"),c.getString("credential"),c.getString("publicKey"),c.getString("nonce"),c.getString("serverNonce"),d.getString("name"),d.getString("platform"),d.optString("model"),d.optString("osVersion"),d.optString("appVersion"),Integer.toString(caps.length())};
        java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();
        for(String field:fields) append(out,field);
        for(int i=0;i<caps.length();i++) append(out,caps.getString(i));
        return out.toByteArray();
    }
    private static void append(java.io.ByteArrayOutputStream out,String field) throws Exception { byte[] bytes=field.getBytes(StandardCharsets.UTF_8); out.write((bytes.length+":").getBytes(StandardCharsets.US_ASCII)); out.write(bytes); }
    static String base64(byte[] bytes) { return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static byte[] random() { byte[] bytes=new byte[32]; new SecureRandom().nextBytes(bytes); return bytes; }
}
