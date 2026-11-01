package com.thingtime.mobile;

import android.app.*;
import android.app.job.JobScheduler;
import android.content.*;
import android.os.Build;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Real OS scheduling/notification controls; synthetic request carries no file
 * or account access. Live upload acceptance separately exercises the bridge. */
public class NativeUploadServiceTest {
    @Test public void notificationPauseAndLatePauseAreScopedToCurrentJob() throws Exception {exercise("pause");}
    @Test public void osStopRevokesAuthorityWithoutRescheduling() throws Exception {exercise("stop");}
    @Test public void completionReleasesJobAndNotification() throws Exception {exercise("complete");}
    private static void exercise(String mode) throws Exception {
        Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();
        if(!"true".equals(InstrumentationRegistry.getArguments().getString("uploadBackground")))
            org.junit.Assume.assumeTrue("Enable notifications to run OS notification controls acceptance",context.getSystemService(NotificationManager.class).areNotificationsEnabled());
        MainActivity activity=(MainActivity)instrumentation.startActivitySync(new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        NativeUploadContinuation.Lease[] lease={null};AtomicInteger cancelled=new AtomicInteger();
        try {
            NativeUploadRecoveryTest.Memory memory=new NativeUploadRecoveryTest.Memory();
            NativeUploadRequest request=NativeUploadRecoveryTest.request(new DeviceScope("service-fixture","https://service.test",false),"11111111-1111-4111-8111-111111111111",new FolderReader(memory,()->{}).scan().getJSONObject(0));
            instrumentation.runOnMainSync(()->lease[0]=NativeUploadContinuation.begin(activity,request,()->{
                if(activity.isFinishing()||activity.isDestroyed())throw new java.util.concurrent.CancellationException();
            },cancelled::incrementAndGet));
            assertTrue("OS must admit the explicitly foreground-started job",lease[0].await(()->{}));
            if(Build.VERSION.SDK_INT>=34)assertTrue(context.getSystemService(JobScheduler.class).getPendingJob(NativeUploadContinuation.JOB_ID).isUserInitiated());
            NotificationManager manager=context.getSystemService(NotificationManager.class);
            Notification notification=null;long deadline=System.currentTimeMillis()+10000;
            while(notification==null&&System.currentTimeMillis()<deadline) {
                for(android.service.notification.StatusBarNotification row:manager.getActiveNotifications())if(row.getId()==NativeUploadContinuation.NOTIFICATION_ID)notification=row.getNotification();
                if(notification==null)Thread.sleep(50);
            }
            assertNotNull("OS transfer notification must be active",notification);assertEquals("Pause",notification.actions[0].title.toString());
            PendingIntent pause=notification.actions[0].actionIntent;
            if(mode.equals("pause"))pause.send();
            else if(mode.equals("stop")) {
                if(Build.VERSION.SDK_INT>=34)context.getSystemService(JobScheduler.class).cancel(NativeUploadContinuation.JOB_ID);
                else context.stopService(new Intent(context,NativeUploadForegroundService.class));
            } else lease[0].close();
            deadline=System.currentTimeMillis()+10000;
            while(lease[0].running()&&System.currentTimeMillis()<deadline)Thread.sleep(50);
            assertFalse(lease[0].running());assertEquals(mode.equals("complete")?0:1,cancelled.get());
            Thread.sleep(200);pause.send();assertEquals(mode.equals("complete")?0:1,cancelled.get());
            deadline=System.currentTimeMillis()+10000;
            while(manager.getActiveNotifications().length>0&&System.currentTimeMillis()<deadline)Thread.sleep(50);
            for(android.service.notification.StatusBarNotification row:manager.getActiveNotifications())assertNotEquals(NativeUploadContinuation.NOTIFICATION_ID,row.getId());
            if(Build.VERSION.SDK_INT>=34)assertNull(context.getSystemService(JobScheduler.class).getPendingJob(NativeUploadContinuation.JOB_ID));
        } finally {if(lease[0]!=null)lease[0].close();instrumentation.runOnMainSync(activity::finish);}
    }
}
