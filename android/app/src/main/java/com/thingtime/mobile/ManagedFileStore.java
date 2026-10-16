package com.thingtime.mobile;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileDescriptor;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.Locale;
import java.util.UUID;

/** Native backing for Thingtime-owned offline folders. Immutable blobs are
 * durable before SQLite atomically changes a directory entry and its receipt.
 * This is a local storage adapter, not another cloud or settings data model.
 * Generic SAF trees are never passed to this implementation. The bridge must
 * authenticate and check native write approval before calling publication. */
final class ManagedFileStore implements AutoCloseable {
    private final File directory,blobs;
    private final SQLiteDatabase db;
    private final PairingEngine.Check check,beforeCommit,afterCommit;
    ManagedFileStore(Context context,PairingEngine.Check check) throws Exception {
        this(new File(context.getNoBackupFilesDir(),"ManagedFiles-v1"),check,()->{},()->{});
    }
    ManagedFileStore(File directory,PairingEngine.Check check,PairingEngine.Check beforeCommit,PairingEngine.Check afterCommit) throws Exception {
        this.directory=directory;this.blobs=new File(directory,"blobs");this.check=check;this.beforeCommit=beforeCommit;this.afterCommit=afterCommit;
        ensureDirectory(directory);ensureDirectory(blobs);
        File catalog=new File(directory,"catalog.sqlite");
        for(String suffix:new String[]{"","-journal","-wal","-shm"}) {
            File file=new File(catalog.getPath()+suffix);
            if(exists(file))regular(Os.lstat(file.getPath()));
        }
        db=SQLiteDatabase.openOrCreateDatabase(catalog,null);
        try {
            db.disableWriteAheadLogging();db.execSQL("PRAGMA synchronous=FULL");db.execSQL("PRAGMA foreign_keys=ON");
            int version=db.getVersion();if(version!=0 && version!=1)throw unavailable();
            db.beginTransaction();
            try {
                db.execSQL("CREATE TABLE IF NOT EXISTS roots (id TEXT PRIMARY KEY, owner TEXT NOT NULL, origin TEXT NOT NULL, name TEXT NOT NULL)");
                db.execSQL("CREATE TABLE IF NOT EXISTS entries (root TEXT NOT NULL REFERENCES roots(id), path TEXT NOT NULL, folded TEXT NOT NULL, entry TEXT NOT NULL, blob TEXT, PRIMARY KEY(root,path), UNIQUE(root,folded))");
                db.execSQL("CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES roots(id), request TEXT NOT NULL, receipt TEXT NOT NULL)");
                // Retained bytes and versions are recovery material. Timeline
                // remains the user-facing history; retention/restore is separate.
                db.execSQL("CREATE TABLE IF NOT EXISTS retained (id TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES roots(id), operation TEXT NOT NULL, entry TEXT NOT NULL, blob TEXT NOT NULL)");
                db.setVersion(1);db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
            syncDirectory(directory);
        } catch(Exception error) { db.close();throw error; }
    }
    public void close() { db.close(); }
    private static FolderReader.Failure unavailable() { return new FolderReader.Failure("Offline folder storage is unavailable."); }
    private static FolderReader.Failure changed() { return new FolderReader.Failure("The offline folder changed. Keep both versions and check it again."); }
    private static String uuid(String id) throws Exception {
        if(id==null || !UUID.fromString(id).toString().equals(id))throw unavailable();return id;
    }
    private static String folded(String path) { return Normalizer.normalize(path,Normalizer.Form.NFC).toLowerCase(Locale.ROOT); }
    private static boolean exists(File file) throws Exception {
        try { Os.lstat(file.getPath());return true; }catch(ErrnoException error){if(error.errno==OsConstants.ENOENT)return false;throw error;}
    }
    private static void regular(StructStat stat) throws Exception { if(!OsConstants.S_ISREG(stat.st_mode) || stat.st_nlink!=1)throw unavailable(); }
    private static int closeOnExec() { return android.os.Build.VERSION.SDK_INT>=27?OsConstants.O_CLOEXEC:02000000; }
    private static FileDescriptor open(File file,int flags) throws Exception {
        FileDescriptor fd=Os.open(file.getPath(),flags|OsConstants.O_NOFOLLOW|OsConstants.O_NONBLOCK|closeOnExec(),0600);
        try {regular(Os.fstat(fd));return fd;}catch(Exception error){Os.close(fd);throw error;}
    }
    private static void syncDirectory(File directory) throws Exception {
        FileDescriptor fd=Os.open(directory.getPath(),OsConstants.O_RDONLY|OsConstants.O_NONBLOCK|OsConstants.O_NOFOLLOW|closeOnExec(),0);
        try {if(!OsConstants.S_ISDIR(Os.fstat(fd).st_mode))throw unavailable();Os.fsync(fd);}finally{Os.close(fd);}
    }
    private static void ensureDirectory(File directory) throws Exception {
        if(!exists(directory)) {
            try {Os.mkdir(directory.getPath(),0700);}catch(ErrnoException race){if(race.errno!=OsConstants.EEXIST)throw race;}
            syncDirectory(directory.getParentFile());
        }
        if(!OsConstants.S_ISDIR(Os.lstat(directory.getPath()).st_mode))throw unavailable();
    }
    String createRoot(DeviceScope owner,String name) throws Exception {
        FolderReader.path(name);if(name.contains("/"))throw unavailable();check.run();
        db.beginTransaction();
        try {
            if(count("SELECT COUNT(*) FROM roots",new String[0])>=128 || count("SELECT COUNT(*) FROM roots WHERE owner=? AND origin=?",new String[]{owner.owner,owner.origin})>=32)throw unavailable();
            String id=UUID.randomUUID().toString();ContentValues values=new ContentValues();values.put("id",id);values.put("owner",owner.owner);values.put("origin",owner.origin);values.put("name",name);
            db.insertOrThrow("roots",null,values);check.run();db.setTransactionSuccessful();return id;
        } finally {db.endTransaction();}
    }
    private long count(String sql,String[] args) { try(Cursor row=db.rawQuery(sql,args)){if(!row.moveToFirst())return 0;return row.getLong(0);} }
    private void root(DeviceScope owner,String id) throws Exception {
        uuid(id);check.run();
        if(count("SELECT COUNT(*) FROM roots WHERE id=? AND owner=? AND origin=?",new String[]{id,owner.owner,owner.origin})!=1)throw unavailable();
    }
    private static final class Entry {
        final JSONObject json;final String blob;
        Entry(String json,String blob) throws Exception {this.json=new JSONObject(json);this.blob=blob;}
    }
    private Entry entry(String root,String path) throws Exception {
        try(Cursor row=db.rawQuery("SELECT entry,blob FROM entries WHERE root=? AND path=?",new String[]{root,path})) {
            return row.moveToFirst()?new Entry(row.getString(0),row.isNull(1)?null:row.getString(1)):null;
        }
    }
    private JSONObject receipt(String root,String key,JSONObject request) throws Exception {
        try(Cursor row=db.rawQuery("SELECT root,request,receipt FROM receipts WHERE key=?",new String[]{key})) {
            if(!row.moveToFirst())return null;
            if(!root.equals(row.getString(0)) || !SyncStaging.canonical(request).equals(row.getString(1)))throw changed();
            return new JSONObject(row.getString(2));
        }
    }
    JSONObject lookup(DeviceScope owner,String root,String grant,JSONObject input) throws Exception {
        root(owner,root);JSONObject request=SyncStaging.request(input,owner,grant),receipt=receipt(root,SyncStaging.key(request),request);
        return receipt==null?new JSONObject().put("status","missing"):new JSONObject().put("status","complete").put("receipt",receipt);
    }
    private static String stamp(StructStat s) {
        long modified=0,changed=0;
        if(android.os.Build.VERSION.SDK_INT>=27){modified=s.st_mtim.tv_nsec;changed=s.st_ctim.tv_nsec;}
        return s.st_dev+":"+s.st_ino+":"+s.st_size+":"+s.st_mtime+":"+modified+":"+s.st_ctime+":"+changed;
    }
    /** Also verifies copies; source and target offsets are independent. */
    private byte[] verify(FileDescriptor fd,JSONObject source,FileDescriptor copy,long offset,int length) throws Exception {
        StructStat before=Os.fstat(fd);regular(before);long size=source.getLong("size");if(before.st_size!=size)throw changed();
        byte[] selected=new byte[(int)Math.min(length,Math.max(0,size-offset))],buffer=new byte[FolderReader.MAX_READ];
        MessageDigest hash=MessageDigest.getInstance("SHA-256"),part=MessageDigest.getInstance("SHA-256");
        boolean multipart=!source.isNull("fingerprint");long partSize=multipart?source.getJSONObject("fingerprint").getLong("partSizeBytes"):Long.MAX_VALUE;
        long at=0,inPart=0;
        while(at<size) {
            check.run();int wanted=(int)Math.min(buffer.length,Math.min(size-at,partSize-inPart));
            int n=Os.pread(fd,buffer,0,wanted,at);if(n<=0)throw changed();
            if(multipart)part.update(buffer,0,n);else hash.update(buffer,0,n);
            long from=Math.max(at,offset),to=Math.min(at+n,offset+selected.length);
            if(to>from)System.arraycopy(buffer,(int)(from-at),selected,(int)(from-offset),(int)(to-from));
            if(copy!=null) {int written=0;while(written<n){check.run();int m=Os.pwrite(copy,buffer,written,n-written,at+written);if(m<=0)throw unavailable();written+=m;}}
            at+=n;inPart+=n;if(inPart==partSize || at==size){if(multipart)hash.update(part.digest());inPart=0;}
        }
        String digest=multipart?source.getJSONObject("fingerprint").getString("sha256"):source.getString("sha256");
        if(!digest.equals(FolderReader.hex(hash.digest())) || !stamp(before).equals(stamp(Os.fstat(fd))))throw changed();
        return selected;
    }
    JSONObject publish(DeviceScope owner,String root,String grant,JSONObject input,JSONObject stage,SyncStaging staging) throws Exception {
        root(owner,root);JSONObject request=SyncStaging.request(input,owner,grant);String key=SyncStaging.key(request);
        JSONObject completed=receipt(root,key,request);if(completed!=null)return completed;
        JSONObject candidate=staging.withVerifiedPayload(request,owner,grant,stage,(payload,source)-> {
            if(source.getString("kind").equals("folder"))return new JSONObject();
            check.run();String[] existing=blobs.list();if(existing==null || existing.length>=10000)throw unavailable();
            String name=UUID.randomUUID().toString();FileDescriptor destination=open(new File(blobs,name),OsConstants.O_RDWR|OsConstants.O_CREAT|OsConstants.O_EXCL);
            try { verify(payload,source,destination,0,0);Os.fsync(destination);verify(destination,source,null,0,0);syncDirectory(blobs); }
            finally {Os.close(destination);}
            return new JSONObject().put("blob",name);
        });
        // Candidates are never removed on an uncertain commit. A later bounded
        // orphan sweep must prove they are unreferenced before reclaiming bytes.
        check.run();db.beginTransaction();
        JSONObject result;
        try {
            root(owner,root);completed=receipt(root,key,request);if(completed!=null){db.setTransactionSuccessful();return completed;}
            JSONObject mutation=request.getJSONObject("operation").getJSONObject("mutation"),source=mutation.getJSONObject("source");String path=mutation.getString("path");
            Entry previous=entry(root,path);
            if(mutation.isNull("expectedTarget")?previous!=null:previous==null || !SyncStaging.canonical(previous.json).equals(SyncStaging.canonical(mutation.getJSONObject("expectedTarget"))))throw changed();
            if(previous!=null && previous.blob!=null) {
                FileDescriptor old=open(new File(blobs,uuid(previous.blob)),OsConstants.O_RDONLY);
                try {verify(old,previous.json,null,0,0);}finally{Os.close(old);}
            }
            int slash=path.lastIndexOf('/');
            if(slash>=0) {Entry parent=entry(root,path.substring(0,slash));if(parent==null || !parent.json.getString("kind").equals("folder"))throw changed();}
            if(previous==null && count("SELECT COUNT(*) FROM entries WHERE root=?",new String[]{root})>=FolderReader.MAX_ENTRIES)throw unavailable();
            JSONObject published=new JSONObject(source.toString()).put("id",previous==null?UUID.randomUUID().toString():previous.json.getString("id")).put("version",UUID.randomUUID().toString());
            ContentValues values=new ContentValues();values.put("root",root);values.put("path",path);values.put("folded",folded(path));values.put("entry",SyncStaging.canonical(published));
            if(candidate.has("blob"))values.put("blob",candidate.getString("blob"));else values.putNull("blob");
            if(previous==null)db.insertOrThrow("entries",null,values);
            else {
                if(previous.blob==null)throw changed();
                ContentValues retained=new ContentValues();retained.put("id",UUID.randomUUID().toString());retained.put("root",root);retained.put("operation",key);retained.put("entry",SyncStaging.canonical(previous.json));retained.put("blob",previous.blob);
                db.insertOrThrow("retained",null,retained);if(db.update("entries",values,"root=? AND path=?",new String[]{root,path})!=1)throw changed();
            }
            // Ancestor stamps change with descendants; historical receipts stay
            // immutable and must never rewrite a later local edit.
            String parent=path;
            while(parent.lastIndexOf('/')>=0) {
                parent=parent.substring(0,parent.lastIndexOf('/'));Entry ancestor=entry(root,parent);if(ancestor==null)throw changed();
                ContentValues update=new ContentValues();update.put("entry",SyncStaging.canonical(new JSONObject(ancestor.json.toString()).put("version",UUID.randomUUID().toString())));
                db.update("entries",update,"root=? AND path=?",new String[]{root,parent});
            }
            result=new JSONObject().put("operationId",request.getJSONObject("operation").getString("id")).put("scope",request.getJSONObject("scope")).put("entry",published);
            ContentValues receipt=new ContentValues();receipt.put("key",key);receipt.put("root",root);receipt.put("request",SyncStaging.canonical(request));receipt.put("receipt",SyncStaging.canonical(result));
            db.insertOrThrow("receipts",null,receipt);check.run();beforeCommit.run();check.run();db.setTransactionSuccessful();
        } finally {db.endTransaction();}
        afterCommit.run();return result;
    }
    JSONArray scan(DeviceScope owner,String root) throws Exception {
        root(owner,root);JSONArray result=new JSONArray();int bytes=2;db.beginTransaction();
        try(Cursor rows=db.rawQuery("SELECT entry,blob FROM entries WHERE root=? ORDER BY path",new String[]{root})) {
            while(rows.moveToNext()) {
                check.run();JSONObject entry=new JSONObject(rows.getString(0));bytes+=rows.getString(0).getBytes(StandardCharsets.UTF_8).length+1;
                if(result.length()>=FolderReader.MAX_ENTRIES || bytes>4*1024*1024)throw unavailable();
                if(!rows.isNull(1)) {FileDescriptor fd=open(new File(blobs,uuid(rows.getString(1))),OsConstants.O_RDONLY);try{verify(fd,entry,null,0,0);}finally{Os.close(fd);}}
                result.put(entry);
            }
            db.setTransactionSuccessful();return result;
        } finally {db.endTransaction();}
    }
    JSONObject read(DeviceScope owner,String root,String path,String version,long offset,int length) throws Exception {
        root(owner,root);FolderReader.path(path);if(offset<0 || length<0 || length>FolderReader.MAX_READ)throw unavailable();
        Entry selected=entry(root,path);
        if(selected==null || selected.blob==null || !selected.json.getString("version").equals(version) || offset>selected.json.getLong("size"))throw changed();
        FileDescriptor fd=open(new File(blobs,uuid(selected.blob)),OsConstants.O_RDONLY);
        try {
            byte[] bytes=verify(fd,selected.json,null,offset,length);Entry current=entry(root,path);
            if(current==null || !SyncStaging.canonical(current.json).equals(SyncStaging.canonical(selected.json)))throw changed();
            return new JSONObject().put("data",java.util.Base64.getEncoder().encodeToString(bytes)).put("offset",offset).put("size",selected.json.getLong("size")).put("version",version);
        } finally {Os.close(fd);}
    }
}
