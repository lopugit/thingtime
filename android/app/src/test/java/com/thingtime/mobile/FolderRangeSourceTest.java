package com.thingtime.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public class FolderRangeSourceTest {
    static byte[] frame(String token,byte[] bytes) {
        byte[] result=new byte[36+bytes.length];System.arraycopy(token.getBytes(StandardCharsets.US_ASCII),0,result,0,36);
        System.arraycopy(bytes,0,result,36,bytes.length);return result;
    }
    @Test public void pullsOneFrameAndIgnoresUnsolicitedStaleAndDuplicateFrames() throws Exception {
        FolderRangeSource[] source=new FolderRangeSource[1];AtomicReference<String> previous=new AtomicReference<>();
        source[0]=new FolderRangeSource(()->{},(token,offset,length)-> {
            String old=previous.getAndSet(token);
            if(old!=null)source[0].accept(frame(old,new byte[length]));
            byte[] bytes=new byte[length];Arrays.fill(bytes,(byte)(offset+7));
            source[0].accept(frame(token,bytes));source[0].accept(frame(token,new byte[length]));
        });
        try(FolderRangeSource s=source[0]) {
            s.accept(frame(java.util.UUID.randomUUID().toString(),new byte[]{0}));
            assertArrayEquals(new byte[]{7,7},s.read(0,2));assertArrayEquals(new byte[]{9},s.read(2,1));
        }
    }
    @Test public void wrongLengthBoundsAndTimeoutFailWithoutAcceptingBytes() throws Exception {
        FolderRangeSource[] source=new FolderRangeSource[1];source[0]=new FolderRangeSource(()->{},(token,offset,length)->source[0].accept(frame(token,new byte[length+1])));
        try(FolderRangeSource s=source[0]) {
            assertThrows(java.io.IOException.class,()->s.read(0,0));assertThrows(java.io.IOException.class,()->s.read(0,65537));
            assertThrows(java.io.IOException.class,()->s.read(-1,1));assertThrows(java.io.IOException.class,()->s.read(0,1));
        }
        try(FolderRangeSource s=new FolderRangeSource(()->{},(token,offset,length)->{},10)) {
            assertThrows(java.io.IOException.class,()->s.read(0,1));
        }
    }
    @Test public void closingOrForegroundCancellationWakesBlockedReader() throws Exception {
        for(boolean close:new boolean[]{true,false}) {
            AtomicBoolean cancelled=new AtomicBoolean();CountDownLatch pulled=new CountDownLatch(1);
            try(FolderRangeSource s=new FolderRangeSource(()->{if(cancelled.get())throw new CancellationException();},(token,offset,length)->pulled.countDown())) {
                ExecutorService executor=Executors.newSingleThreadExecutor();
                try {
                    Future<byte[]> read=executor.submit(()->s.read(0,1));assertTrue(pulled.await(1,TimeUnit.SECONDS));
                    if(close)s.close();else cancelled.set(true);
                    ExecutionException error=assertThrows(ExecutionException.class,()->read.get(1,TimeUnit.SECONDS));
                    assertTrue(error.getCause() instanceof CancellationException);
                } finally { executor.shutdownNow(); }
            }
        }
    }
}
