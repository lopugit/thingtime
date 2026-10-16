package com.thingtime.mobile;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.DocumentsContract.Root;
import android.provider.DocumentsProvider;
import java.io.FileNotFoundException;

/** Android's MANAGE_DOCUMENTS permission protects discovery. The system picker
 * grants access to exact documents/trees; isChildDocument fences tree traversal.
 * Only roots explicitly exposed by native user consent appear here. External
 * editors cannot obtain writable descriptors for immutable published blobs. */
public class OfflineDocumentsProvider extends DocumentsProvider {
    private static final String[] ROOT_COLUMNS={Root.COLUMN_ROOT_ID,Root.COLUMN_DOCUMENT_ID,Root.COLUMN_TITLE,Root.COLUMN_SUMMARY,Root.COLUMN_FLAGS,Root.COLUMN_ICON,Root.COLUMN_MIME_TYPES};
    private static final String[] DOCUMENT_COLUMNS={Document.COLUMN_DOCUMENT_ID,Document.COLUMN_DISPLAY_NAME,Document.COLUMN_MIME_TYPE,Document.COLUMN_FLAGS,Document.COLUMN_SIZE,Document.COLUMN_LAST_MODIFIED};
    public static String authority(android.content.Context context) {return context.getPackageName()+".files";}
    static Uri rootUri(android.content.Context context,String root) {return DocumentsContract.buildDocumentUri(authority(context),root);}
    static void changed(android.content.Context context) {
        context.getContentResolver().notifyChange(DocumentsContract.buildRootsUri(authority(context)),null);
    }
    @Override public boolean onCreate() {return true;}
    protected ManagedFileStore store(PairingEngine.Check check) throws Exception {return new ManagedFileStore(getContext(),check);}
    private static FileNotFoundException unavailable() {return new FileNotFoundException("Offline folder is unavailable.");}
    private static MatrixCursor cursor(String[] requested,String[] defaults) throws FileNotFoundException {
        if(requested!=null && requested.length>32)throw unavailable();return new MatrixCursor(requested==null?defaults:requested);
    }
    private static void row(MatrixCursor cursor,java.util.Map<String,Object> values) {
        MatrixCursor.RowBuilder row=cursor.newRow();for(String name:cursor.getColumnNames())row.add(values.get(name));
    }
    private static void document(MatrixCursor cursor,ManagedFileStore.Document item) throws Exception {
        java.util.Map<String,Object> values=new java.util.HashMap<>();
        values.put(Document.COLUMN_DOCUMENT_ID,item.id);values.put(Document.COLUMN_DISPLAY_NAME,item.name);
        String type=Document.MIME_TYPE_DIR;
        if(!item.folder()) {
            int dot=item.name.lastIndexOf('.');String extension=dot<0?"":item.name.substring(dot+1).toLowerCase(java.util.Locale.ROOT);
            type=android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            if(type==null)type="application/octet-stream";
        }
        values.put(Document.COLUMN_MIME_TYPE,type);values.put(Document.COLUMN_FLAGS,0);
        values.put(Document.COLUMN_SIZE,item.folder()?null:item.entry.getLong("size"));
        // Sync versions are opaque, not wall-clock timestamps. Leave this
        // optional column null rather than invent a modified time.
        values.put(Document.COLUMN_LAST_MODIFIED,null);row(cursor,values);
    }
    @Override public Cursor queryRoots(String[] projection) throws FileNotFoundException {
        MatrixCursor result=cursor(projection,ROOT_COLUMNS);
        try(ManagedFileStore store=store(()->{})) {
            for(ManagedFileStore.Document root:store.filesRoots()) {
                java.util.Map<String,Object> values=new java.util.HashMap<>();
                values.put(Root.COLUMN_ROOT_ID,root.id);values.put(Root.COLUMN_DOCUMENT_ID,root.id);
                values.put(Root.COLUMN_TITLE,root.name);values.put(Root.COLUMN_SUMMARY,"Thingtime offline folder");
                values.put(Root.COLUMN_FLAGS,Root.FLAG_LOCAL_ONLY|Root.FLAG_SUPPORTS_IS_CHILD);
                values.put(Root.COLUMN_ICON,com.thingtime.mobile.R.drawable.ic_launcher);values.put(Root.COLUMN_MIME_TYPES,"*/*");row(result,values);
            }
            return result;
        } catch(Exception failure) {result.close();throw unavailable();}
    }
    @Override public Cursor queryDocument(String id,String[] projection) throws FileNotFoundException {
        MatrixCursor result=cursor(projection,DOCUMENT_COLUMNS);
        try(ManagedFileStore store=store(()->{})){document(result,store.document(id));return result;}
        catch(Exception failure){result.close();throw unavailable();}
    }
    @Override public Cursor queryChildDocuments(String parent,String[] projection,String sortOrder) throws FileNotFoundException {
        MatrixCursor result=cursor(projection,DOCUMENT_COLUMNS);
        try(ManagedFileStore store=store(()->{})){for(ManagedFileStore.Document child:store.children(parent))document(result,child);return result;}
        catch(Exception failure){result.close();throw unavailable();}
    }
    @Override public DocumentsContract.Path findDocumentPath(String parent,String child) throws FileNotFoundException {
        try(ManagedFileStore store=store(()->{})){return store.documentPath(parent,child);}catch(Exception failure){throw unavailable();}
    }
    @Override public boolean isChildDocument(String parent,String child) {
        try(ManagedFileStore store=store(()->{})){return store.descendant(parent,child);}catch(Exception failure){return false;}
    }
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal) throws FileNotFoundException {
        if(!"r".equals(mode))throw unavailable();
        PairingEngine.Check check=()->{if(signal!=null)signal.throwIfCanceled();};
        try(ManagedFileStore store=store(check)){return store.openDocument(id);}
        catch(android.os.OperationCanceledException cancelled){throw cancelled;}
        catch(Exception failure){throw unavailable();}
    }
}
