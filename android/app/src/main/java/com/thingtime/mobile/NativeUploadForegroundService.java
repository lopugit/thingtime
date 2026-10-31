package com.thingtime.mobile;

import android.app.*;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.*;

/** Pre-Android-14 compatibility for the same explicitly started native job. */
public final class NativeUploadForegroundService extends Service {
    private NativeUploadContinuation.Lease lease;
    private PowerManager.WakeLock wake;
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        NativeUploadContinuation.Lease selected=intent==null?null:NativeUploadContinuation.find(intent.getStringExtra(NativeUploadContinuation.TOKEN));
        if(lease!=null&&lease.running())return START_NOT_STICKY;
        if(selected==null||Build.VERSION.SDK_INT>=34){stopSelfResult(startId);return START_NOT_STICKY;}
        try {
            NativeUploadContinuation.channel(this);
            Notification notification=NativeUploadContinuation.notification(this,selected,0,0);
            if(Build.VERSION.SDK_INT>=29)startForeground(NativeUploadContinuation.NOTIFICATION_ID,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(NativeUploadContinuation.NOTIFICATION_ID,notification);
            wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Thingtime:FileUpload");wake.setReferenceCounted(false);wake.acquire(900000);
            lease=selected;
            if(!selected.grant((received,size)->new Handler(Looper.getMainLooper()).post(()->{
                if(lease==selected&&selected.running()) {
                    try {wake.acquire(900000);Notification next=NativeUploadContinuation.notification(this,selected,received,size);
                    if(Build.VERSION.SDK_INT>=29)startForeground(NativeUploadContinuation.NOTIFICATION_ID,next,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                    else startForeground(NativeUploadContinuation.NOTIFICATION_ID,next);
                    }catch(RuntimeException unavailable){selected.stop();stopSelf();}
                }
            }))){lease=null;stopSelfResult(startId);}
        }catch(Exception refused){selected.close();lease=null;stopSelfResult(startId);}
        return START_NOT_STICKY;
    }
    @Override public void onTaskRemoved(Intent root){if(lease!=null)lease.stop();stopSelf();}
    @Override public void onDestroy(){if(lease!=null)lease.stop();lease=null;if(wake!=null&&wake.isHeld())wake.release();wake=null;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
