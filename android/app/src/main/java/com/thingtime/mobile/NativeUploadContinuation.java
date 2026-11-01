package com.thingtime.mobile;

import android.app.*;
import android.app.job.*;
import android.content.*;
import android.net.*;
import android.os.*;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/** OS continuation for exactly one user-started file job. This is not stored
 * permission, an autonomous sync scheduler, or process-relaunch authority. */
final class NativeUploadContinuation {
    static final int JOB_ID=718501,NOTIFICATION_ID=718502;
    static final String CHANNEL="file-transfers",TOKEN="transferToken";
    private static final AtomicReference<Lease> CURRENT=new AtomicReference<>();
    interface Progress {void update(long received,long size);}
    static final class Lease implements AutoCloseable {
        final String token=UUID.randomUUID().toString();
        private final CountDownLatch ready=new CountDownLatch(1);
        private final Runnable cancelled;
        private Runnable cleanup=()->{},finished=()->{};
        private Progress progress=(received,size)->{};
        private boolean running,closed;
        Lease(Runnable cancelled){this.cancelled=cancelled;}
        synchronized void cleanup(Runnable work){if(closed)work.run();else cleanup=work;}
        synchronized boolean grant(Progress progress){return grant(progress,()->{});}
        synchronized boolean grant(Progress progress,Runnable finished){
            if(closed||running)return false;this.progress=progress;this.finished=finished;running=true;ready.countDown();return true;
        }
        synchronized boolean running(){return running&&!closed;}
        boolean await(PairingEngine.Check check) throws Exception {
            long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
            while(!ready.await(100,TimeUnit.MILLISECONDS)){check.run();if(System.nanoTime()>=until){close();return false;}}
            check.run();return running();
        }
        void update(long received,long size){Progress callback;synchronized(this){if(!running||closed)return;callback=progress;}callback.update(received,size);}
        void stop(){end(true);}
        @Override public void close(){end(false);}
        private void end(boolean cancel){
            Runnable release,finish;boolean notify;
            synchronized(this){if(closed)return;notify=cancel&&running;closed=true;running=false;release=cleanup;finish=finished;ready.countDown();}
            try{if(notify)cancelled.run();else if(!cancel)finish.run();}finally{release.run();}
        }
    }
    static Lease find(String token){Lease lease=CURRENT.get();return lease!=null&&lease.token.equals(token)?lease:null;}
    static Lease begin(Activity activity,NativeUploadRequest request,PairingEngine.Check foreground,Runnable cancelled) {
        Lease lease=new Lease(cancelled);Context context=activity.getApplicationContext();
        new Handler(Looper.getMainLooper()).post(()->{
            try {
                foreground.run();if(activity.isFinishing()||activity.isDestroyed()||!CURRENT.compareAndSet(null,lease)){lease.close();return;}
                lease.cleanup(()->new Handler(Looper.getMainLooper()).post(()->{
                    if(CURRENT.compareAndSet(lease,null)) {
                        try {if(Build.VERSION.SDK_INT>=34)context.getSystemService(JobScheduler.class).cancel(JOB_ID);
                        else context.stopService(new Intent(context,NativeUploadForegroundService.class));}
                        catch(RuntimeException stopped){/* Authority is already revoked; OS cleanup can race its stop. */}
                    }
                }));
                channel(context);
                NotificationManager notifications=context.getSystemService(NotificationManager.class);
                if(!notifications.areNotificationsEnabled()||notifications.getNotificationChannel(CHANNEL).getImportance()==NotificationManager.IMPORTANCE_NONE){lease.close();return;}
                if(Build.VERSION.SDK_INT>=34) {
                    NetworkRequest.Builder network=new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                    if(request.configuration.getString("network").equals("wifi"))network.addTransportType(NetworkCapabilities.TRANSPORT_WIFI);
                    Bundle extras=new Bundle();extras.putString(TOKEN,lease.token);
                    JobInfo job=new JobInfo.Builder(JOB_ID,new ComponentName(context,NativeUploadJobService.class))
                        .setUserInitiated(true).setRequiredNetwork(network.build()).setRequiresCharging(request.configuration.getBoolean("chargingOnly"))
                        .setEstimatedNetworkBytes(0,request.size).setTransientExtras(extras).build();
                    if(context.getSystemService(JobScheduler.class).schedule(job)!=JobScheduler.RESULT_SUCCESS)lease.close();
                } else context.startForegroundService(new Intent(context,NativeUploadForegroundService.class).putExtra(TOKEN,lease.token));
            }catch(Exception refused){lease.close();}
        });
        return lease;
    }
    static void channel(Context context){
        NotificationChannel channel=new NotificationChannel(CHANNEL,"File transfers",NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Progress and pause controls for transfers you start.");channel.setSound(null,null);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static Notification notification(Context context,Lease lease,long received,long size) {
        Intent open=new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content=PendingIntent.getActivity(context,JOB_ID,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Intent pause=new Intent(context,NativeUploadStopReceiver.class).setAction("com.thingtime.mobile.PAUSE_UPLOAD").setData(Uri.parse("thingtime-transfer:"+lease.token)).putExtra(TOKEN,lease.token);
        PendingIntent stop=PendingIntent.getBroadcast(context,JOB_ID,pause,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        int progress=size>0?(int)Math.min(100,received*100.0/size):0;
        return new Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Uploading files").setContentText(size>0?"Current file: "+progress+"%":"Preparing current file")
            .setContentIntent(content).setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setCategory(Notification.CATEGORY_PROGRESS).setProgress(100,progress,size<=0)
            .addAction(new Notification.Action.Builder(null,"Pause",stop).build()).build();
    }
}
