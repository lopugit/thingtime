package com.thingtime.mobile;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.DocumentsContract.Root;
import android.system.Os;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.provider.ProviderTestRule;
import org.json.JSONObject;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;
import java.util.UUID;

/** Real ContentResolver and production DocumentsProvider, with isolated native
 * storage. The installed-manifest and separate shell-UID check cover the OS gate. */
public class OfflineDocumentsProviderTest {
    static ManagedFileStoreTest fixture;
    static final String AUTHORITY="com.thingtime.offline.test";
    public static class Provider extends OfflineDocumentsProvider {
        @Override public void attachInfo(android.content.Context context,android.content.pm.ProviderInfo info) {
            info.exported=true;info.grantUriPermissions=true;
            info.readPermission="android.permission.MANAGE_DOCUMENTS";info.writePermission=info.readPermission;
            super.attachInfo(context,info);
        }
        @Override protected void observe(android.database.MatrixCursor cursor,String root) {
            // ProviderTestRule has no system notification service; use the real
            // test-app resolver so registration follows Android's normal path.
            android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
            cursor.setNotificationUri(context.getContentResolver(),OfflineDocumentsProvider.rootUri(context,root));
        }
        @Override protected ManagedFileStore store(PairingEngine.Check check) throws Exception {
            return new ManagedFileStore(fixture.managed,check,()->{},()->{});
        }
    }
    @Rule public ProviderTestRule rule=new ProviderTestRule.Builder(Provider.class,AUTHORITY).build();
    @Before public void before() throws Exception {fixture=new ManagedFileStoreTest();fixture.before();}
    @After public void after() throws Exception {fixture.after();}
    Uri uri(String id) {return DocumentsContract.buildDocumentUri(AUTHORITY,id);}
    String id(JSONObject receipt) throws Exception {return fixture.root+":"+receipt.getJSONObject("entry").getString("id");}
    void expose() throws Exception {try(ManagedFileStore store=fixture.store()){store.exposeInFiles(fixture.fixture.owner,fixture.root);}}
    byte[] bytes(ParcelFileDescriptor fd) throws Exception {
        byte[] bytes=new byte[(int)fd.getStatSize()];assertEquals(bytes.length,Os.pread(fd.getFileDescriptor(),bytes,0,bytes.length,0));return bytes;
    }
    @Test public void rootsRequireExplicitExposureAndNeverDiscloseAccountOrPaths() throws Exception {
        try(Cursor rows=rule.getResolver().query(DocumentsContract.buildRootsUri(AUTHORITY),null,null,null,null)){assertEquals(0,rows.getCount());}
        expose();
        try(Cursor rows=rule.getResolver().query(DocumentsContract.buildRootsUri(AUTHORITY),new String[]{Root.COLUMN_TITLE,Root.COLUMN_DOCUMENT_ID,"owner","path"},null,null,null)) {
            assertTrue(rows.moveToFirst());assertEquals("Offline",rows.getString(0));assertEquals(fixture.root,rows.getString(1));assertTrue(rows.isNull(2));assertTrue(rows.isNull(3));assertFalse(rows.moveToNext());
        }
        DeviceScope other=new DeviceScope("other","https://other.test",false);
        try(ManagedFileStore store=fixture.store()){assertThrows(Exception.class,()->store.exposeInFiles(other,fixture.root));assertThrows(Exception.class,()->store.requireFilesRoot(other,fixture.root));}
    }
    @Test public void indexedChildrenStableIdsAndOpenReadersSurviveReplacement() throws Exception {
        expose();JSONObject folder=fixture.folder("nested");byte[] first={1,2,3},second={4,5,6,7};JSONObject receipt=fixture.publish(fixture.request("nested/file.bin",first,false),first);
        Uri children=DocumentsContract.buildChildDocumentsUri(AUTHORITY,fixture.root);
        try(Cursor rows=rule.getResolver().query(children,null,null,null,null)) {
            assertEquals(1,rows.getCount());assertTrue(rows.moveToFirst());assertEquals(id(folder),rows.getString(rows.getColumnIndexOrThrow(Document.COLUMN_DOCUMENT_ID)));
        }
        try(ParcelFileDescriptor old=rule.getResolver().openFileDescriptor(uri(id(receipt)),"r")) {
            JSONObject next=fixture.request("nested/file.bin",second,false);next.getJSONObject("operation").getJSONObject("mutation").put("expectedTarget",receipt.getJSONObject("entry"));
            JSONObject replacement=fixture.publish(next,second);assertEquals(id(receipt),id(replacement));
            try(ParcelFileDescriptor current=rule.getResolver().openFileDescriptor(uri(id(receipt)),"r")){assertArrayEquals(second,bytes(current));}
            assertArrayEquals(first,bytes(old));
            assertThrows(Exception.class,()->Os.pwrite(old.getFileDescriptor(),new byte[]{9},0,1,0));
        }
        try(Cursor row=rule.getResolver().query(uri(id(receipt)),null,null,null,null)) {
            assertTrue(row.moveToFirst());assertEquals("file.bin",row.getString(row.getColumnIndexOrThrow(Document.COLUMN_DISPLAY_NAME)));
            assertEquals(4,row.getLong(row.getColumnIndexOrThrow(Document.COLUMN_SIZE)));assertEquals(0,row.getInt(row.getColumnIndexOrThrow(Document.COLUMN_FLAGS)));
        }
    }
    @Test public void treeRelationshipsFenceSiblingsOtherRootsAndHiddenFiles() throws Exception {
        expose();JSONObject parent=fixture.folder("nested"),file=fixture.publish(fixture.request("nested/file.bin",new byte[]{3},false),new byte[]{3}),sibling=fixture.folder("sibling");
        Provider provider=new Provider();assertTrue(provider.isChildDocument(fixture.root,id(file)));assertTrue(provider.isChildDocument(id(parent),id(file)));
        assertFalse(provider.isChildDocument(id(sibling),id(file)));assertFalse(provider.isChildDocument(id(file),id(file)));assertFalse(provider.isChildDocument(id(file),id(parent)));
        String other;try(ManagedFileStore store=fixture.store()){other=store.createRoot(fixture.fixture.owner,"Other");store.exposeInFiles(fixture.fixture.owner,other);}
        assertEquals(java.util.Arrays.asList(fixture.root,id(parent),id(file)),provider.findDocumentPath(null,id(file)).getPath());
        assertEquals(fixture.root,provider.findDocumentPath(null,id(file)).getRootId());
        assertEquals(java.util.Arrays.asList(id(parent),id(file)),provider.findDocumentPath(id(parent),id(file)).getPath());
        assertNull(provider.findDocumentPath(id(parent),id(file)).getRootId());
        assertEquals(java.util.Arrays.asList(fixture.root),provider.findDocumentPath(null,fixture.root).getPath());
        assertThrows(Exception.class,()->provider.findDocumentPath(other,id(file)));
        assertFalse(provider.isChildDocument(other,id(file)));assertFalse(provider.isChildDocument(fixture.root,other));
        String cross=other+":"+file.getJSONObject("entry").getString("id");assertThrows(Exception.class,()->provider.queryDocument(cross,null));
        for(String bad:new String[]{"../catalog.sqlite",fixture.root+":../blobs",fixture.root+":",fixture.root+":a:b",UUID.randomUUID().toString()}) {
            assertThrows(Exception.class,()->provider.queryDocument(bad,null));assertFalse(provider.isChildDocument(fixture.root,bad));
        }
    }
    @Test public void writesDirectoriesCancellationAndTamperedBytesAreRejected() throws Exception {
        expose();JSONObject receipt=fixture.publish(fixture.request("file.bin",new byte[]{1,2,3},false),new byte[]{1,2,3});Provider provider=new Provider();
        for(String mode:new String[]{"w","rw","rwt","wa","wt","", "R"})assertThrows(Exception.class,()->provider.openDocument(id(receipt),mode,null));
        assertThrows(Exception.class,()->provider.openDocument(fixture.root,"r",null));CancellationSignal signal=new CancellationSignal();signal.cancel();
        assertThrows(android.os.OperationCanceledException.class,()->provider.openDocument(id(receipt),"r",signal));
        File blob=new File(fixture.managed,"blobs").listFiles()[0];Files.write(blob.toPath(),new byte[]{3,2,1});
        assertThrows(Exception.class,()->provider.openDocument(id(receipt),"r",null));
        Files.delete(blob.toPath());Os.symlink(new File(fixture.managed,"catalog.sqlite").getPath(),blob.getPath());
        assertThrows(Exception.class,()->provider.openDocument(id(receipt),"r",null));
    }
    @Test public void versionOneMigrationPreservesIdsAndKeepsRootsPrivate() throws Exception {
        File legacy=new File(fixture.directory,"legacy");assertTrue(legacy.mkdir());String root=UUID.randomUUID().toString(),entryId=UUID.randomUUID().toString();
        JSONObject entry=new JSONObject().put("id",entryId).put("path","nested").put("version","v1").put("kind","folder").put("size",0).put("sha256",JSONObject.NULL).put("fingerprint",JSONObject.NULL);
        try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(new File(legacy,"catalog.sqlite"),null)) {
            db.execSQL("CREATE TABLE roots (id TEXT PRIMARY KEY,owner TEXT NOT NULL,origin TEXT NOT NULL,name TEXT NOT NULL)");
            db.execSQL("CREATE TABLE entries (root TEXT NOT NULL REFERENCES roots(id),path TEXT NOT NULL,folded TEXT NOT NULL,entry TEXT NOT NULL,blob TEXT,PRIMARY KEY(root,path),UNIQUE(root,folded))");
            db.execSQL("INSERT INTO roots VALUES (?,?,?,?)",new Object[]{root,fixture.fixture.owner.owner,fixture.fixture.owner.origin,"Legacy"});
            db.execSQL("INSERT INTO entries VALUES (?,?,?,?,NULL)",new Object[]{root,"nested","nested",entry.toString()});db.setVersion(1);
        }
        try(ManagedFileStore store=new ManagedFileStore(legacy,()->{},()->{},()->{})) {
            assertEquals(0,store.filesRoots().size());assertThrows(Exception.class,()->store.document(root));
            assertEquals(entryId,store.scan(fixture.fixture.owner,root).getJSONObject(0).getString("id"));store.exposeInFiles(fixture.fixture.owner,root);
            assertEquals(root+":"+entryId,store.children(root).get(0).id);assertEquals("nested",store.document(root+":"+entryId).path);
        }
        try(ManagedFileStore store=new ManagedFileStore(legacy,()->{},()->{},()->{})){assertEquals(1,store.filesRoots().size());assertEquals(root+":"+entryId,store.children(root).get(0).id);}
    }
    @Test public void oversizedDirectoryMetadataFailsWithoutReturningAPartialListing() throws Exception {
        expose();String suffix=new String(new char[1500]).replace('\0','a');
        // Populate the isolated native catalog without thousands of blob writes.
        try(SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(new File(fixture.managed,"catalog.sqlite"),null)) {
            db.beginTransaction();
            try {
                for(int i=0;i<3000;i++) {
                    String path=i+suffix,id=UUID.randomUUID().toString();
                    JSONObject entry=new JSONObject().put("id",id).put("path",path).put("kind","folder");
                    db.execSQL("INSERT INTO entries (root,path,folded,entry,document,parent) VALUES (?,?,?,?,?,?)",new Object[]{fixture.root,path,path,entry.toString(),id,""});
                }
                db.setTransactionSuccessful();
            }finally{db.endTransaction();}
        }
        Provider provider=new Provider();assertThrows(java.io.FileNotFoundException.class,()->provider.queryChildDocuments(fixture.root,null,(String)null));
    }
    @Test public void installedProviderRequiresSystemPermissionAndExplicitUriGrants() throws Exception {
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        android.content.pm.ProviderInfo info=context.getPackageManager().resolveContentProvider(OfflineDocumentsProvider.authority(context),0);
        assertNotNull(info);assertTrue(info.exported);assertTrue(info.grantUriPermissions);
        assertEquals("android.permission.MANAGE_DOCUMENTS",info.readPermission);assertEquals(info.readPermission,info.writePermission);
    }
}
