package com.thingtime.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import java.net.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;


public class NativeUploadHttpTest {
    interface Handler {void handle(HttpExchange exchange) throws IOException;}
    static final class Headers extends HashMap<String,List<String>> {
        void add(String key,String value){computeIfAbsent(key.toLowerCase(Locale.ROOT),k->new ArrayList<>()).add(value);}
        String getFirst(String key){List<String> values=get(key.toLowerCase(Locale.ROOT));return values==null?null:values.get(0);}
    }
    static final class HttpExchange implements AutoCloseable {
        final Socket socket;final InputStream input;final OutputStream output;final Headers request=new Headers(),response=new Headers();final String path;final byte[] body;
        HttpExchange(Socket socket) throws IOException {
            this.socket=socket;socket.setSoTimeout(10000);input=socket.getInputStream();output=socket.getOutputStream();
            path=line(input).split(" ")[1];String header;
            while(!(header=line(input)).isEmpty()){int colon=header.indexOf(':');request.add(header.substring(0,colon),header.substring(colon+1).trim());}
            int length=Integer.parseInt(Optional.ofNullable(request.getFirst("Content-Length")).orElse("0"));body=new byte[length];int at=0;
            while(at<length){int n=input.read(body,at,length-at);if(n<0)throw new EOFException();at+=n;}
        }
        static String line(InputStream input) throws IOException {ByteArrayOutputStream bytes=new ByteArrayOutputStream();int b;while((b=input.read())!=-1&&b!=10){if(b!=13)bytes.write(b);if(bytes.size()>65536)throw new IOException();}if(b<0)throw new EOFException();return bytes.toString("US-ASCII");}
        Headers getRequestHeaders(){return request;} Headers getResponseHeaders(){return response;}
        InputStream getRequestBody(){return new ByteArrayInputStream(body);} OutputStream getResponseBody(){return output;}
        void sendResponseHeaders(int status,long length) throws IOException {
            StringBuilder h=new StringBuilder("HTTP/1.1 ").append(status).append(" Response\r\nContent-Length: ").append(length).append("\r\nConnection: close\r\n");
            for(Map.Entry<String,List<String>> e:response.entrySet())for(String value:e.getValue())h.append(e.getKey()).append(": ").append(value).append("\r\n");
            output.write(h.append("\r\n").toString().getBytes(StandardCharsets.US_ASCII));output.flush();
        }
        public void close(){try{socket.close();}catch(IOException ignored){}}
    }
    static final class HttpServer {
        final ServerSocket socket;final Map<String,Handler> handlers=new HashMap<>();final ExecutorService worker=Executors.newSingleThreadExecutor();
        private HttpServer(InetSocketAddress address) throws IOException {socket=new ServerSocket();socket.bind(address);}
        static HttpServer create(InetSocketAddress address,int backlog) throws IOException{return new HttpServer(address);}
        InetSocketAddress getAddress(){return (InetSocketAddress)socket.getLocalSocketAddress();}
        void createContext(String path,Handler handler){handlers.put(path,handler);}
        void start(){worker.submit(()->{while(!socket.isClosed()){try(HttpExchange e=new HttpExchange(socket.accept())){Handler h=handlers.get(e.path);if(h==null)respond(e,404,"missing");else h.handle(e);}catch(IOException ignored){}}});}
        void stop(int delay){try{socket.close();}catch(IOException ignored){}worker.shutdownNow();}
    }

