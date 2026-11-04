package com.thingtime.mobile;

import android.app.job.*;
import android.os.*;

/** Android 14+ user-initiated transfer. Only a live, foreground-created token
 * may adopt this job; a process restart never resurrects session authority. */
public final class NativeUploadJobService extends JobService {
    private NativeUploadContinuation.Lease lease;
    private JobParameters parameters;
    @Override public boolean onStartJob(JobParameters parameters) {
        if(Build.VERSION.SDK_INT<34)return false;
        NativeUploadContinuation.Lease selected=NativeUploadContinuation.find(parameters.getTransientExtras().getString(NativeUploadContinuation.TOKEN));
        if(selected==null)return false;
        try {
            setNotification(parameters,NativeUploadContinuation.NOTIFICATION_ID,NativeUploadContinuation.notification(this,selected,0,0),JOB_END_NOTIFICATION_POLICY_REMOVE);
            lease=selected;this.parameters=parameters;
            if(!selected.grant((received,size)->new Handler(Looper.getMainLooper()).post(()->{
                if(lease==selected&&selected.running()) {
                    try {setNotification(parameters,NativeUploadContinuation.NOTIFICATION_ID,NativeUploadContinuation.notification(this,selected,received,size),JOB_END_NOTIFICATION_POLICY_REMOVE);}
                    catch(RuntimeException unavailable){selected.stop();}
                }
            }),()->new Handler(Looper.getMainLooper()).post(()->{
                if(lease==selected&&this.parameters==parameters){lease=null;this.parameters=null;try{jobFinished(parameters,false);}catch(RuntimeException stopped){/* OS already ended the job. */}}
            }))){lease=null;this.parameters=null;return false;}
            return true;
        }catch(Exception refused){selected.close();lease=null;this.parameters=null;return false;}
    }
    @Override public boolean onStopJob(JobParameters parameters) {
        NativeUploadContinuation.Lease selected=lease;
        if(selected!=null && selected.token.equals(parameters.getTransientExtras().getString(NativeUploadContinuation.TOKEN))) {
            lease=null;this.parameters=null;selected.stop();
        }
        return false;
    }
    @Override public void onDestroy(){if(lease!=null)lease.stop();lease=null;parameters=null;super.onDestroy();}
}
