package com.thingtime.mobile;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.provider.DocumentsContract.Root;
import android.provider.DocumentsProvider;
import java.io.FileNotFoundException;
import java.util.*;

/** Read-only SAF view over the user-authorized local photo library. The system
 * picker grants the selected tree; write/delete/thumbnail transcoding is absent. */
public final class PhotoDocumentsProvider extends DocumentsProvider {
    private static final String[] ROOT_COLUMNS={Root.COLUMN_ROOT_ID,Root.COLUMN_DOCUMENT_ID,Root.COLUMN_TITLE,Root.COLUMN_SUMMARY,Root.COLUMN_FLAGS,Root.COLUMN_ICON,Root.COLUMN_MIME_TYPES};
    private static final String[] COLUMNS={Document.COLUMN_DOCUMENT_ID,Document.COLUMN_DISPLAY_NAME,Document.COLUMN_MIME_TYPE,Document.COLUMN_FLAGS,Document.COLUMN_SIZE,Document.COLUMN_LAST_MODIFIED};
    @Override public boolean onCreate(){return true;}
    private PhotoLibrary library(CancellationSignal signal) throws Exception{return new PhotoLibrary(getContext(),PhotoLibrary.ROOT,()->{},signal);}
    private static FileNotFoundException unavailable(){return new FileNotFoundException("Photo originals are unavailable. Review photo permissions in Thingtime.");}
    private static MatrixCursor cursor(String[] requested,String[] defaults) throws Exception {if(requested!=null&&requested.length>32)throw unavailable();return new MatrixCursor(requested==null?defaults:requested);}
    private static void row(MatrixCursor cursor,Map<String,Object> values){MatrixCursor.RowBuilder row=cursor.newRow();for(String name:cursor.getColumnNames())row.add(values.get(name));}
    private void document(MatrixCursor result,PhotoLibrary library,FolderReader.Doc doc) throws Exception {
        Map<String,Object> values=new HashMap<>();values.put(Document.COLUMN_DOCUMENT_ID,doc.id);values.put(Document.COLUMN_DISPLAY_NAME,doc.name);
        values.put(Document.COLUMN_FLAGS,0);values.put(Document.COLUMN_SIZE,doc.directory?null:doc.size);
        if(doc.directory){values.put(Document.COLUMN_MIME_TYPE,Document.MIME_TYPE_DIR);values.put(Document.COLUMN_LAST_MODIFIED,null);}
        else {PhotoLibrary.Media media=library.metadata(doc.id);values.put(Document.COLUMN_MIME_TYPE,media.mime);values.put(Document.COLUMN_LAST_MODIFIED,media.modified);}
        row(result,values);
    }
    @Override public Cursor queryRoots(String[] projection) throws FileNotFoundException {
        MatrixCursor result=null;try {
            result=cursor(projection,ROOT_COLUMNS);String access=PhotoLibrary.access(getContext());
            if(!"unavailable".equals(access)) {
                Map<String,Object> values=new HashMap<>();values.put(Root.COLUMN_ROOT_ID,PhotoLibrary.ROOT);values.put(Root.COLUMN_DOCUMENT_ID,PhotoLibrary.ROOT);
                values.put(Root.COLUMN_TITLE,"Photo library");values.put(Root.COLUMN_SUMMARY,"limited".equals(access)?"Selected photos and videos · originals · read-only":"Photos and videos · originals · read-only");
                values.put(Root.COLUMN_FLAGS,Root.FLAG_LOCAL_ONLY|Root.FLAG_SUPPORTS_IS_CHILD);values.put(Root.COLUMN_ICON,com.thingtime.mobile.R.drawable.ic_launcher);values.put(Root.COLUMN_MIME_TYPES,"image/*\nvideo/*");row(result,values);
            }
            result.setNotificationUri(getContext().getContentResolver(),DocumentsContract.buildRootsUri(PhotoLibrary.authority(getContext())));return result;
        }catch(Exception failure){if(result!=null)result.close();throw unavailable();}
    }
    @Override public Cursor queryDocument(String id,String[] projection) throws FileNotFoundException {
        MatrixCursor result=null;try {PhotoLibrary library=library(null);result=cursor(projection,COLUMNS);document(result,library,library.stat(id));return result;}catch(Exception failure){if(result!=null)result.close();throw unavailable();}
    }
    @Override public Cursor queryChildDocuments(String parent,String[] projection,String sortOrder) throws FileNotFoundException {
        MatrixCursor result=null;try {PhotoLibrary library=library(null);result=cursor(projection,COLUMNS);for(FolderReader.Doc doc:library.children(parent))document(result,library,doc);return result;}catch(Exception failure){if(result!=null)result.close();throw unavailable();}
    }
    @Override public boolean isChildDocument(String parent,String child){try{return library(null).contains(parent,child);}catch(Exception failure){return false;}}
    @Override public DocumentsContract.Path findDocumentPath(String parent,String child) throws FileNotFoundException {
        try {
            PhotoLibrary library=library(null);String start=parent==null?PhotoLibrary.ROOT:parent;if(!library.contains(start,child))throw unavailable();
            List<String> path=new ArrayList<>();path.add(start);
            if(!start.equals(child)) {String[] parts=child.split("/");if(start.equals(PhotoLibrary.ROOT)&&parts.length==3)path.add(parts[0]+"/"+parts[1]);path.add(child);}
            return new DocumentsContract.Path(parent==null?PhotoLibrary.ROOT:null,path);
        }catch(Exception failure){throw unavailable();}
    }
    @Override public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal) throws FileNotFoundException {
        if(!"r".equals(mode))throw unavailable();try{return library(signal).descriptor(id);}catch(android.os.OperationCanceledException cancelled){throw cancelled;}catch(Exception failure){throw unavailable();}
    }
}
