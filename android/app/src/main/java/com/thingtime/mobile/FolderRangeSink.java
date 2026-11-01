package com.thingtime.mobile;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CancellationException;

/** Native-to-WebView frames: request UUID, one-use acknowledgement UUID, relative
 * big-endian offset, then at most 64 KiB. Only one frame may be outstanding. */
final class FolderRangeSink implements AutoCloseable {
    static final int HEADER=76;
    interface Send { void send(byte[] frame) throws Exception; }
    private final String requestId;
    private final PairingEngine.Check check;
    private final Send send;
    private final long timeoutNanos;
    private String token;
    private boolean acknowledged,closed;
    private IOException failure;
    FolderRangeSink(String requestId,PairingEngine.Check check,Send send) {this(requestId,check,send,15000);}
    FolderRangeSink(String requestId,PairingEngine.Check check,Send send,long timeoutMillis) {
        if(!UUID.fromString(requestId).toString().equals(requestId))throw new IllegalArgumentException("Invalid request ID");
        this.requestId=requestId;this.check=check;this.send=send;this.timeoutNanos=timeoutMillis*1000000;
    }
    synchronized void write(byte[] bytes) throws Exception {
        if(bytes==null || bytes.length<1 || bytes.length>FolderReader.MAX_RANGE || token!=null)throw new IOException("Invalid upload range.");
        for(int offset=0;offset<bytes.length;offset+=FolderReader.MAX_READ) {
            check.run();if(closed)throw new CancellationException();
            int length=Math.min(FolderReader.MAX_READ,bytes.length-offset);
            token=UUID.randomUUID().toString();acknowledged=false;failure=null;
            byte[] frame=ByteBuffer.allocate(HEADER+length).put(requestId.getBytes(StandardCharsets.US_ASCII))
                .put(token.getBytes(StandardCharsets.US_ASCII)).putInt(offset).put(bytes,offset,length).array();
            long start=System.nanoTime();
            try {
                send.send(frame);
                while(!acknowledged) {
                    check.run();if(closed)throw new CancellationException();if(failure!=null)throw failure;
                    long remaining=timeoutNanos-(System.nanoTime()-start);
                    if(remaining<=0)throw new IOException("Upload frame acknowledgement timed out.");
                    wait(Math.max(1,Math.min(100,remaining/1000000)));
                }
                check.run();if(closed)throw new CancellationException();
            } finally {token=null;}
        }
    }
    synchronized void accept(byte[] bytes) {
        if(closed || token==null || acknowledged || failure!=null || bytes==null || bytes.length<36)return;
        if(!token.equals(new String(bytes,0,36,StandardCharsets.US_ASCII)))return;
        if(bytes.length!=36)failure=new IOException("Invalid upload acknowledgement.");else acknowledged=true;
        notifyAll();
    }
    @Override public synchronized void close() {closed=true;notifyAll();}
}
