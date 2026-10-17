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
            if(db.getVersion()!=4) {
                db.beginTransaction();
                try {
                    int version=db.getVersion();if(version<0 || version>4)throw unavailable();
                    db.execSQL("CREATE TABLE IF NOT EXISTS roots (id TEXT PRIMARY KEY, owner TEXT NOT NULL, origin TEXT NOT NULL, name TEXT NOT NULL)");
                    db.execSQL("CREATE TABLE IF NOT EXISTS entries (root TEXT NOT NULL REFERENCES roots(id), path TEXT NOT NULL, folded TEXT NOT NULL, entry TEXT NOT NULL, blob TEXT, PRIMARY KEY(root,path), UNIQUE(root,folded))");
                    db.execSQL("CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES roots(id), request TEXT NOT NULL, receipt TEXT NOT NULL)");
                    // Retained bytes and versions are recovery material. Timeline
                    // remains the user-facing history; retention/restore is separate.
                    db.execSQL("CREATE TABLE IF NOT EXISTS retained (id TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES roots(id), operation TEXT NOT NULL, entry TEXT NOT NULL, blob TEXT NOT NULL)");
                    if(version<2) {
                        db.execSQL("ALTER TABLE roots ADD COLUMN filesVisible INTEGER NOT NULL DEFAULT 0");
                        db.execSQL("ALTER TABLE entries ADD COLUMN document TEXT");
                        db.execSQL("ALTER TABLE entries ADD COLUMN parent TEXT");
                        try(Cursor rows=db.rawQuery("SELECT root,path,entry FROM entries",null)) {
                            while(rows.moveToNext()) {
                                check.run();JSONObject entry=new JSONObject(rows.getString(2));ContentValues update=documentColumns(entry);
                                db.update("entries",update,"root=? AND path=?",new String[]{rows.getString(0),rows.getString(1)});
                            }
                        }
                        db.execSQL("CREATE UNIQUE INDEX entries_document ON entries(root,document)");
                        db.execSQL("CREATE INDEX entries_parent ON entries(root,parent,path)");
                    }
                    db.execSQL("CREATE TABLE IF NOT EXISTS trash_receipts (key TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES roots(id), grantId TEXT NOT NULL, request TEXT NOT NULL, retainedEntry TEXT NOT NULL, blob TEXT, receipt TEXT NOT NULL, parentAfter TEXT, restoration TEXT)");
                    db.execSQL("CREATE INDEX IF NOT EXISTS trash_recovery_page ON trash_receipts(root,grantId,key) WHERE restoration IS NULL");
                    if(version<4) {
                        db.execSQL("ALTER TABLE retained ADD COLUMN grantId TEXT");
                        db.execSQL("ALTER TABLE retained ADD COLUMN capturedAt INTEGER");
                        try(Cursor rows=db.rawQuery("SELECT v.id,v.root,r.root,r.request FROM retained v LEFT JOIN receipts r ON r.key=v.operation",null)) {
                            while(rows.moveToNext()) {
                                check.run();if(rows.isNull(2) || !rows.getString(1).equals(rows.getString(2)))throw unavailable();
                                JSONObject request=new JSONObject(rows.getString(3));ContentValues update=new ContentValues();
                                update.put("grantId",SyncStaging.uuid(request,"rootId"));
                                db.update("retained",update,"id=?",new String[]{rows.getString(0)});
                            }
                        }
                    }
                    db.execSQL("CREATE INDEX IF NOT EXISTS retained_versions_page ON retained(root,grantId,id)");
                    db.execSQL("CREATE TABLE IF NOT EXISTS version_restores (key TEXT PRIMARY KEY, root TEXT NOT NULL REFERENCES roots(id), grantId TEXT NOT NULL, request TEXT NOT NULL, receipt TEXT NOT NULL)");
                    db.setVersion(4);db.setTransactionSuccessful();
                } finally { db.endTransaction(); }
                syncDirectory(directory);
            }
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
            ContentValues values=documentColumns(published);values.put("root",root);values.put("path",path);values.put("folded",folded(path));values.put("entry",SyncStaging.canonical(published));
            if(candidate.has("blob"))values.put("blob",candidate.getString("blob"));else values.putNull("blob");
            if(previous==null)db.insertOrThrow("entries",null,values);
            else {
                if(previous.blob==null)throw changed();
                ContentValues retained=new ContentValues();retained.put("id",UUID.randomUUID().toString());retained.put("root",root);retained.put("operation",key);retained.put("grantId",grant);retained.put("capturedAt",System.currentTimeMillis());retained.put("entry",SyncStaging.canonical(previous.json));retained.put("blob",previous.blob);
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
    private static final class TrashRow {
        final JSONObject request,entry,receipt,parentAfter,restoration;final String blob;
        TrashRow(Cursor row) throws Exception {
            request=new JSONObject(row.getString(0));entry=SyncStaging.entry(new JSONObject(row.getString(1)));
            blob=row.isNull(2)?null:row.getString(2);receipt=new JSONObject(row.getString(3));
            parentAfter=row.isNull(4)?null:SyncStaging.entry(new JSONObject(row.getString(4)));
            restoration=row.isNull(5)?null:new JSONObject(row.getString(5));
            if(!SyncTrash.same(receipt,SyncTrash.receipt(request)))throw changed();
        }
    }
    private TrashRow trashRow(String root,String grant,JSONObject request) throws Exception {
        try(Cursor row=db.rawQuery("SELECT request,retainedEntry,blob,receipt,parentAfter,restoration FROM trash_receipts WHERE key=? AND root=? AND grantId=?",
            new String[]{SyncStaging.key(request),root,grant})) {
            if(!row.moveToFirst())return null;TrashRow value=new TrashRow(row);
            if(!SyncTrash.same(value.request,request))throw changed();return value;
        }
    }
    private TrashRow requireTrash(String root,String grant,JSONObject request) throws Exception {
        TrashRow row=trashRow(root,grant,request);if(row==null)throw changed();return row;
    }
    private JSONObject resolvedTrash(String root,String grant,JSONObject request,JSONObject expected,String previous) throws Exception {
        if(previous==null)return expected;
        JSONObject lookup=new JSONObject(request.toString());lookup.getJSONObject("operation").put("id",previous);
        // Resolve by key, then validate the predecessor's own immutable payload.
        try(Cursor row=db.rawQuery("SELECT request,retainedEntry,blob,receipt,parentAfter,restoration FROM trash_receipts WHERE key=? AND root=? AND grantId=?",
            new String[]{SyncStaging.key(lookup),root,grant})) {
            if(!row.moveToFirst())throw changed();TrashRow prior=new TrashRow(row);
            JSONObject parent=prior.request.optJSONObject("parent");
            if(parent==null || !SyncTrash.same(prior.request.getJSONObject("scope"),request.getJSONObject("scope")) ||
                !previous.equals(prior.request.getJSONObject("operation").getString("id")) || !grant.equals(prior.request.getString("rootId")) ||
                !SyncTrash.same(parent.getJSONObject("expected"),expected) || prior.restoration!=null || prior.parentAfter==null ||
                !expected.getString("id").equals(prior.parentAfter.getString("id")) || !expected.getString("path").equals(prior.parentAfter.getString("path")) ||
                !"folder".equals(prior.parentAfter.getString("kind")))throw changed();
            return prior.parentAfter;
        }
    }
    private static String optional(JSONObject value,String key) throws Exception{return value.isNull(key)?null:value.getString(key);}
    JSONObject trashExpected(DeviceScope owner,String root,String grant,JSONObject input) throws Exception {
        root(owner,root);JSONObject request=SyncTrash.request(input,owner,grant);
        return resolvedTrash(root,grant,request,SyncTrash.mutation(request).getJSONObject("expected"),optional(request,"childrenOperationId"));
    }
    JSONObject trashLookup(DeviceScope owner,String root,String grant,JSONObject input) throws Exception {
        root(owner,root);JSONObject request=SyncTrash.request(input,owner,grant);TrashRow row=trashRow(root,grant,request);
        return row==null?new JSONObject().put("status","missing"):new JSONObject().put("status","complete").put("receipt",row.receipt);
    }
    private void verifyRetained(TrashRow row) throws Exception {
        if("folder".equals(row.entry.getString("kind"))) {if(row.blob!=null)throw changed();return;}
        if(row.blob==null)throw changed();FileDescriptor fd=open(new File(blobs,uuid(row.blob)),OsConstants.O_RDONLY);
        try{verify(fd,row.entry,null,0,0);}finally{Os.close(fd);}
    }
    private JSONObject bumpDirectParent(String root,String path) throws Exception {
        String parent=SyncTrash.parent(path);if(parent.isEmpty())return null;Entry previous=entry(root,parent);
        if(previous==null || !"folder".equals(previous.json.getString("kind")))throw changed();
        JSONObject after=new JSONObject(previous.json.toString()).put("version",UUID.randomUUID().toString());ContentValues update=new ContentValues();update.put("entry",SyncStaging.canonical(after));
        if(db.update("entries",update,"root=? AND path=?",new String[]{root,parent})!=1)throw changed();return after;
    }
    /** Removal, retained blob reference, parent transition and receipt share one
     * FULL-synchronous SQLite transaction. Immutable blob bytes are never unlinked. */
    JSONObject trash(DeviceScope owner,String root,String grant,JSONObject input) throws Exception {
        root(owner,root);JSONObject request=SyncTrash.request(input,owner,grant),result;db.beginTransaction();
        try {
            root(owner,root);TrashRow existing=trashRow(root,grant,request);if(existing!=null)return existing.receipt;
            JSONObject m=SyncTrash.mutation(request),expected=resolvedTrash(root,grant,request,m.getJSONObject("expected"),optional(request,"childrenOperationId"));
            String path=m.getString("path");Entry current=entry(root,path);if(current==null || !SyncTrash.same(current.json,expected))throw changed();
            if(!request.isNull("parent")) {
                JSONObject proof=request.getJSONObject("parent"),parentExpected=resolvedTrash(root,grant,request,proof.getJSONObject("expected"),optional(proof,"previousOperationId"));
                Entry parent=entry(root,SyncTrash.parent(path));if(parent==null || !SyncTrash.same(parent.json,parentExpected))throw changed();
            }
            if("folder".equals(expected.getString("kind"))) {
                if(current.blob!=null || count("SELECT COUNT(*) FROM entries WHERE root=? AND parent=?",new String[]{root,path})!=0)throw changed();
            } else {
                if(current.blob==null)throw changed();FileDescriptor fd=open(new File(blobs,uuid(current.blob)),OsConstants.O_RDONLY);
                try{verify(fd,expected,null,0,0);}finally{Os.close(fd);}
            }
            if(db.delete("entries","root=? AND path=?",new String[]{root,path})!=1)throw changed();
            JSONObject after=bumpDirectParent(root,path);result=SyncTrash.receipt(request);
            ContentValues row=new ContentValues();row.put("key",SyncStaging.key(request));row.put("root",root);row.put("grantId",grant);
            row.put("request",SyncStaging.canonical(request));row.put("retainedEntry",SyncStaging.canonical(current.json));row.put("blob",current.blob);
            row.put("receipt",SyncStaging.canonical(result));if(after!=null)row.put("parentAfter",SyncStaging.canonical(after));
            db.insertOrThrow("trash_receipts",null,row);check.run();beforeCommit.run();check.run();db.setTransactionSuccessful();
        } finally{db.endTransaction();}
        afterCommit.run();return result;
    }
    JSONObject trashInspect(DeviceScope owner,String root,String grant,JSONObject input) throws Exception {
        root(owner,root);JSONObject request=SyncTrash.request(input,owner,grant);TrashRow row=requireTrash(root,grant,request);
        if(row.restoration==null)verifyRetained(row);
        return new JSONObject().put("retainedEntry",row.restoration==null?row.entry:JSONObject.NULL)
            .put("restoreIntent",row.restoration==null?JSONObject.NULL:row.restoration);
    }
    JSONObject trashList(DeviceScope owner,String root,String grant,String cursor) throws Exception {
        root(owner,root);uuid(grant);if(cursor!=null && !cursor.matches("[a-f0-9]{64}"))throw changed();
        JSONArray items=new JSONArray();String next=null,last=null;
        try(Cursor rows=db.rawQuery("SELECT key,request,retainedEntry FROM trash_receipts WHERE root=? AND grantId=? AND restoration IS NULL AND key>? ORDER BY key LIMIT 21",
            new String[]{root,grant,cursor==null?"":cursor})) {
            while(rows.moveToNext()) {
                check.run();if(items.length()==20){next=last;break;}last=rows.getString(0);
                JSONObject request=SyncTrash.request(new JSONObject(rows.getString(1)),owner,grant),entry=SyncStaging.entry(new JSONObject(rows.getString(2)));
                if(!last.equals(SyncStaging.key(request)))throw changed();
                items.put(new JSONObject().put("request",request).put("kind",entry.getString("kind")).put("size",entry.getLong("size")).put("state","retained"));
            }
        }
        return new JSONObject().put("items",items).put("nextCursor",next==null?JSONObject.NULL:next);
    }
    private void restorable(String root,TrashRow row,JSONObject restore) throws Exception {
        if(!SyncTrash.same(row.entry,restore.getJSONObject("expected")))throw changed();verifyRetained(row);String path=restore.getString("path");
        if(count("SELECT COUNT(*) FROM entries WHERE root=? AND folded=?",new String[]{root,folded(path)})!=0 ||
            count("SELECT COUNT(*) FROM entries WHERE root=?",new String[]{root})>=FolderReader.MAX_ENTRIES)throw changed();
        String parent=SyncTrash.parent(path);if(!parent.isEmpty()) {
            Entry directory=entry(root,parent);if(directory==null || !"folder".equals(directory.json.getString("kind")))throw changed();
        }
    }
    void reviewTrashRestore(DeviceScope owner,String root,String grant,JSONObject input,JSONObject restoreInput) throws Exception {
        root(owner,root);JSONObject request=SyncTrash.request(input,owner,grant),restore=SyncTrash.restore(request,restoreInput);
        db.beginTransaction();try{TrashRow row=requireTrash(root,grant,request);if(row.restoration!=null)throw changed();restorable(root,row,restore);db.setTransactionSuccessful();}finally{db.endTransaction();}
    }
    /** Return an existing exact receipt without another approval. New restoration
     * requires consent; destination insertion and its immutable receipt commit together. */
    JSONObject restoreTrash(DeviceScope owner,String root,String grant,JSONObject input,JSONObject restoreInput,boolean approved) throws Exception {
        root(owner,root);JSONObject request=SyncTrash.request(input,owner,grant),restore=SyncTrash.restore(request,restoreInput),result;db.beginTransaction();
        try {
            root(owner,root);TrashRow row=requireTrash(root,grant,request);
            if(row.restoration!=null) {
                if(!SyncTrash.same(row.restoration.getJSONObject("request"),restore))throw changed();return row.restoration.getJSONObject("receipt");
            }
            if(!approved)return null;restorable(root,row,restore);
            String path=restore.getString("path");result=new JSONObject(row.entry.toString()).put("path",path).put("version",UUID.randomUUID().toString());
            ContentValues values=documentColumns(result);values.put("root",root);values.put("path",path);values.put("folded",folded(path));values.put("entry",SyncStaging.canonical(result));values.put("blob",row.blob);
            db.insertOrThrow("entries",null,values);bumpDirectParent(root,path);
            ContentValues update=new ContentValues();update.put("restoration",SyncStaging.canonical(new JSONObject().put("request",restore).put("receipt",result)));
            if(db.update("trash_receipts",update,"key=? AND root=? AND grantId=?",new String[]{SyncStaging.key(request),root,grant})!=1)throw changed();
            check.run();beforeCommit.run();check.run();db.setTransactionSuccessful();
        }finally{db.endTransaction();}
        afterCommit.run();return result;
    }
    /** Publication-retained versions use the existing immutable blobs and catalog.
     * They remain available after restore; each copy has its own durable operation. */
    private Entry retainedVersion(DeviceScope owner,String root,String grant,String versionId) throws Exception {
        root(owner,root);uuid(grant);uuid(versionId);
        try(Cursor row=db.rawQuery("SELECT v.entry,v.blob,r.request,r.root FROM retained v JOIN receipts r ON r.key=v.operation WHERE v.id=? AND v.root=? AND v.grantId=?",
            new String[]{versionId,root,grant})) {
            if(!row.moveToFirst() || !root.equals(row.getString(3)))throw changed();
            JSONObject publication=SyncStaging.request(new JSONObject(row.getString(2)),owner,grant);
            Entry value=new Entry(row.getString(0),uuid(row.getString(1)));
            JSONObject entry=SyncStaging.entry(value.json),expected=publication.getJSONObject("operation").getJSONObject("mutation").getJSONObject("expectedTarget");
            if(!"file".equals(entry.getString("kind")) || !SyncTrash.same(entry,expected))throw changed();return value;
        }
    }
    private void verifyVersion(Entry value) throws Exception {
        FileDescriptor fd=open(new File(blobs,uuid(value.blob)),OsConstants.O_RDONLY);
        try{verify(fd,value.json,null,0,0);}finally{Os.close(fd);}
    }
    JSONObject versionList(DeviceScope owner,String root,String grant,String cursor) throws Exception {
        root(owner,root);uuid(grant);if(cursor!=null)uuid(cursor);JSONArray items=new JSONArray();String next=null,last=null;
        try(Cursor rows=db.rawQuery("SELECT id,capturedAt FROM retained WHERE root=? AND grantId=? AND id>? ORDER BY id LIMIT 21",new String[]{root,grant,cursor==null?"":cursor})) {
            while(rows.moveToNext()) {
                check.run();if(items.length()==20){next=last;break;}last=rows.getString(0);
                Entry version=retainedVersion(owner,root,grant,last);
                items.put(new JSONObject().put("versionId",last).put("entry",version.json).put("capturedAt",rows.isNull(1)?JSONObject.NULL:rows.getLong(1)));
            }
        }
        return new JSONObject().put("items",items).put("nextCursor",next==null?JSONObject.NULL:next);
    }
    JSONObject versionInspect(DeviceScope owner,String root,String grant,String versionId) throws Exception {
        Entry value=retainedVersion(owner,root,grant,versionId);verifyVersion(value);check.run();return value.json;
    }
    private JSONObject versionRestoreRequest(JSONObject input) throws Exception {
        if(input.toString().getBytes(StandardCharsets.UTF_8).length>65536)throw changed();
        String path=SyncStaging.text(input,"path",4096);FolderReader.path(path);
        JSONObject expected=SyncStaging.entry(input.getJSONObject("expected"));if(!"file".equals(expected.getString("kind")))throw changed();
        return new JSONObject().put("versionId",SyncStaging.uuid(input,"versionId")).put("operationId",SyncStaging.uuid(input,"operationId")).put("path",path).put("expected",expected);
    }
    private String versionRestoreKey(DeviceScope owner,String root,String grant,JSONObject request) throws Exception {
        return FolderReader.hex(MessageDigest.getInstance("SHA-256").digest(new JSONArray().put(owner.owner).put(owner.origin).put(root).put(grant).put(request.getString("operationId")).toString().getBytes(StandardCharsets.UTF_8)));
    }
    private JSONObject versionRestoreReceipt(String root,String grant,String key,JSONObject request) throws Exception {
        try(Cursor row=db.rawQuery("SELECT root,grantId,request,receipt FROM version_restores WHERE key=?",new String[]{key})) {
            if(!row.moveToFirst())return null;
            if(!root.equals(row.getString(0)) || !grant.equals(row.getString(1)) || !SyncStaging.canonical(request).equals(row.getString(2)))throw changed();
            return SyncStaging.entry(new JSONObject(row.getString(3)));
        }
    }
    private Entry reviewVersion(String root,DeviceScope owner,String grant,JSONObject request) throws Exception {
        Entry value=retainedVersion(owner,root,grant,request.getString("versionId"));
        if(!SyncTrash.same(value.json,request.getJSONObject("expected")))throw changed();verifyVersion(value);
        String path=request.getString("path"),parent=SyncTrash.parent(path);
        if(count("SELECT COUNT(*) FROM entries WHERE root=? AND folded=?",new String[]{root,folded(path)})!=0 || count("SELECT COUNT(*) FROM entries WHERE root=?",new String[]{root})>=FolderReader.MAX_ENTRIES)throw changed();
        if(!parent.isEmpty()) {Entry directory=entry(root,parent);if(directory==null || !"folder".equals(directory.json.getString("kind")))throw changed();}
        return value;
    }
    void reviewVersionRestore(DeviceScope owner,String root,String grant,JSONObject input) throws Exception {
        root(owner,root);uuid(grant);JSONObject request=versionRestoreRequest(input);
        db.beginTransaction();try{reviewVersion(root,owner,grant,request);check.run();db.setTransactionSuccessful();}finally{db.endTransaction();}
    }
    JSONObject restoreVersion(DeviceScope owner,String root,String grant,JSONObject input,boolean approved) throws Exception {
        root(owner,root);uuid(grant);JSONObject request=versionRestoreRequest(input);String key=versionRestoreKey(owner,root,grant,request);JSONObject result;
        db.beginTransaction();try {
            root(owner,root);result=versionRestoreReceipt(root,grant,key,request);if(result!=null)return result;
            if(!approved)return null;Entry value=reviewVersion(root,owner,grant,request);String path=request.getString("path");
            // A restored version is an independent file. Reusing the live file's
            // document ID would collide with the current version and alias readers.
            result=new JSONObject(value.json.toString()).put("id",UUID.randomUUID().toString()).put("version",UUID.randomUUID().toString()).put("path",path);
            ContentValues values=documentColumns(result);values.put("root",root);values.put("path",path);values.put("folded",folded(path));values.put("entry",SyncStaging.canonical(result));values.put("blob",value.blob);
            db.insertOrThrow("entries",null,values);bumpDirectParent(root,path);
            ContentValues receipt=new ContentValues();receipt.put("key",key);receipt.put("root",root);receipt.put("grantId",grant);receipt.put("request",SyncStaging.canonical(request));receipt.put("receipt",SyncStaging.canonical(result));db.insertOrThrow("version_restores",null,receipt);
            check.run();beforeCommit.run();check.run();db.setTransactionSuccessful();
        }finally{db.endTransaction();}
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
        if(length>FolderReader.MAX_READ)throw unavailable();return readBytes(owner,root,path,version,offset,length).chunk();
    }
    FolderReader.Range readRange(DeviceScope owner,String root,String path,String version,long offset,int length) throws Exception {
        if(length<1)throw unavailable();FolderReader.Range range=readBytes(owner,root,path,version,offset,length);
        if(range.bytes.length!=length)throw changed();return range;
    }
    private FolderReader.Range readBytes(DeviceScope owner,String root,String path,String version,long offset,int length) throws Exception {
        root(owner,root);FolderReader.path(path);if(offset<0 || length<0 || length>FolderReader.MAX_RANGE)throw unavailable();
        Entry selected=entry(root,path);
        if(selected==null || selected.blob==null || !selected.json.getString("version").equals(version) || offset>selected.json.getLong("size"))throw changed();
        FileDescriptor fd=open(new File(blobs,uuid(selected.blob)),OsConstants.O_RDONLY);
        try {
            byte[] bytes=verify(fd,selected.json,null,offset,length);Entry current=entry(root,path);
            if(current==null || !SyncStaging.canonical(current.json).equals(SyncStaging.canonical(selected.json)))throw changed();
            return new FolderReader.Range(version,selected.json.getLong("size"),offset,bytes);
        } finally {Os.close(fd);}
    }
    private static ContentValues documentColumns(JSONObject entry) throws Exception {
        String path=entry.getString("path");int slash=path.lastIndexOf('/');ContentValues values=new ContentValues();
        values.put("document",uuid(entry.getString("id")));values.put("parent",slash<0?"":path.substring(0,slash));return values;
    }
    /** Explicit native creation consent precedes exposure in Android Files.
     * Existing private roots stay hidden across the version-1 migration. */
    void exposeInFiles(DeviceScope owner,String id) throws Exception {
        root(owner,id);ContentValues values=new ContentValues();values.put("filesVisible",1);
        if(db.update("roots",values,"id=? AND owner=? AND origin=?",new String[]{id,owner.owner,owner.origin})!=1)throw unavailable();
    }
    void requireFilesRoot(DeviceScope owner,String id) throws Exception {root(owner,id);if(document(id).entry!=null)throw unavailable();}
    static final class Document {
        final String root,id,name,path;final JSONObject entry;
        Document(String root,String name,JSONObject entry) throws Exception {
            this.root=root;this.entry=entry;this.path=entry==null?"":entry.getString("path");
            this.id=entry==null?root:root+":"+uuid(entry.getString("id"));
            this.name=entry==null?name:path.substring(path.lastIndexOf('/')+1);
        }
        boolean folder() throws Exception {return entry==null || entry.getString("kind").equals("folder");}
    }
    java.util.List<Document> filesRoots() throws Exception {
        check.run();java.util.List<Document> result=new java.util.ArrayList<>();
        try(Cursor rows=db.rawQuery("SELECT id,name FROM roots WHERE filesVisible=1 ORDER BY name,id LIMIT 129",null)) {
            while(rows.moveToNext()){check.run();if(result.size()>=128)throw unavailable();result.add(new Document(uuid(rows.getString(0)),rows.getString(1),null));}
        }
        return result;
    }
    Document document(String id) throws Exception {
        check.run();if(id==null || id.length()>73)throw unavailable();String[] pieces=id.split(":",-1);
        if(pieces.length<1 || pieces.length>2)throw unavailable();String root=uuid(pieces[0]),name;
        try(Cursor row=db.rawQuery("SELECT name FROM roots WHERE id=? AND filesVisible=1",new String[]{root})) {
            if(!row.moveToFirst())throw unavailable();name=row.getString(0);
        }
        if(pieces.length==1)return new Document(root,name,null);
        try(Cursor row=db.rawQuery("SELECT entry FROM entries WHERE root=? AND document=?",new String[]{root,uuid(pieces[1])})) {
            if(!row.moveToFirst())throw unavailable();return new Document(root,name,new JSONObject(row.getString(0)));
        }
    }
    java.util.List<Document> children(String parentId) throws Exception {
        Document parent=document(parentId);if(!parent.folder())throw unavailable();java.util.List<Document> result=new java.util.ArrayList<>();int bytes=0;
        try(Cursor rows=db.rawQuery("SELECT entry FROM entries WHERE root=? AND parent=? ORDER BY path LIMIT 10001",new String[]{parent.root,parent.path})) {
            while(rows.moveToNext()) {
                check.run();String json=rows.getString(0);bytes+=json.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
                if(result.size()>=FolderReader.MAX_ENTRIES || bytes>4*1024*1024)throw unavailable();
                result.add(new Document(parent.root,"",new JSONObject(json)));
            }
        }
        return result;
    }
    android.provider.DocumentsContract.Path documentPath(String parentId,String childId) throws Exception {
        Document child=document(childId),parent=document(parentId==null?child.root:parentId);
        if(!parent.id.equals(child.id) && !descendant(parent.id,child.id))throw unavailable();
        java.util.LinkedList<String> ids=new java.util.LinkedList<>();ids.add(child.id);String path=child.path;
        while(!path.equals(parent.path)) {
            check.run();int slash=path.lastIndexOf('/');path=slash<0?"":path.substring(0,slash);
            if(path.isEmpty())ids.addFirst(child.root);
            else {Entry ancestor=entry(child.root,path);if(ancestor==null || !ancestor.json.getString("kind").equals("folder"))throw unavailable();ids.addFirst(child.root+":"+uuid(ancestor.json.getString("id")));}
            if(ids.size()>256)throw unavailable();
        }
        return new android.provider.DocumentsContract.Path(parentId==null?child.root:null,ids);
    }
    boolean descendant(String parentId,String childId) throws Exception {
        Document parent=document(parentId),child=document(childId);
        return parent.folder() && parent.root.equals(child.root) && !parent.id.equals(child.id) && (parent.path.isEmpty() || child.path.startsWith(parent.path+"/"));
    }
    /** Returns a read-only, verified snapshot. Publication never mutates a blob;
     * an already open reader keeps its original version across replacement. */
    android.os.ParcelFileDescriptor openDocument(String id) throws Exception {
        Document document=document(id);if(document.folder())throw unavailable();Entry selected=entry(document.root,document.path);
        if(selected==null || selected.blob==null || !SyncStaging.canonical(selected.json).equals(SyncStaging.canonical(document.entry)))throw changed();
        FileDescriptor fd=open(new File(blobs,uuid(selected.blob)),OsConstants.O_RDONLY);
        try {verify(fd,selected.json,null,0,0);check.run();return android.os.ParcelFileDescriptor.dup(fd);}finally{Os.close(fd);}
    }

}
