package com.thingtime.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.Arrays;

public class AttachmentExportTest {
    static JSONObject payload(byte[] bytes) throws Exception {
        MessageDigest hash=MessageDigest.getInstance("SHA-256");
        for(int at=0;at<bytes.length;at+=8388608)hash.update(MessageDigest.getInstance("SHA-256").digest(Arrays.copyOfRange(bytes,at,Math.min(at+8388608,bytes.length))));
        return new JSONObject().put("name","An old version.bin").put("content",new JSONObject().put("attachmentId","attachment-one")
            .put("version","a".repeat(64)).put("size",bytes.length).put("fingerprint",new JSONObject().put("algorithm","sha256-parts-v1")
            .put("partSizeBytes",8388608).put("partCount",(bytes.length+8388607)/8388608).put("sha256",FolderReader.hex(hash.digest()))));
    }
    @Test public void streamsAcrossHttpAndFingerprintBoundariesAndReadsBack() throws Exception {
        byte[] bytes=new byte[8388608+17];for(int i=0;i<bytes.length;i++)bytes[i]=(byte)(i%251);
        AttachmentExport export=new AttachmentExport(payload(bytes));ByteArrayOutputStream output=new ByteArrayOutputStream();int[] calls={0};
        export.download(output,(offset,length)->{calls[0]++;assertTrue(length<=2097152);return new ByteArrayInputStream(bytes,(int)offset,length);},()->{});
        assertEquals(5,calls[0]);assertArrayEquals(bytes,output.toByteArray());export.verify(new ByteArrayInputStream(output.toByteArray()),()->{});
        bytes[8388608]++;assertThrows(IOException.class,()->export.verify(new ByteArrayInputStream(bytes),()->{}));
    }
    @Test public void refusesTruncationExtraBytesCorruptionAndCancellation() throws Exception {
        byte[] bytes={1,2,3};AttachmentExport export=new AttachmentExport(payload(bytes));
        for(byte[] bad:new byte[][]{{1,2},{1,2,3,4},{1,2,4}}) {
            assertThrows(IOException.class,()->export.download(new ByteArrayOutputStream(),(o,n)->new ByteArrayInputStream(bad),()->{}));
            assertThrows(IOException.class,()->export.verify(new ByteArrayInputStream(bad),()->{}));
        }
        assertThrows(java.util.concurrent.CancellationException.class,()->export.download(new ByteArrayOutputStream(),(o,n)->{fail("No read after cancellation");return null;},()->{throw new java.util.concurrent.CancellationException();}));
    }
    @Test public void pinsFramedIdentityAndRejectsUnsafeNamesAndPaths() throws Exception {
        JSONObject valid=payload(new byte[]{1});AttachmentExport export=new AttachmentExport(valid);
        JSONObject fingerprint=new JSONObject(valid.getJSONObject("content").toString()).put("ok",true).put("id",export.id);
        export.match(fingerprint);
        fingerprint.put("version","b".repeat(64));assertThrows(IOException.class,()->export.match(fingerprint));
        for(String name:new String[]{"../private","a/b","a\\b",".","..","\n"})assertThrows(Exception.class,()->new AttachmentExport(new JSONObject(valid.toString()).put("name",name)));
        JSONObject invalid=new JSONObject(valid.toString());invalid.getJSONObject("content").put("attachmentId","a&other=1");assertThrows(Exception.class,()->new AttachmentExport(invalid));
        JSONObject bad=new JSONObject(valid.toString());bad.getJSONObject("content").getJSONObject("fingerprint").put("partSizeBytes",1);assertThrows(Exception.class,()->new AttachmentExport(bad));
    }
    @Test public void exactRangeHeadersAndRedirectsAreEnforced() throws Exception {
        AttachmentExport export=new AttachmentExport(payload(new byte[]{1,2,3}));
        for(String response:new String[]{
            "206 Partial Content\r\nETag: \""+export.version+"\"\r\nContent-Range: bytes 0-2/3\r\nContent-Length: 3",
            "302 Found\r\nLocation: http://127.0.0.1:1/stolen\r\nContent-Length: 3",
            "200 OK\r\nContent-Length: 3",
            "206 Partial Content\r\nETag: \"other\"\r\nContent-Range: bytes 0-2/3\r\nContent-Length: 3"}) {
            try(ServerSocket server=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))) {
                java.util.concurrent.CompletableFuture<String> received=new java.util.concurrent.CompletableFuture<>();
                Thread thread=new Thread(()->{try(Socket client=server.accept()){
                    BufferedReader reader=new BufferedReader(new InputStreamReader(client.getInputStream()));StringBuilder headers=new StringBuilder();String line;
                    while((line=reader.readLine())!=null && !line.isEmpty())headers.append(line).append('\n');received.complete(headers.toString());
                    client.getOutputStream().write(("HTTP/1.1 "+response+"\r\nConnection: close\r\n\r\nabc").getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                }catch(Exception e){received.completeExceptionally(e);}});thread.start();
                DeviceScope scope=new DeviceScope("owner","http://127.0.0.1:"+server.getLocalPort(),true);
                if(response.startsWith("206") && response.contains(export.version)) {
                    try(InputStream input=export.range(scope,"fixture-cookie",0,3,()->{})){assertArrayEquals(new byte[]{97,98,99},input.readAllBytes());}
                }else assertThrows(IOException.class,()->export.range(scope,"fixture-cookie",0,3,()->{}));
                String headers=received.get(5,java.util.concurrent.TimeUnit.SECONDS);assertTrue(headers.contains("X-Thingtime-Expected-Actor: owner"));assertTrue(headers.contains("Cookie: fixture-cookie"));thread.join(5000);
            }
        }
    }
}
