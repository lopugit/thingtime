package com.thingtime.mobile;

import android.os.Process;
import android.system.Os;
import android.system.OsConstants;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.Assume;
import static org.junit.Assert.*;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;

/** Opt-in process termination at the real FULL-synchronous transaction boundary.
 * Fixtures live apart from selected roots and are removed only after verification. */
public class ManagedTrashProcessTest {
    @Test public void deletionAndRestorationSurviveProcessExit() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("trashPhase","");
        Assume.assumeTrue(phase.equals("prepare") || phase.equals("verify"));
        String scenario=InstrumentationRegistry.getArguments().getString("trashScenario","");
        assertTrue(scenario.matches("(delete|restore)-(before|after)"));
        String run=InstrumentationRegistry.getArguments().getString("trashRunId","");assertEquals(UUID.fromString(run).toString(),run);
        File directory=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"ManagedTrashProcessAcceptance"),marker=new File(directory,"proof.json");
        ManagedFileStoreTest f=new ManagedFileStoreTest();f.directory=directory;f.managed=new File(directory,"managed");f.fixture=new SyncStagingTest();
        f.fixture.directory=new File(directory,"staging");f.fixture.owner=new DeviceScope("trash-process-account","https://managed.test",false);
        byte[] bytes={1,7,9,3};boolean restore=scenario.startsWith("restore"),before=scenario.endsWith("before");
        if(phase.equals("prepare")) {
            assertFalse("Verify a previous interrupted fixture first",directory.exists());assertTrue(directory.mkdir());f.fixture.grant=UUID.randomUUID().toString();
            try(ManagedFileStore s=f.store()){f.root=s.createRoot(f.fixture.owner,"Process recovery acceptance");}
            JSONObject original=f.publish(f.request("file",bytes,false),bytes).getJSONObject("entry"),request=ManagedTrashTest.request(f,original),target=new JSONObject().put("path","restored").put("expected",original);
            if(restore)try(ManagedFileStore s=f.store()){s.trash(f.fixture.owner,f.root,f.fixture.grant,request);}
            JSONObject proof=new JSONObject().put("run",run).put("scenario",scenario).put("root",f.root).put("request",request).put("restore",target);
            PairingEngine.Check exit=()->exit(directory,marker,proof);
            try(ManagedFileStore s=new ManagedFileStore(f.managed,()->{},before?exit:()->{},before?()->{}:exit)) {
                if(restore)s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,true);else s.trash(f.fixture.owner,f.root,f.fixture.grant,request);
            }
            fail("Prepare must terminate the actual process");
        } else {
            JSONObject proof=new JSONObject(new String(Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8));assertEquals(run,proof.getString("run"));assertEquals(scenario,proof.getString("scenario"));assertNotEquals(Process.myPid(),proof.getInt("pid"));
            f.root=proof.getString("root");JSONObject request=proof.getJSONObject("request"),target=proof.getJSONObject("restore");f.fixture.grant=request.getString("rootId");JSONObject restored;
            try(ManagedFileStore s=f.store()) {
                assertEquals(restore || !before?"complete":"missing",s.trashLookup(f.fixture.owner,f.root,f.fixture.grant,request).getString("status"));
                if(restore) {
                    assertEquals(before?0:1,s.scan(f.fixture.owner,f.root).length());JSONObject replay=s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,false);
                    if(before){assertNull(replay);restored=s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,true);}else{assertNotNull(replay);restored=replay;}
                } else {
                    assertEquals(before?1:0,s.scan(f.fixture.owner,f.root).length());s.trash(f.fixture.owner,f.root,f.fixture.grant,request);
                    restored=s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,true);
                }
                assertTrue(SyncTrash.same(restored,s.restoreTrash(f.fixture.owner,f.root,f.fixture.grant,request,target,false)));
                s.trash(f.fixture.owner,f.root,f.fixture.grant,request);assertEquals(1,s.scan(f.fixture.owner,f.root).length());
            }
            assertArrayEquals(bytes,f.read(restored,0,bytes.length));f.after();
        }
    }
    private static void exit(File directory,File marker,JSONObject proof) throws Exception {
        proof.put("pid",Process.myPid());try(FileOutputStream output=new FileOutputStream(marker)){output.write(proof.toString().getBytes(StandardCharsets.UTF_8));output.getFD().sync();}
        FileDescriptor fd=Os.open(directory.getPath(),OsConstants.O_RDONLY|OsConstants.O_NOFOLLOW,0);try{Os.fsync(fd);}finally{Os.close(fd);}
        Process.killProcess(Process.myPid());throw new AssertionError("Process termination returned");
    }
}
