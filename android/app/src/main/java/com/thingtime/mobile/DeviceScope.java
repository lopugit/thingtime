package com.thingtime.mobile;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class DeviceScope {
    final String owner;
    final String origin;
    DeviceScope(String owner, String url, boolean development) throws Exception {
        if (owner == null || owner.isEmpty() || owner.length() > 128) throw new IllegalArgumentException("Invalid account");
        this.owner = owner; this.origin = origin(url, development);
    }
    static String origin(String value, boolean development) throws Exception {
        URI uri = new URI(value);
        String host = uri.getHost();
        if (host == null || uri.getRawUserInfo() != null || uri.isOpaque()) throw new IllegalArgumentException("Invalid destination");
        String scheme = uri.getScheme().toLowerCase(java.util.Locale.ROOT);
        host = host.toLowerCase(java.util.Locale.ROOT);
        if (!scheme.equals("https") && !(development && scheme.equals("http") && (host.equals("localhost") || host.equals("127.0.0.1")))) {
            throw new IllegalArgumentException("Use an HTTPS destination");
        }
        int port = uri.getPort();
        if (port > 65535 || port == 0) throw new IllegalArgumentException("Invalid port");
        if ((scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80)) port = -1;
        return new URI(scheme, null, host, port, null, null, null).toASCIIString();
    }
    boolean matches(String owner, String origin) { return this.owner.equals(owner) && this.origin.equals(origin); }
    String key() throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest((origin + "\0" + owner).getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder(); for (byte b : hash) out.append(String.format("%02x", b)); return out.toString();
    }
}
