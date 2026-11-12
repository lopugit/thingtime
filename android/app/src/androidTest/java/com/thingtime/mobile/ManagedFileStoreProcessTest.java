package com.thingtime.mobile;

import android.os.Process;
import android.system.Os;
import android.system.OsConstants;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.Assume;
import static org.junit.Assert.*;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.UUID;

/** Kill the actual process inside a SQLite transaction or after commit. A new
 * process verifies rollback/replay, bytes, retained versions and shared wire
 * output. This does not grant any folder permission or enable publication UI. */
public class ManagedFileStoreProcessTest {
    @Test public void publicationSurvivesProcessExit() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("managedPhase","");
        Assume.assumeTrue(phase.equals("prepare") || phase.equals("verify"));
        String scenario=InstrumentationRegistry.getArguments().getString("managedScenario","");
        assertTrue(scenario.equals("before") || scenario.equals("after") || scenario.equals("replace"));
        String run=InstrumentationRegistry.getArguments().getString("managedRunId","");assertEquals(UUID.fromString(run).toString(),run);
        File directory=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"ManagedFileProcessAcceptance");
        File marker=new File(directory,"proof.json");
        ManagedFileStoreTest fixture=new ManagedFileStoreTest();fixture.directory=directory;fixture.managed=new File(directory,"managed");fixture.fixture=new SyncStagingTest();
        fixture.fixture.directory=new File(directory,"staging");fixture.fixture.owner=new DeviceScope("managed-process-account","https://managed.test",false);
        byte[] bytes=new byte[8*1024*1024+17];Arrays.fill(bytes,(byte)13);
        if(phase.equals("prepare")) {
            assertFalse("Verify a previous interrupted fixture first",directory.exists());assertTrue(directory.mkdir());
            fixture.fixture.grant=UUID.randomUUID().toString();
            try(ManagedFileStore store=fixture.store()){fixture.root=store.createRoot(fixture.fixture.owner,"Process acceptance");}
            JSONObject prior=null;
            if(scenario.equals("replace"))prior=fixture.publish(fixture.request("file.bin",new byte[]{1,2,3},false),new byte[]{1,2,3});
            JSONObject request=fixture.request("file.bin",bytes,true);
            if(prior!=null)request.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",prior.getJSONObject("entry"));
            JSONObject stage=fixture.stage(request,bytes);
            JSONObject proof=new JSONObject().put("run",run).put("scenario",scenario).put("root",fixture.root).put("request",request).put("stage",stage);
            if(prior!=null)proof.put("prior",prior);
            PairingEngine.Check exit=()->exit(directory,marker,proof);
            try(ManagedFileStore store=new ManagedFileStore(fixture.managed,()->{},scenario.equals("before")?exit:()->{},scenario.equals("before")?()->{}:exit)) {
                store.publish(fixture.fixture.owner,fixture.root,fixture.fixture.grant,request,stage,fixture.fixture.store());
            }
            fail("Prepare must terminate the actual process");
        } else {
            JSONObject proof=new JSONObject(new String(Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8));
            assertEquals(run,proof.getString("run"));assertEquals(scenario,proof.getString("scenario"));assertNotEquals(Process.myPid(),proof.getInt("pid"));
            fixture.root=proof.getString("root");JSONObject request=proof.getJSONObject("request");fixture.fixture.grant=request.getString("rootId");
            JSONObject receipt;
            try(ManagedFileStore store=fixture.store()) {
                JSONObject lookup=store.lookup(fixture.fixture.owner,fixture.root,fixture.fixture.grant,request);
                assertEquals(scenario.equals("before")?"missing":"complete",lookup.getString("status"));
                assertEquals(scenario.equals("before")?0:1,store.scan(fixture.fixture.owner,fixture.root).length());
                receipt=store.publish(fixture.fixture.owner,fixture.root,fixture.fixture.grant,request,proof.getJSONObject("stage"),fixture.fixture.store());
                assertEquals(SyncStaging.canonical(receipt),SyncStaging.canonical(store.lookup(fixture.fixture.owner,fixture.root,fixture.fixture.grant,request).getJSONObject("receipt")));
            }
            assertArrayEquals(Arrays.copyOfRange(bytes,8*1024*1024,bytes.length),fixture.read(receipt.getJSONObject("entry"),8*1024*1024,65536));
            // Verify all bytes independently of the production fingerprint code.
            int matching=0;for(File blob:new File(fixture.managed,"blobs").listFiles())if(Arrays.equals(bytes,Files.readAllBytes(blob.toPath())))matching++;
            assertTrue(matching>=1);
            if(scenario.equals("replace")) {
                JSONObject later=fixture.request("file.bin",new byte[]{9,8,7},false);later.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",receipt.getJSONObject("entry"));
                JSONObject edited=fixture.publish(later,new byte[]{9,8,7});
                try(ManagedFileStore store=fixture.store()) {
                    assertEquals(SyncStaging.canonical(receipt),SyncStaging.canonical(store.publish(fixture.fixture.owner,fixture.root,fixture.fixture.grant,request,proof.getJSONObject("stage"),fixture.fixture.store())));
                }
                assertArrayEquals(new byte[]{9,8,7},fixture.read(edited.getJSONObject("entry"),0,3));
                boolean retained=false;for(File blob:new File(fixture.managed,"blobs").listFiles())if(Arrays.equals(new byte[]{1,2,3},Files.readAllBytes(blob.toPath())))retained=true;
                assertTrue(retained);
            }
            JSONObject payload=new JSONObject().put("requestId","android-managed-acceptance").put("ownerId",fixture.fixture.owner.owner).put("origin",fixture.fixture.owner.origin)
                .put("rootId",fixture.fixture.grant).put("roots",new JSONArray().put(new JSONObject().put("id",fixture.fixture.grant).put("name","Test offline folder")))
                .put("publication",new JSONObject().put("status","complete").put("receipt",receipt));
            JSONObject response=new JSONObject().put("type","mobile-files-result").put("payload",payload);
            File output=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"native-managed-contract.json");
            Files.write(output.toPath(),new JSONObject().put("request",request).put("stage",proof.getJSONObject("stage")).put("response",response).toString().getBytes(StandardCharsets.UTF_8));
            fixture.after();
        }
    }
    private static void exit(File directory,File marker,JSONObject proof) throws Exception {
        proof.put("pid",Process.myPid());
        try(FileOutputStream output=new FileOutputStream(marker)){output.write(proof.toString().getBytes(StandardCharsets.UTF_8));output.getFD().sync();}
        FileDescriptor fd=Os.open(directory.getPath(),OsConstants.O_RDONLY|OsConstants.O_NOFOLLOW,0);try{Os.fsync(fd);}finally{Os.close(fd);}
        Process.killProcess(Process.myPid());throw new AssertionError("Process termination returned");
    }
}
