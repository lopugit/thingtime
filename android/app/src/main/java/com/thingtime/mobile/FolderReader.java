package com.thingtime.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.*;

/** Provider-independent bounded reader. A read verifies the whole observed
 * fingerprint because SAF timestamps are not reliable content versions. */
final class FolderReader {
    static final int MAX_ENTRIES=10000, MAX_READ=65536;
    static final class Failure extends Exception { Failure(String message) { super(message); } }
    static final class Doc {
        final String id,name; final boolean directory; final long size,modified;
        Doc(String id,String name,boolean directory,long size,long modified) { this.id=id;this.name=name;this.directory=directory;this.size=size;this.modified=modified; }
        String metadata() { return new JSONArray().put(id).put(name).put(directory).put(size).put(modified).toString(); }
    }
    interface Provider { Doc root() throws Exception; Doc stat(String id) throws Exception; List<Doc> children(String id) throws Exception; InputStream open(String id) throws Exception; }
    private final Provider provider; private final PairingEngine.Check check;
    FolderReader(Provider provider,PairingEngine.Check check) { this.provider=provider;this.check=check; }
    private static Failure unavailable() { return new Failure("Folder contents are unavailable or changed. Check the folder again."); }
    static void path(String path) throws Failure {
        if(path.isEmpty() || path.length()>4096 || path.contains("\\") || path.split("/",-1).length>128) throw unavailable();
        for(String name:path.split("/",-1)) name(name);
    }
    private static void name(String name) throws Failure {
        if(name.isEmpty() || name.length()>255 || name.equals(".") || name.equals("..") || name.contains("/") || name.contains("\\") || name.codePoints().anyMatch(c->Character.isISOControl(c) || Character.getType(c)==Character.FORMAT)) throw unavailable();
    }
    private static void valid(Doc doc) throws Failure {
        name(doc.name);
        if(doc.id==null || doc.id.isEmpty() || doc.id.length()>4096 || doc.size<0 || doc.size>9007199254740991L || doc.modified<0 || doc.modified>9007199254740991L) throw unavailable();
    }
    private List<Doc> children(Doc directory) throws Exception {
        check.run(); List<Doc> rows=new ArrayList<>(provider.children(directory.id));
        if(rows.size()>MAX_ENTRIES) throw new Failure("Folder exceeds the scan limit. Choose a smaller folder.");
        Set<String> names=new HashSet<>(),ids=new HashSet<>();
        for(Doc row:rows) { valid(row); if(!names.add(Normalizer.normalize(row.name,Normalizer.Form.NFC).toLowerCase(Locale.ROOT)) || !ids.add(row.id)) throw unavailable(); }
        rows.sort(Comparator.comparing(r->r.name)); return rows;
    }
    static String hex(byte[] bytes) { StringBuilder out=new StringBuilder();for(byte b:bytes) out.append(String.format(Locale.ROOT,"%02x",b));return out.toString(); }
    static String hash(String text) throws Exception { return hex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
    private static String listing(List<Doc> rows) throws Exception { StringBuilder text=new StringBuilder();for(Doc row:rows) text.append(row.metadata()).append('\n');return hash(text.toString()); }
    private static final class Content { JSONObject fingerprint; String digest; byte[] bytes; }
    private Content content(Doc doc,long offset,int length) throws Exception {
        check.run(); valid(doc); if(doc.directory || offset<0 || offset>doc.size || length<0 || length>MAX_READ) throw unavailable();
        long mib=1048576L, partSize=((Math.max(8*mib,(doc.size+9999)/10000)+mib-1)/mib)*mib;
        if(partSize>5*1024*mib) throw new Failure("File exceeds the current transfer limit.");
        MessageDigest composite=MessageDigest.getInstance("SHA-256"), part=MessageDigest.getInstance("SHA-256");
        Content result=new Content(); result.bytes=new byte[(int)Math.min(length,doc.size-offset)];
        long at=0,inPart=0; byte[] buffer=new byte[MAX_READ];
        try(InputStream input=provider.open(doc.id)) {
            if(input==null) throw unavailable();
            while(at<doc.size) {
                check.run(); int wanted=(int)Math.min(buffer.length,Math.min(doc.size-at,partSize-inPart)); int n=input.read(buffer,0,wanted);
                if(n<=0) throw unavailable();
                long from=Math.max(at,offset), to=Math.min(at+n,offset+result.bytes.length);
                if(to>from) System.arraycopy(buffer,(int)(from-at),result.bytes,(int)(from-offset),(int)(to-from));
                part.update(buffer,0,n);at+=n;inPart+=n;
                if(inPart==partSize || at==doc.size) { composite.update(part.digest());inPart=0; }
            }
            check.run(); if(input.read()!=-1) throw unavailable();
        }
        if(!doc.metadata().equals(provider.stat(doc.id).metadata())) throw unavailable();
        result.digest=hex(composite.digest());
        if(doc.size>0) result.fingerprint=new JSONObject().put("algorithm","sha256-parts-v1").put("partSizeBytes",partSize).put("partCount",(doc.size+partSize-1)/partSize).put("sha256",result.digest);
        check.run(); return result;
    }
    private static String version(Doc doc,String digest) throws Exception { return hash(doc.metadata()+"\0"+digest); }
    JSONArray scan() throws Exception {
        Doc root=provider.root();valid(root);if(!root.directory) throw unavailable();
        JSONArray entries=new JSONArray(); Set<String> ids=new HashSet<>();ids.add(root.id);
        Map<String,String> directories=new LinkedHashMap<>(); Map<String,String> metadata=new LinkedHashMap<>(); int[] budget={2};
        walk(root,"",entries,ids,directories,metadata,budget);
        for(Map.Entry<String,String> saved:directories.entrySet()) if(!saved.getValue().equals(listing(children(provider.stat(saved.getKey()))))) throw unavailable();
        for(Map.Entry<String,String> saved:metadata.entrySet()) { check.run();if(!saved.getValue().equals(provider.stat(saved.getKey()).metadata())) throw unavailable(); }
        if(!root.metadata().equals(provider.root().metadata())) throw unavailable(); check.run(); return entries;
    }
    private void walk(Doc directory,String prefix,JSONArray entries,Set<String> ids,Map<String,String> directories,Map<String,String> metadata,int[] budget) throws Exception {
        List<Doc> rows=children(directory);directories.put(directory.id,listing(rows));metadata.put(directory.id,directory.metadata());
        for(Doc doc:rows) {
            check.run();String path=prefix.isEmpty()?doc.name:prefix+"/"+doc.name;path(path);
            if(!ids.add(doc.id)) throw unavailable();if(entries.length()>=MAX_ENTRIES) throw new Failure("Folder exceeds the scan limit. Choose a smaller folder.");
            JSONObject entry=new JSONObject().put("path",path).put("id",hash(doc.id)).put("kind",doc.directory?"folder":"file").put("size",doc.directory?0:doc.size).put("sha256",JSONObject.NULL);
            entries.put(entry);
            if(doc.directory) { walk(doc,path,entries,ids,directories,metadata,budget);entry.put("version",version(doc,directories.get(doc.id))); }
            else {
                Content content=content(doc,0,0);entry.put("version",version(doc,content.digest));
                if(content.fingerprint==null) entry.put("sha256",content.digest);else entry.put("fingerprint",content.fingerprint);
                metadata.put(doc.id,doc.metadata());
            }
            budget[0]+=entry.toString().getBytes(StandardCharsets.UTF_8).length+1;
            if(budget[0]>4*1024*1024) throw new Failure("Folder metadata exceeds the scan limit. Choose a smaller folder.");
        }
    }
    private Doc resolve(String path) throws Exception {
        path(path);Doc current=provider.root();
        for(String name:path.split("/")) {
            if(!current.directory) throw unavailable();Doc next=null;
            for(Doc child:children(current)) if(child.name.equals(name)) next=child;
            if(next==null) throw unavailable();current=next;
        }
        return current;
    }
    JSONObject read(String path,String expected,long offset,int length) throws Exception {
        if(length<=0 || length>MAX_READ || expected.length()>512) throw unavailable();
        Doc doc=resolve(path);Content content=content(doc,offset,length);
        if(!expected.equals(version(doc,content.digest)) || !doc.metadata().equals(resolve(path).metadata())) throw unavailable();
        return new JSONObject().put("version",expected).put("size",doc.size).put("offset",offset).put("data",java.util.Base64.getEncoder().encodeToString(content.bytes));
    }
}
