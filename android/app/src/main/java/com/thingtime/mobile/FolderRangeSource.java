package com.thingtime.mobile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CancellationException;

/** One outstanding native pull; unsolicited, stale and duplicate frames never queue. */
final class FolderRangeSource implements AutoCloseable {
    static final int HEADER=36, MAX_FRAME=65536;
    interface Pull { void send(String token,long offset,int length) throws Exception; }
    private final PairingEngine.Check check;
    private final Pull pull;
    private final long timeoutNanos;
    private String token;
    private int expected;
    private byte[] frame;
    private boolean closed;
    private IOException failure;
    FolderRangeSource(PairingEngine.Check check,Pull pull) { this(check,pull,15000); }
    FolderRangeSource(PairingEngine.Check check,Pull pull,long timeoutMillis) {
        this.check=check;this.pull=pull;this.timeoutNanos=timeoutMillis*1000000;
    }
    synchronized byte[] read(long offset,int length) throws Exception {
        check.run();if(closed)throw new CancellationException();
        if(offset<0 || length<1 || length>MAX_FRAME || token!=null)throw new IOException("Invalid download frame request.");
        token=UUID.randomUUID().toString();expected=length;frame=null;failure=null;
        long started=System.nanoTime();
        try {
            pull.send(token,offset,length);
            while(frame==null) {
                check.run();if(closed)throw new CancellationException();if(failure!=null)throw failure;
                long remaining=timeoutNanos-(System.nanoTime()-started);
                if(remaining<=0)throw new IOException("Download frame timed out.");
                wait(Math.max(1,Math.min(100,remaining/1000000)));
            }
            check.run();if(closed)throw new CancellationException();return frame;
        } finally { token=null;frame=null; }
    }
    synchronized void accept(byte[] bytes) {
        if(closed || token==null || frame!=null || failure!=null || bytes==null || bytes.length<HEADER) return;
        if(!token.equals(new String(bytes,0,HEADER,StandardCharsets.US_ASCII)))return;
        if(bytes.length!=HEADER+expected)failure=new IOException("Invalid download frame length.");
        else frame=Arrays.copyOfRange(bytes,HEADER,bytes.length);
        notifyAll();
    }
    @Override public synchronized void close() { closed=true;frame=null;notifyAll(); }
}
