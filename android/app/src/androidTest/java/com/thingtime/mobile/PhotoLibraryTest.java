package com.thingtime.mobile;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.util.*;

/** Real MediaStore rows and original bytes, with strictly owned fixture cleanup. */
public class PhotoLibraryTest {
    Context context;List<Uri> created=new ArrayList<>();byte[] bytes;
    @Before public void before() throws Exception {
        Assume.assumeTrue(Build.VERSION.SDK_INT>=30);context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        InstrumentationRegistry.getInstrumentation().getUiAutomation().adoptShellPermissionIdentity(PhotoLibrary.permissions());
        Bitmap bitmap=Bitmap.createBitmap(4,4,Bitmap.Config.ARGB_8888);bitmap.eraseColor(0xff12ab34);
        ByteArrayOutputStream output=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,output);bitmap.recycle();bytes=output.toByteArray();
    }
    @After public void after(){if(context!=null)for(Uri uri:created)context.getContentResolver().delete(uri,null,null);InstrumentationRegistry.getInstrumentation().getUiAutomation().dropShellPermissionIdentity();}
    Uri create(String directory,boolean pending) throws Exception {
        ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,"duplicate.png");values.put(MediaStore.MediaColumns.MIME_TYPE,"image/png");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH,"Pictures/ThingtimePhotoQA/"+UUID.randomUUID()+"/"+directory);values.put(MediaStore.MediaColumns.IS_PENDING,1);
        Uri uri=context.getContentResolver().insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values);assertNotNull(uri);created.add(uri);
        try(OutputStream output=context.getContentResolver().openOutputStream(uri)){output.write(bytes);}
        if(!pending){values.clear();values.put(MediaStore.MediaColumns.IS_PENDING,0);assertEquals(1,context.getContentResolver().update(uri,values,null,null));}Thread.sleep(400);return uri;
    }
    String id(Uri uri){return "volume/external_primary/"+ContentUris.parseId(uri);}
    PhotoLibrary library() throws Exception{return new PhotoLibrary(context,PhotoLibrary.ROOT,()->{},new CancellationSignal());}
    @Test public void originalsDuplicateNamesAndGenerationArePreserved() throws Exception {
        Uri a=create("a",false),b=create("b",false);PhotoLibrary library=library();FolderReader.Doc first=library.stat(id(a)),second=library.stat(id(b));
        assertNotEquals(first.name,second.name);assertTrue(first.name.endsWith("duplicate.png"));assertEquals(bytes.length,first.size);
        try(InputStream input=library.open(id(a))){assertArrayEquals(bytes,input.readAllBytes());}
        assertTrue(library.contains(PhotoLibrary.ROOT,id(a)));assertFalse(library.contains(id(a),id(b)));
        assertThrows(Exception.class,()->library.stat("volume/external_primary/../outside"));
        FolderReader.Doc root=library.root();ContentValues rename=new ContentValues();rename.put(MediaStore.MediaColumns.DISPLAY_NAME,"renamed.png");context.getContentResolver().update(a,rename,null,null);
        assertNotEquals(root.modified,library.root().modified);assertNotEquals(first.modified,library.stat(id(a)).modified);
    }
    @Test public void pendingTrashedDeletedAndMissingVolumesNeverBecomeReadableOriginals() throws Exception {
        Uri pending=create("pending",true),ready=create("ready",false);PhotoLibrary library=library();
        assertThrows(Exception.class,()->library.stat(id(pending)));
        ContentValues trash=new ContentValues();trash.put(MediaStore.MediaColumns.IS_TRASHED,1);context.getContentResolver().update(ready,trash,null,null);
        assertThrows(Exception.class,()->library.open(id(ready)));context.getContentResolver().delete(ready,null,null);created.remove(ready);assertThrows(Exception.class,()->library.stat(id(ready)));
        assertThrows(Exception.class,()->library.children("volume/absent_volume"));
    }
    @Test public void livePermissionDenialAndCancellationFailBeforeInventoryOrDisclosure() throws Exception {
        Uri a=create("permissions",false);Set<String> denied=new HashSet<>();Context guard=new ContextWrapper(context){@Override public int checkSelfPermission(String name){return denied.contains(name)?PackageManager.PERMISSION_DENIED:PackageManager.PERMISSION_GRANTED;}};
        CancellationSignal signal=new CancellationSignal();PhotoLibrary library=new PhotoLibrary(guard,PhotoLibrary.ROOT,()->{},signal);
        assertEquals("full",PhotoLibrary.access(guard));assertNotNull(library.stat(id(a)));
        denied.add(Manifest.permission.ACCESS_MEDIA_LOCATION);assertEquals("unavailable",PhotoLibrary.access(guard));assertThrows(Exception.class,library::root);assertThrows(Exception.class,()->library.open(id(a)));
        denied.clear();if(Build.VERSION.SDK_INT>=34){denied.add(Manifest.permission.READ_MEDIA_IMAGES);denied.add(Manifest.permission.READ_MEDIA_VIDEO);assertEquals("limited",PhotoLibrary.access(guard));denied.add(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED);assertEquals("unavailable",PhotoLibrary.access(guard));}
        denied.clear();signal.cancel();assertThrows(OperationCanceledException.class,library::root);
    }
    @Test public void documentsProviderNeverAcceptsWrites() throws Exception {
        Uri a=create("readonly",false);PhotoDocumentsProvider provider=new PhotoDocumentsProvider();
        android.content.pm.ProviderInfo info=new android.content.pm.ProviderInfo();info.authority=PhotoLibrary.authority(context);info.exported=true;info.grantUriPermissions=true;info.readPermission="android.permission.MANAGE_DOCUMENTS";info.writePermission="android.permission.MANAGE_DOCUMENTS";provider.attachInfo(context,info);
        for(String mode:new String[]{"w","rw","wa","rwt"})assertThrows(FileNotFoundException.class,()->provider.openDocument(id(a),mode,null));
        try(android.database.Cursor row=provider.queryDocument(id(a),null)){assertTrue(row.moveToFirst());assertEquals(0,row.getInt(row.getColumnIndexOrThrow(android.provider.DocumentsContract.Document.COLUMN_FLAGS)));}
        assertThrows(UnsupportedOperationException.class,()->provider.deleteDocument(id(a)));
    }
}
