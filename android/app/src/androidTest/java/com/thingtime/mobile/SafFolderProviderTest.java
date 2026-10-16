package com.thingtime.mobile;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.DocumentsProvider;
import androidx.test.rule.provider.ProviderTestRule;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import static org.junit.Assert.*;
import org.json.*;
import java.io.File;
import java.nio.file.Files;
import java.util.*;

/** Exercises real ContentResolver/DocumentsProvider routing and descriptors
 * against only generated test bytes. Does not claim system-picker acceptance. */
public class SafFolderProviderTest {
    static final String AUTHORITY="com.thingtime.folder.fixture";
    static String mode="normal";static File file;
    @Rule public final ProviderTestRule rule=new ProviderTestRule.Builder(Provider.class,AUTHORITY).build();
    public static class Provider extends DocumentsProvider {
        @Override public void attachInfo(android.content.Context context,android.content.pm.ProviderInfo info) {
            // ProviderTestRule supplies plain ContentProvider metadata. Match the
            // mandatory DocumentsProvider contract inside its isolated resolver.
            info.exported=true;info.grantUriPermissions=true;
            info.readPermission="android.permission.MANAGE_DOCUMENTS";info.writePermission="android.permission.MANAGE_DOCUMENTS";
            super.attachInfo(context,info);
        }
        @Override public boolean onCreate() { return true; }
        @Override public Cursor queryRoots(String[] projection) { return new MatrixCursor(new String[]{DocumentsContract.Root.COLUMN_ROOT_ID}); }
        private Cursor result(boolean directory,String[] projection) {
            // Deliberately reverse columns: adapter must use names, not offsets.
            List<String> names=new ArrayList<>(Arrays.asList(projection));Collections.reverse(names);MatrixCursor c=new MatrixCursor(names.toArray(new String[0]));
            MatrixCursor.RowBuilder row=c.newRow();
            row.add(Document.COLUMN_DOCUMENT_ID,directory?"root":"file").add(Document.COLUMN_DISPLAY_NAME,directory?"Selected":"original.bin")
                .add(Document.COLUMN_MIME_TYPE,directory?Document.MIME_TYPE_DIR:"application/octet-stream")
                .add(Document.COLUMN_SIZE,directory?0:mode.equals("unknown")?null:file.length())
                .add(Document.COLUMN_LAST_MODIFIED,0).add(Document.COLUMN_FLAGS,mode.equals("virtual")?Document.FLAG_VIRTUAL_DOCUMENT:0);
            return c;
        }
        @Override public Cursor queryDocument(String id,String[] projection) throws java.io.FileNotFoundException {
            if(!id.equals("root")&&!id.equals("file")) throw new java.io.FileNotFoundException();return result(id.equals("root"),projection);
        }
        @Override public Cursor queryChildDocuments(String parent,String[] projection,String order) throws java.io.FileNotFoundException {
            if(!parent.equals("root")) throw new java.io.FileNotFoundException();
            if(mode.equals("missing")) return null;
            MatrixCursor c=(MatrixCursor)result(false,projection);if(mode.equals("loading")) { Bundle extras=new Bundle();extras.putBoolean(DocumentsContract.EXTRA_LOADING,true);c.setExtras(extras); }return c;
        }
        @Override public boolean isChildDocument(String parent,String child) { return parent.equals("root")&&child.equals("file"); }
        @Override public ParcelFileDescriptor openDocument(String id,String access,CancellationSignal signal) throws java.io.FileNotFoundException {
            if(!id.equals("file")||!access.equals("r")) throw new java.io.FileNotFoundException();return ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);
        }
    }
    @Before public void before() throws Exception { mode="normal";file=File.createTempFile("folder-provider-",".bin",InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());Files.write(file.toPath(),new byte[]{1,2,3}); }
    @After public void after() { file.delete(); }
    private FolderReader reader(CancellationSignal signal) throws Exception { return new FolderReader(new SafFolderProvider(rule.getResolver(),Uri.parse("content://"+AUTHORITY+"/tree/root"),signal),signal::throwIfCanceled); }
    @Test public void resolverStreamsTreeDocumentsAndDetectsSameStampChanges() throws Exception {
        FolderReader reader=reader(new CancellationSignal());JSONObject row=reader.scan().getJSONObject(0);assertEquals("original.bin",row.getString("path"));
        assertArrayEquals(new byte[]{1,2,3},Base64.getDecoder().decode(reader.read("original.bin",row.getString("version"),0,3).getString("data")));
        Files.write(file.toPath(),new byte[]{4,5,6});assertThrows(Exception.class,()->reader.read("original.bin",row.getString("version"),0,3));
        assertThrows(Exception.class,()->reader.read("../original.bin",row.getString("version"),0,3));
    }
    @Test public void loadingMissingUnknownSizeAndVirtualProvidersFailClosed() throws Exception {
        for(String value:new String[]{"loading","missing","unknown","virtual"}) { mode=value;assertThrows(Exception.class,()->reader(new CancellationSignal()).scan()); }
        mode="normal";CancellationSignal signal=new CancellationSignal();signal.cancel();assertThrows(android.os.OperationCanceledException.class,()->reader(signal).scan());
    }
}
