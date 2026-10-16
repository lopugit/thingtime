package com.thingtime.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import android.content.Context;
import java.io.File;
import java.nio.file.Files;
import java.util.UUID;

public class KeystoreDeviceStoreTest {
    @Test public void encryptedRoundTripAndTamperRejection() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        DeviceScope scope=new DeviceScope("test-"+UUID.randomUUID(),"https://thingtime.test",false);
        File file=new File(context.getNoBackupFilesDir(),"devices/"+scope.key()+".bin");
        try {
            JSONObject record=new JSONObject().put("owner",scope.owner).put("origin",scope.origin).put("credential","synthetic-secret-value");
            new KeystoreDeviceStore(context).save(scope,record);
            byte[] bytes=Files.readAllBytes(file.toPath());
            assertFalse(new String(bytes,java.nio.charset.StandardCharsets.ISO_8859_1).contains("synthetic-secret-value"));
            assertEquals("synthetic-secret-value",new KeystoreDeviceStore(context).load(scope).getString("credential"));
            assertNull(new KeystoreDeviceStore(context).load(new DeviceScope("other-"+scope.owner,scope.origin,false)));
            bytes[bytes.length-1]^=1; Files.write(file.toPath(),bytes);
            assertThrows(Exception.class,()->new KeystoreDeviceStore(context).load(scope));
        } finally { file.delete(); }
    }
    @Test public void ciphertextCannotMoveBetweenAccounts() throws Exception {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        DeviceScope first=new DeviceScope("test-"+UUID.randomUUID(),"https://thingtime.test",false),second=new DeviceScope("test-"+UUID.randomUUID(),"https://thingtime.test",false);
        File a=new File(context.getNoBackupFilesDir(),"devices/"+first.key()+".bin"),b=new File(context.getNoBackupFilesDir(),"devices/"+second.key()+".bin");
        try {
            new KeystoreDeviceStore(context).save(first,new JSONObject().put("owner",first.owner).put("origin",first.origin));
            Files.copy(a.toPath(),b.toPath()); assertThrows(Exception.class,()->new KeystoreDeviceStore(context).load(second));
        } finally { a.delete(); b.delete(); }
    }
}
