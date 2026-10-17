package com.thingtime.mobile;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.*;

/** Provider-independent bounded reader. SAF timestamps are not content versions.
 * Opt-in ranges verify every touched chunk against a complete observed file;
 * legacy reads and final publication checks still verify the whole source. */
final class FolderReader {
    static final int MAX_ENTRIES=10000, MAX_READ=65536;
    static final class Failure extends Exception { Failure(String message) { super(message); } }
    static final class Doc {
        final String id,name; final boolean directory; final long size,modified;
        Doc(String id,String name,boolean directory,long size,long modified) { this.id=id;this.name=name;this.directory=directory;this.size=size;this.modified=modified; }
        String metadata() { return new JSONArray().put(id).put(name).put(directory).put(size).put(modified).toString(); }
    }
    interface Provider { Doc root() throws Exception; Doc stat(String id) throws Exception; List<Doc> children(String id) throws Exception; InputStream open(String id) throws Exception; }
    static final class ProofCache {
        static final int MAX_BYTES=8*1024*1024, MAX_FILES=512;
        private final LinkedHashMap<String,byte[]> entries=new LinkedHashMap<>(16,.75f,true);
        private int bytes; private long generation;
        synchronized long generation() { return generation; }
        synchronized byte[] get(String key,long expected) { return expected==generation?entries.get(key):null; }
        synchronized void put(String key,byte[] proof,long expected) { if(expected==generation)put(key,proof); }
        synchronized void put(String key,byte[] proof) {
            if(proof==null || proof.length>MAX_BYTES) return;
            byte[] previous=entries.remove(key);if(previous!=null)bytes-=previous.length;
            while(!entries.isEmpty() && (entries.size()>=MAX_FILES || bytes+proof.length>MAX_BYTES)) {
                String oldest=entries.keySet().iterator().next();bytes-=entries.remove(oldest).length;
            }
            entries.put(key,proof);bytes+=proof.length;
        }
        synchronized void clear() { generation++;entries.clear();bytes=0; }
    }
    private final Provider provider; private final PairingEngine.Check check;
    private final ProofCache proofs; private final String namespace; private final long proofGeneration;
    FolderReader(Provider provider,PairingEngine.Check check) { this(provider,check,new ProofCache(),"isolated"); }
    FolderReader(Provider provider,PairingEngine.Check check,ProofCache proofs,String namespace) { this.provider=provider;this.check=check;this.proofs=proofs;this.namespace=namespace;this.proofGeneration=proofs.generation(); }
    private String proofKey(Doc doc,String version) throws Exception { return hash(namespace+"\0"+doc.metadata()+"\0"+version); }
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
        MessageDigest composite=MessageDigest.getInstance("SHA-256"), part=MessageDigest.getInstance("SHA-256"), chunk=MessageDigest.getInstance("SHA-256");
        long chunkCount=(doc.size+MAX_READ-1)/MAX_READ;
        ByteArrayOutputStream chunkProof=chunkCount<=ProofCache.MAX_BYTES/32?new ByteArrayOutputStream((int)chunkCount*32):null;
        int inChunk=0;
        Content result=new Content(); result.bytes=new byte[(int)Math.min(length,doc.size-offset)];
        long at=0,inPart=0; byte[] buffer=new byte[MAX_READ];
        try(InputStream input=provider.open(doc.id)) {
            if(input==null) throw unavailable();
            while(at<doc.size) {
                check.run(); int wanted=(int)Math.min(buffer.length,Math.min(doc.size-at,Math.min(partSize-inPart,MAX_READ-inChunk))); int n=input.read(buffer,0,wanted);
                if(n<=0) throw unavailable();
                long from=Math.max(at,offset), to=Math.min(at+n,offset+result.bytes.length);
                if(to>from) System.arraycopy(buffer,(int)(from-at),result.bytes,(int)(from-offset),(int)(to-from));
                part.update(buffer,0,n);if(chunkProof!=null)chunk.update(buffer,0,n);at+=n;inPart+=n;inChunk+=n;
                if(inChunk==MAX_READ || at==doc.size) { if(chunkProof!=null)chunkProof.write(chunk.digest());inChunk=0; }
                if(inPart==partSize || at==doc.size) { composite.update(part.digest());inPart=0; }
            }
            check.run(); if(input.read()!=-1) throw unavailable();
        }
        if(!doc.metadata().equals(provider.stat(doc.id).metadata())) throw unavailable();
        result.digest=hex(composite.digest());
        if(doc.size>0) result.fingerprint=new JSONObject().put("algorithm","sha256-parts-v1").put("partSizeBytes",partSize).put("partCount",(doc.size+partSize-1)/partSize).put("sha256",result.digest);
        check.run();if(chunkProof!=null)proofs.put(proofKey(doc,version(doc,result.digest)),chunkProof.toByteArray(),proofGeneration);return result;
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
    private byte[] verifiedRange(Doc doc,String expected,long offset,int length,byte[] proof) throws Exception {
        if(doc.directory || offset<0 || offset>doc.size || length<=0 || length>MAX_READ || proof.length!=((doc.size+MAX_READ-1)/MAX_READ)*32) throw unavailable();
        byte[] result=new byte[(int)Math.min(length,doc.size-offset)];
        if(result.length==0) return result;
        long first=offset/MAX_READ, last=(offset+result.length-1)/MAX_READ, at=first*MAX_READ;
        try(InputStream input=provider.open(doc.id)) {
            if(input==null)throw unavailable();
            long remaining=at;
            while(remaining>0) { check.run();long skipped=input.skip(remaining);if(skipped<0 || skipped>remaining)throw unavailable();if(skipped==0){if(input.read()<0)throw unavailable();skipped=1;}remaining-=skipped; }
            for(long index=first;index<=last;index++) {
                byte[] chunk=new byte[(int)Math.min(MAX_READ,doc.size-at)];int count=0;
                while(count<chunk.length) { check.run();int n=input.read(chunk,count,chunk.length-count);if(n<=0)throw unavailable();count+=n; }
                byte[] digest=MessageDigest.getInstance("SHA-256").digest(chunk);
                if(!MessageDigest.isEqual(digest,Arrays.copyOfRange(proof,(int)index*32,(int)index*32+32)))throw unavailable();
                long from=Math.max(offset,at),to=Math.min(offset+result.length,at+chunk.length);
                if(to>from)System.arraycopy(chunk,(int)(from-at),result,(int)(from-offset),(int)(to-from));
                at+=chunk.length;
            }
            if(at==doc.size && input.read()!=-1)throw unavailable();
        }
        check.run();if(!doc.metadata().equals(provider.stat(doc.id).metadata()))throw unavailable();return result;
    }
    JSONObject read(String path,String expected,long offset,int length,boolean verifiedChunks) throws Exception {
        if(length<=0 || length>MAX_READ || expected.length()>512)throw unavailable();
        Doc doc=resolve(path);byte[] proof=verifiedChunks?proofs.get(proofKey(doc,expected),proofGeneration):null;
        byte[] bytes;
        if(proof==null) {
            Content content=content(doc,offset,length);
            if(!expected.equals(version(doc,content.digest)))throw unavailable();bytes=content.bytes;
        } else bytes=verifiedRange(doc,expected,offset,length,proof);
        if(!doc.metadata().equals(resolve(path).metadata()))throw unavailable();check.run();
        return new JSONObject().put("version",expected).put("size",doc.size).put("offset",offset).put("data",java.util.Base64.getEncoder().encodeToString(bytes));
    }
    JSONObject read(String path,String expected,long offset,int length) throws Exception {
        return read(path,expected,offset,length,false);
    }
}
