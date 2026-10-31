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
import java.util.Arrays;
import java.util.UUID;

/** Opt-in two-process acceptance. A real SIGKILL bypasses exception handlers,
 * stream closure and lock release; a separate instrumentation invocation must
 * prove durable progress and content before removing only this fixture. */
public class SyncStagingProcessTest {
    @Test public void recoverAfterProcessExit() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("stagingPhase","");
        Assume.assumeTrue(phase.equals("prepare") || phase.equals("verify"));
        String scenario=InstrumentationRegistry.getArguments().getString("stagingScenario","");
        assertTrue(scenario.equals("append") || scenario.equals("finished"));
        String runId=InstrumentationRegistry.getArguments().getString("stagingRunId","");
        assertEquals(UUID.fromString(runId).toString(),runId);
        File root=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"SyncStagingProcessAcceptance");
        File marker=new File(root,"proof.json");DeviceScope owner=new DeviceScope("process-acceptance","https://staging.test",false);
        byte[] bytes=new byte[8*1024*1024+17];Arrays.fill(bytes,(byte)13);
        if(phase.equals("prepare")) {
            assertFalse("A previous fixture needs verification before another prepare",root.exists());assertTrue(root.mkdir());
            SyncStagingTest fixture=new SyncStagingTest();fixture.directory=new File(root,"staging");fixture.owner=owner;fixture.grant=UUID.randomUUID().toString();
            JSONObject request=fixture.request(bytes,true);
            SyncStaging staging=new SyncStaging(fixture.directory,()->{},()->{});staging.begin(request,owner,fixture.grant);
            if(scenario.equals("append")) {
                staging.append(request,owner,fixture.grant,0,Arrays.copyOf(bytes,FolderReader.MAX_READ));
                new SyncStaging(fixture.directory,()->{},()->exit(root,marker,new JSONObject().put("request",request).put("scenario",scenario).put("runId",runId)))
                    .append(request,owner,fixture.grant,FolderReader.MAX_READ,Arrays.copyOf(bytes,FolderReader.MAX_READ));
            } else {
                fixture.append(request,bytes);JSONObject stage=staging.finish(request,owner,fixture.grant).getJSONObject("stage");
                exit(root,marker,new JSONObject().put("request",request).put("scenario",scenario).put("runId",runId).put("stage",stage));
            }
            fail("The prepare process must terminate");
        } else {
            JSONObject proof=new JSONObject(new String(Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8));
            assertEquals(runId,proof.getString("runId"));
            assertEquals(scenario,proof.getString("scenario"));assertNotEquals(proof.getInt("pid"),Process.myPid());
            JSONObject request=proof.getJSONObject("request");String grant=request.getString("rootId");
            SyncStagingTest fixture=new SyncStagingTest();fixture.directory=new File(root,"staging");fixture.owner=owner;fixture.grant=grant;
            if(scenario.equals("append")) {
                assertEquals(2*FolderReader.MAX_READ,fixture.payload(request).length());
                assertEquals(FolderReader.MAX_READ,fixture.store().begin(request,owner,grant).getLong("received"));
                assertEquals(FolderReader.MAX_READ,fixture.payload(request).length());
                for(int at=FolderReader.MAX_READ;at<bytes.length;at+=FolderReader.MAX_READ)
                    fixture.store().append(request,owner,grant,at,Arrays.copyOfRange(bytes,at,Math.min(bytes.length,at+FolderReader.MAX_READ)));
            } else {
                assertEquals(SyncStaging.canonical(proof.getJSONObject("stage")),SyncStaging.canonical(fixture.store().begin(request,owner,grant).getJSONObject("stage")));
            }
            JSONObject progress=fixture.store().finish(request,owner,grant);
            assertEquals(bytes.length,progress.getLong("received"));
            assertArrayEquals(bytes,Files.readAllBytes(fixture.payload(request).toPath()));
            // Export a non-secret native wire response for the shared TS codec.
            JSONObject response=new JSONObject().put("type","mobile-files-result").put("payload",new JSONObject()
                .put("requestId","android-stage-acceptance").put("ownerId",owner.owner).put("origin",owner.origin)
                .put("rootId",grant).put("roots",new org.json.JSONArray().put(new JSONObject().put("id",grant).put("name","Test grant"))).put("staging",progress));
            File output=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"native-staging-contract.json");
            Files.write(output.toPath(),new JSONObject().put("request",request).put("response",response).toString().getBytes(StandardCharsets.UTF_8));
            try(java.util.stream.Stream<java.nio.file.Path> paths=Files.walk(root.toPath())) {
                for(java.nio.file.Path path:paths.sorted(java.util.Comparator.reverseOrder()).toArray(java.nio.file.Path[]::new))Files.delete(path);
            }
        }
    }
    private static void exit(File root,File marker,JSONObject proof) throws Exception {
        proof.put("pid",Process.myPid());
        try(FileOutputStream output=new FileOutputStream(marker)) { output.write(proof.toString().getBytes(StandardCharsets.UTF_8));output.getFD().sync(); }
        FileDescriptor directory=Os.open(root.getPath(),OsConstants.O_RDONLY|OsConstants.O_NOFOLLOW,0);
        try { Os.fsync(directory); } finally { Os.close(directory); }
        Process.killProcess(Process.myPid());Thread.sleep(1000);throw new AssertionError("Process did not terminate");
    }
}
