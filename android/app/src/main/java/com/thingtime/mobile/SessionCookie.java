package com.thingtime.mobile;

import java.io.IOException;

/** Mirrors auth/authCookie.ts: only tt_auth authenticates a browser request. */
final class SessionCookie {
    static String auth(String header) throws IOException {
        if(header==null || header.length()>65536 || header.indexOf('\r')>=0 || header.indexOf('\n')>=0)throw invalid();
        String auth=null;
        for(String raw:header.split(";")) {
            String pair=raw.trim();int equals=pair.indexOf('=');
            if(equals<0 || !"tt_auth".equals(pair.substring(0,equals)))continue;
            String value=pair.substring(equals+1);
            // Duplicate names can have different path precedence. Refuse to
            // guess which token the server would select.
            if(auth!=null || value.isEmpty() || value.chars().anyMatch(c->c<=32 || c>=127))throw invalid();
            auth="tt_auth="+value;
        }
        if(auth==null)throw invalid();return auth;
    }
    private static IOException invalid(){return new IOException("Sign in again before saving this version.");}
}