    static JSONObject signed(String url) throws Exception {return new JSONObject().put("ok",true).put("parts",new JSONArray().put(new JSONObject()
        .put("partNumber",1).put("url",url).put("headers",new JSONObject().put("x-amz-checksum-sha256","digest"))));}
    static void respond(HttpExchange exchange,int status,String body) throws IOException {
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(status,bytes.length);
        try(OutputStream output=exchange.getResponseBody()){output.write(bytes);}finally{exchange.close();}
    }
    static DeviceScope scope(HttpServer server) throws Exception {return new DeviceScope("owner","http://127.0.0.1:"+server.getAddress().getPort(),true);}
    @Test public void apiPinsOnlyAuthCookieAndStorageHasNoAmbientCredentialsOrRedirects() throws Exception {
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        AtomicReference<Headers> apiHeaders=new AtomicReference<>(),storageHeaders=new AtomicReference<>();
        AtomicInteger redirects=new AtomicInteger(),puts=new AtomicInteger();AtomicReference<byte[]> uploaded=new AtomicReference<>();
        server.createContext("/api/v1/test",e->{apiHeaders.set(e.getRequestHeaders());e.getResponseHeaders().add("Set-Cookie","tt_auth=server-change");respond(e,200,"{\"ok\":true}");});
        server.createContext("/storage",e->{storageHeaders.set(e.getRequestHeaders());puts.incrementAndGet();uploaded.set(e.getRequestBody().readAllBytes());respond(e,200,"ok");});
        server.createContext("/redirect",e->{e.getResponseHeaders().add("Location","/storage");respond(e,307,"redirect");});
        server.createContext("/api/v1/redirect",e->{redirects.incrementAndGet();e.getResponseHeaders().add("Location","/api/v1/test");respond(e,302,"redirect");});
        server.createContext("/unauthorized",e->{e.getResponseHeaders().add("WWW-Authenticate","Basic realm=storage");respond(e,401,"auth");});
        server.start();Path file=Files.createTempFile("native-http-",".bin");Files.write(file,new byte[]{1,2,3});
        CookieHandler prior=CookieHandler.getDefault();java.net.Authenticator priorAuth=(java.net.Authenticator)java.net.Authenticator.class.getMethod("getDefault").invoke(null);AtomicInteger authCalls=new AtomicInteger();
        CookieHandler.setDefault(new CookieHandler(){public Map<String,List<String>> get(URI u,Map<String,List<String>> h){return Map.of("Cookie",List.of("ambient=secret"));}public void put(URI u,Map<String,List<String>> h){}});
        java.net.Authenticator.setDefault(new java.net.Authenticator(){protected PasswordAuthentication getPasswordAuthentication(){authCalls.incrementAndGet();return new PasswordAuthentication("ambient","secret".toCharArray());}});
        try(NativeUploadHttp http=new NativeUploadHttp(scope(server),url->"theme=dark; tt_auth=pinned; analytics=ignore",()->{})) {
            assertTrue(http.json("/api/v1/test",new JSONObject()).getBoolean("ok"));
            assertEquals("tt_auth=pinned",apiHeaders.get().getFirst("Cookie"));assertEquals(scope(server).origin,apiHeaders.get().getFirst("Origin"));
            http.put(signed("/storage"),file,"digest",3,1);assertArrayEquals(new byte[]{1,2,3},uploaded.get());
            assertNull(storageHeaders.get().getFirst("Cookie"));assertNull(storageHeaders.get().getFirst("Authorization"));assertNull(storageHeaders.get().getFirst("Origin"));
            assertThrows(Exception.class,()->http.put(signed("/redirect"),file,"digest",3,1));assertEquals(1,puts.get());
            assertThrows(Exception.class,()->http.put(signed("/unauthorized"),file,"digest",3,1));assertEquals(0,authCalls.get());
            assertThrows(Exception.class,()->http.json("/api/v1/redirect",null));assertEquals(1,redirects.get());
        } finally {CookieHandler.setDefault(prior);java.net.Authenticator.setDefault(priorAuth);server.stop(0);Files.delete(file);}
    }
    @Test public void rejectsChangedSessionAndOversizedResponsesAndCancelsActiveCall() throws Exception {
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
        server.createContext("/api/v1/large",e->respond(e,200," ".repeat(512*1024+1)));
        server.createContext("/api/v1/wait",e->{entered.countDown();try{release.await(10,TimeUnit.SECONDS);respond(e,200,"{}");}catch(Exception stopped){e.close();}});server.start();
        String[] cookie={"tt_auth=pinned"};ExecutorService worker=Executors.newSingleThreadExecutor();
        try(NativeUploadHttp http=new NativeUploadHttp(scope(server),url->cookie[0],()->{})) {
            assertThrows(Exception.class,()->http.json("/api/v1/large",null));cookie[0]="tt_auth=changed";
            assertThrows(Exception.class,()->http.json("/api/v1/wait",null));assertEquals(1,entered.getCount());cookie[0]="tt_auth=pinned";
            Future<?> future=worker.submit(()->{assertThrows(Exception.class,()->http.json("/api/v1/wait",null));});
            assertTrue(entered.await(5,TimeUnit.SECONDS));http.close();future.get(5,TimeUnit.SECONDS);
            assertThrows(Exception.class,http::check);
        } finally {release.countDown();worker.shutdownNow();server.stop(0);}
    }
    @Test public void boundedRateLimitRetriesPreserveTheExactReservationBody() throws Exception {
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);AtomicInteger attempts=new AtomicInteger();List<String> bodies=new ArrayList<>();
        server.createContext("/api/v1/retry",e->{bodies.add(new String(e.body,StandardCharsets.UTF_8));if(attempts.incrementAndGet()==1){e.getResponseHeaders().add("Retry-After","1");respond(e,429,"busy");}else respond(e,200,"{\"ok\":true}");});
        server.createContext("/api/v1/unbounded",e->{e.getResponseHeaders().add("Retry-After","999");respond(e,429,"busy");});server.start();
        try(NativeUploadHttp http=new NativeUploadHttp(scope(server),url->"tt_auth=pinned",()->{})) {
            JSONObject body=new JSONObject().put("requestId","original-operation");assertTrue(http.json("/api/v1/retry",body).getBoolean("ok"));
            assertEquals(List.of(body.toString(),body.toString()),bodies);assertEquals(2,attempts.get());
            assertThrows(Exception.class,()->http.json("/api/v1/unbounded",body));
        } finally {server.stop(0);}
    }
    @Test public void signedDestinationRejectsExtraHeadersForeignHttpAndMalformedAuthority() throws Exception {
        DeviceScope scope=new DeviceScope("owner","http://127.0.0.1:12345",true);
        assertEquals("https://storage.test/part",NativeUploadHttp.destination(signed("https://storage.test/part"),scope,"digest",1));
        assertEquals(scope.origin+"/part",NativeUploadHttp.destination(signed("/part"),scope,"digest",1));
        for(String target:List.of("http://storage.test/part","http://127.0.0.1:54321/part","https://user:pass@storage.test/part","https://storage.test/part#fragment","file:///part"))
            assertThrows(Exception.class,()->NativeUploadHttp.destination(signed(target),scope,"digest",1));
        JSONObject extra=signed("https://storage.test/part");extra.getJSONArray("parts").getJSONObject(0).getJSONObject("headers").put("Authorization","secret");
        assertThrows(Exception.class,()->NativeUploadHttp.destination(extra,scope,"digest",1));
        assertThrows(Exception.class,()->NativeUploadHttp.destination(signed("/part"),scope,"changed",1));
        assertThrows(Exception.class,()->NativeUploadHttp.destination(signed("/part"),scope,"digest",2));
    }
}
