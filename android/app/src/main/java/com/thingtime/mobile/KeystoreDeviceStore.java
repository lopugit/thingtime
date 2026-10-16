package com.thingtime.mobile;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;

/** Software signing seeds are encrypted at rest by a non-exportable Android Keystore AES key. */
final class KeystoreDeviceStore implements PairingEngine.Store {
    private static final String ALIAS="thingtime.mobile.devices.v1";
    private final File directory;
    KeystoreDeviceStore(Context context) { directory=new File(context.getNoBackupFilesDir(),"devices"); }
    private static synchronized SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if(store.containsAlias(ALIAS)) return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    private AtomicFile file(DeviceScope scope) throws Exception { return new AtomicFile(new File(directory,scope.key()+".bin")); }
    private byte[] aad(DeviceScope scope) throws Exception { return scope.key().getBytes(StandardCharsets.US_ASCII); }
    @Override public synchronized JSONObject load(DeviceScope scope) throws Exception {
        AtomicFile file=file(scope);
        if(!file.getBaseFile().exists() && !new File(file.getBaseFile()+".bak").exists()) return null;
        byte[] bytes;
        try(java.io.InputStream input=file.openRead(); java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()) {
            byte[] buffer=new byte[4096]; int count;
            while((count=input.read(buffer))!=-1) { if(out.size()+count>65536) throw new PairingEngine.Failure("Saved device record is too large."); out.write(buffer,0,count); }
            bytes=out.toByteArray();
        }
        if(bytes.length<30 || bytes[0]!=1) throw new PairingEngine.Failure("Invalid saved device record.");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOfRange(bytes,1,13))); cipher.updateAAD(aad(scope));
        return new JSONObject(new String(cipher.doFinal(bytes,13,bytes.length-13),StandardCharsets.UTF_8));
    }
    @Override public synchronized void save(DeviceScope scope,JSONObject record) throws Exception {
        byte[] plain=record.toString().getBytes(StandardCharsets.UTF_8);
        if(plain.length>60000 || !scope.matches(record.optString("owner"),record.optString("origin"))) throw new PairingEngine.Failure("Invalid device record.");
        if(!directory.isDirectory() && !directory.mkdirs()) throw new PairingEngine.Failure("Device storage is unavailable.");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key()); cipher.updateAAD(aad(scope));
        byte[] encrypted=cipher.doFinal(plain); AtomicFile file=file(scope); FileOutputStream output=null;
        try { output=file.startWrite(); output.write(1); output.write(cipher.getIV()); output.write(encrypted); file.finishWrite(output); }
        catch(Exception failure) { if(output!=null) file.failWrite(output); throw failure; }
        finally { Arrays.fill(plain,(byte)0); }
    }
}
