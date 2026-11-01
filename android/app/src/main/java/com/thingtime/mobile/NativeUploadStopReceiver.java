package com.thingtime.mobile;

import android.content.*;

/** The notification carries only an opaque, current-job pause token. */
public final class NativeUploadStopReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        NativeUploadContinuation.Lease lease=NativeUploadContinuation.find(intent.getStringExtra(NativeUploadContinuation.TOKEN));
        if(lease!=null)lease.stop();
    }
}
