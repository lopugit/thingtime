package com.thingtime.mobile;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;

final class DeviceHttpTransport implements PairingEngine.Transport {
    interface Cookies { String get(String url) throws Exception; }
    private final Cookies cookies; private final PairingEngine.Check check;
    DeviceHttpTransport(Cookies cookies,PairingEngine.Check check) { this.cookies=cookies; this.check=check; }
    @Override public JSONObject request(DeviceScope scope,String path,String body,String credential,boolean authenticated) throws Exception {
        check.run();
        if(!path.startsWith("/api/v1/") && !path.equals("/.well-known/thingtime-capabilities.json")) throw new PairingEngine.Failure("Invalid device request.");
        URL url=new URL(scope.origin+path); HttpURLConnection connection=(HttpURLConnection)url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(20000);
            connection.setRequestProperty("Origin",scope.origin); connection.setUseCaches(false); connection.setRequestProperty("Accept","application/json");
            if(authenticated) {
                if(credential!=null) throw new PairingEngine.Failure("Invalid authentication mode.");
                String cookie=cookies.get(url.toString()); check.run();
                if(cookie!=null && !cookie.isEmpty()) connection.setRequestProperty("Cookie",cookie);
            }
            if(credential!=null) connection.setRequestProperty("Authorization","Bearer "+credential);
            if(body!=null) {
                byte[] bytes=body.getBytes(StandardCharsets.UTF_8); connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type","application/json"); connection.setFixedLengthStreamingMode(bytes.length);
                check.run(); try(java.io.OutputStream output=connection.getOutputStream()) { output.write(bytes); }
            }
            int status=connection.getResponseCode(); check.run();
            if(status<200 || status>=300) throw new PairingEngine.Failure(status==401?"Sign in again or reconnect this device.":"The server could not finish this request. Retry to resume saved work.",status);
            try(InputStream input=connection.getInputStream(); ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[8192]; int count;
                while((count=input.read(buffer))!=-1) { check.run(); if(output.size()+count>512*1024) throw new PairingEngine.Failure("Server response is too large."); output.write(buffer,0,count); }
                check.run(); return new JSONObject(output.toString("UTF-8"));
            }
        } finally { connection.disconnect(); }
    }
}
