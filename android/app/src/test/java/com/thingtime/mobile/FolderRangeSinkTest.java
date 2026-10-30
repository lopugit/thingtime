package com.thingtime.mobile;
import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public class FolderRangeSinkTest {
    @Test public void boundedFramesWaitForExactAckAndIgnoreStaleDuplicates() throws Exception {
        String id=UUID.randomUUID().toString();byte[] bytes=new byte[65539];new Random(2).nextBytes(bytes);
        FolderRangeSink[] holder=new FolderRangeSink[1];AtomicInteger offset=new AtomicInteger();AtomicReference<byte[]> prior=new AtomicReference<>();
        holder[0]=new FolderRangeSink(id,()->{},frame->{
            assertEquals(id,new String(frame,0,36,StandardCharsets.US_ASCII));
            assertEquals(offset.get(),ByteBuffer.wrap(frame).getInt(72));assertTrue(frame.length<=76+65536);
            byte[] content=Arrays.copyOfRange(frame,76,frame.length);
            assertArrayEquals(Arrays.copyOfRange(bytes,offset.get(),offset.get()+content.length),content);offset.addAndGet(content.length);
            byte[] ack=Arrays.copyOfRange(frame,36,72),previous=prior.getAndSet(ack);
            if(previous!=null)holder[0].accept(previous);
            holder[0].accept(ack);holder[0].accept(ack);
        });
        try(FolderRangeSink sink=holder[0]){sink.write(bytes);assertEquals(bytes.length,offset.get());}
    }
    @Test public void malformedAckAndTimeoutFail() throws Exception {
        String id=UUID.randomUUID().toString();FolderRangeSink[] holder=new FolderRangeSink[1];
        holder[0]=new FolderRangeSink(id,()->{},frame->holder[0].accept(Arrays.copyOfRange(frame,36,73)));
        try(FolderRangeSink sink=holder[0]){assertThrows(java.io.IOException.class,()->sink.write(new byte[1]));}
        try(FolderRangeSink sink=new FolderRangeSink(id,()->{},frame->{},10)){
            assertThrows(java.io.IOException.class,()->sink.write(new byte[1]));
            assertThrows(java.io.IOException.class,()->sink.write(new byte[0]));
        }
    }
    @Test public void closingAndRevocationStopBackpressure() throws Exception {
        for(boolean close:new boolean[]{true,false}){
            AtomicBoolean cancelled=new AtomicBoolean();CountDownLatch sent=new CountDownLatch(1);
            try(FolderRangeSink sink=new FolderRangeSink(UUID.randomUUID().toString(),()->{if(cancelled.get())throw new CancellationException();},frame->sent.countDown())){
                ExecutorService worker=Executors.newSingleThreadExecutor();
                try {Future<?> future=worker.submit(()->{sink.write(new byte[65537]);return null;});
                    assertTrue(sent.await(1,TimeUnit.SECONDS));if(close)sink.close();else cancelled.set(true);
                    assertTrue(assertThrows(ExecutionException.class,()->future.get(1,TimeUnit.SECONDS)).getCause() instanceof CancellationException);
                }finally{worker.shutdownNow();}
            }
        }
    }
}
