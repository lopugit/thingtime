package com.thingtime.mobile;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.net.URI;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.LinkOption;
import java.nio.file.StandardOpenOption;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.CookieJar;
import okhttp3.Authenticator;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSink;
import org.json.JSONArray;
import org.json.JSONObject;

/** Explicit cookie authentication goes only to the selected account API. Signed
 * storage PUTs use an isolated client with no cookies, authenticators or redirects. */
final class NativeUploadHttp implements NativeUploadJob.Transport,AutoCloseable {
    private final DeviceScope scope;
    private final DeviceHttpTransport.Cookies cookies;
    private final PairingEngine.Check current;
    private final String authentication;
    private final OkHttpClient storage=new OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
        .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE).followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).cache(null).connectTimeout(15,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS)
        .writeTimeout(60,TimeUnit.SECONDS).callTimeout(900,TimeUnit.SECONDS).build();
    private final OkHttpClient api=storage.newBuilder().callTimeout(30,TimeUnit.SECONDS).build();
    private final Object mutex=new Object();
    private Call active;
    private volatile boolean closed;
    NativeUploadHttp(DeviceScope scope,DeviceHttpTransport.Cookies cookies,PairingEngine.Check current) throws Exception {
        this.scope=scope;this.cookies=cookies;this.current=current;
        authentication=SessionCookie.auth(cookies.get(scope.origin+"/api/v1/auth/me"));check();
    }
    void check() throws Exception {
        if(closed)throw new java.util.concurrent.CancellationException();current.run();
        if(!authentication.equals(SessionCookie.auth(cookies.get(scope.origin+"/api/v1/auth/me"))))throw NativeUploadRequest.invalid();
    }
    private void ioCheck() throws IOException {
        try {check();}catch(IOException e){throw e;}catch(Exception e){throw new IOException("Native upload stopped.",e);}
    }
    private Call call(OkHttpClient client,Request request) throws Exception {
        check();synchronized(mutex) {
            if(closed || active!=null)throw new java.util.concurrent.CancellationException();
            active=client.newCall(request);return active;
        }
    }
    private void finished(Call call) {synchronized(mutex){if(active==call)active=null;}}
    private byte[] read(Response response,int maximum) throws Exception {
        if(response.body()==null || response.body().contentLength()>maximum)throw NativeUploadRequest.invalid();
        try(InputStream input=response.body().byteStream();ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[8192];int count;
            while((count=input.read(buffer))!=-1) {check();if(output.size()+count>maximum)throw NativeUploadRequest.invalid();output.write(buffer,0,count);}
            check();return output.toByteArray();
        }
    }
    @Override public JSONObject json(String path,JSONObject body) throws Exception {
        if(!(path.startsWith("/api/v1/")||path.equals("/.well-known/thingtime-capabilities.json")) || path.contains("#"))throw NativeUploadRequest.invalid();
        String url=scope.origin+path;
        for(int attempt=0;attempt<4;attempt++) {
            check();if(!authentication.equals(SessionCookie.auth(cookies.get(url))))throw NativeUploadRequest.invalid();
            Request.Builder request=new Request.Builder().url(url).header("Accept","application/json").header("Accept-Encoding","identity")
                .header("Origin",scope.origin).header("Cookie",authentication);
            if(body!=null)request.post(RequestBody.create(body.toString().getBytes(StandardCharsets.UTF_8),MediaType.get("application/json")));
            Call call=call(api,request.build());int delay=-1;
            try(Response response=call.execute()) {
                check();if(response.code()==429 && attempt<3) {
                    String retry=response.header("Retry-After");
                    if(retry!=null && retry.matches("[0-9]{1,3}"))delay=Integer.parseInt(retry);
                    if(delay<1||delay>120)throw new PairingEngine.Failure("Upload rate limit reached. Wait before retrying.",429);
                } else {
                    if(!response.isSuccessful())throw new PairingEngine.Failure("The server could not finish this upload. Retry to resume saved work.",response.code());
                    JSONObject result=new JSONObject(new String(read(response,512*1024),StandardCharsets.UTF_8));
                    check();return result;
                }
            } finally {finished(call);}
            long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(delay);
            while(System.nanoTime()<end){check();Thread.sleep(100);}
        }
        throw NativeUploadRequest.invalid();
    }
    void require() throws Exception {
        JSONObject manifest=json("/.well-known/thingtime-capabilities.json",null);
        if(!scope.origin.equals(manifest.getString("origin"))||SyncStaging.integer(manifest,"schemaVersion",1)!=1)throw NativeUploadRequest.invalid();
        JSONObject features=manifest.getJSONObject("features");
        for(String[] feature:new String[][]{{"api.auth-me","1.0.0"},{"api.things","1.35.0"},{"api.attachment-uploads","1.5.0"},
            {"api.attachment-upload-parts","1.1.0"},{"api.attachment-upload-complete","1.4.0"}})
            if(!PairingEngine.compatible(features.getJSONObject(feature[0]).getString("version"),feature[1]))throw NativeUploadRequest.invalid();
    }
    static String destination(JSONObject signed,DeviceScope scope,String checksum,int number) throws Exception {
        JSONArray parts=signed.getJSONArray("parts");if(!Boolean.TRUE.equals(signed.opt("ok"))||parts.length()!=1)throw NativeUploadRequest.invalid();
        JSONObject part=parts.getJSONObject(0),headers=part.getJSONObject("headers");
        if(SyncStaging.integer(part,"partNumber",10000)!=number || headers.length()!=1 || !checksum.equals(headers.getString("x-amz-checksum-sha256")))throw NativeUploadRequest.invalid();
        String raw=SyncStaging.text(part,"url",16384);URI target=new URI(scope.origin).resolve(raw);
        if(target.getHost()==null||target.getRawUserInfo()!=null||target.getRawFragment()!=null||
            !("https".equals(target.getScheme())||"http".equals(target.getScheme())&&scope.origin.equals(DeviceScope.origin(target.toString(),true))))throw NativeUploadRequest.invalid();
        return target.toASCIIString();
    }
    @Override public void put(JSONObject signed,Path file,String checksum,long length,int number) throws Exception {
        String target=destination(signed,scope,checksum,number);check();
        RequestBody body=new RequestBody() {
            @Override public MediaType contentType(){return null;}
            @Override public long contentLength(){return length;}
            @Override public boolean isOneShot(){return true;}
            @Override public void writeTo(BufferedSink sink) throws IOException {
                try(FileChannel channel=FileChannel.open(file,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS);InputStream input=Channels.newInputStream(channel)) {
                    if(channel.size()!=length)throw new IOException("Upload part changed.");
                    byte[] buffer=new byte[65536];long sent=0;
                    while(sent<length) {ioCheck();int count=input.read(buffer,0,(int)Math.min(buffer.length,length-sent));if(count<=0)throw new IOException("Upload part changed.");sink.write(buffer,0,count);sent+=count;}
                    ioCheck();if(input.read()!=-1)throw new IOException("Upload part changed.");
                }
            }
        };
        Request request=new Request.Builder().url(target).put(body).header("x-amz-checksum-sha256",checksum).header("Accept-Encoding","identity").build();
        Call call=call(storage,request);
        try(Response response=call.execute()) {
            check();if(!response.isSuccessful())throw new PairingEngine.Failure("Upload interrupted. Retry to resume saved work.",response.code());
            read(response,65536);check();
        } finally {finished(call);}
    }
    @Override public void close() {
        synchronized(mutex){closed=true;if(active!=null)active.cancel();}
        storage.connectionPool().evictAll();
    }
}
