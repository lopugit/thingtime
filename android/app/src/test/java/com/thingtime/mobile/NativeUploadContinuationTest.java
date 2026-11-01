package com.thingtime.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.concurrent.atomic.AtomicInteger;

public class NativeUploadContinuationTest {
    @Test public void onlyAcceptedLeaseAllowsBackgroundAndStopsExactlyOnce() throws Exception {
        AtomicInteger cancelled=new AtomicInteger(),cleaned=new AtomicInteger(),finished=new AtomicInteger(),progress=new AtomicInteger();
        NativeUploadContinuation.Lease lease=new NativeUploadContinuation.Lease(cancelled::incrementAndGet);lease.cleanup(cleaned::incrementAndGet);
        assertFalse(lease.running());assertTrue(lease.grant((n,size)->progress.incrementAndGet(),finished::incrementAndGet));
        assertFalse(lease.grant((n,size)->fail()));assertTrue(lease.await(()->{}));lease.update(1,2);assertEquals(1,progress.get());
        lease.stop();lease.stop();lease.close();lease.update(2,2);
        assertFalse(lease.running());assertEquals(1,cancelled.get());assertEquals(1,cleaned.get());assertEquals(0,finished.get());assertEquals(1,progress.get());
    }
    @Test public void RefusedOrLateAuthorityCannotReviveClosedLease() throws Exception {
        AtomicInteger cancelled=new AtomicInteger(),cleaned=new AtomicInteger();
        NativeUploadContinuation.Lease lease=new NativeUploadContinuation.Lease(cancelled::incrementAndGet);
        lease.stop();lease.cleanup(cleaned::incrementAndGet);
        assertFalse(lease.grant((n,size)->fail()));assertFalse(lease.await(()->{}));assertEquals(0,cancelled.get());assertEquals(1,cleaned.get());
    }
    @Test public void completionReleasesOSJobWithoutCancellingSuccessfulBytes() throws Exception {
        AtomicInteger cancelled=new AtomicInteger(),cleaned=new AtomicInteger(),finished=new AtomicInteger();
        NativeUploadContinuation.Lease lease=new NativeUploadContinuation.Lease(cancelled::incrementAndGet);lease.cleanup(cleaned::incrementAndGet);
        assertTrue(lease.grant((n,size)->{},finished::incrementAndGet));lease.close();lease.stop();
        assertEquals(0,cancelled.get());assertEquals(1,cleaned.get());assertEquals(1,finished.get());assertFalse(lease.running());
    }
    @Test public void waitingAndGrantedAuthorityStillRequireCurrentCaller() throws Exception {
        NativeUploadContinuation.Lease lease=new NativeUploadContinuation.Lease(()->{});
        assertThrows(java.util.concurrent.CancellationException.class,()->lease.await(()->{throw new java.util.concurrent.CancellationException();}));
        assertTrue(lease.grant((n,size)->{}));
        assertThrows(java.util.concurrent.CancellationException.class,()->lease.await(()->{throw new java.util.concurrent.CancellationException();}));lease.close();
    }
}
