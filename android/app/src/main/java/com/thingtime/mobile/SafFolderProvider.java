package com.thingtime.mobile;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/** Only native picker tree URIs enter this adapter; child URIs retain the tree
 * boundary so DocumentsProvider enforces ancestry, even for opaque IDs. */
final class SafFolderProvider implements FolderReader.Provider {
    private static final String[] COLUMNS={Document.COLUMN_DOCUMENT_ID,Document.COLUMN_DISPLAY_NAME,Document.COLUMN_MIME_TYPE,Document.COLUMN_SIZE,Document.COLUMN_LAST_MODIFIED,Document.COLUMN_FLAGS};
    private final ContentResolver resolver; private final Uri tree; private final CancellationSignal signal;
    SafFolderProvider(ContentResolver resolver,Uri tree,CancellationSignal signal) throws Exception { this.resolver=resolver;this.tree=FolderStore.tree(tree.toString());this.signal=signal; }
    private Uri uri(String id) { return DocumentsContract.buildDocumentUriUsingTree(tree,id); }
    private FolderReader.Doc row(Cursor c) throws Exception {
        int[] columns=new int[COLUMNS.length];for(int i=0;i<COLUMNS.length;i++) columns[i]=c.getColumnIndexOrThrow(COLUMNS[i]);
        for(int i:new int[]{0,1,2,5}) if(c.isNull(columns[i])) throw new FolderReader.Failure("The provider returned incomplete file metadata.");
        boolean directory=Document.MIME_TYPE_DIR.equals(c.getString(columns[2]));
        if((c.getLong(columns[5])&Document.FLAG_VIRTUAL_DOCUMENT)!=0 || (!directory && c.isNull(columns[3]))) throw new FolderReader.Failure("This provider item cannot be read as a complete file.");
        return new FolderReader.Doc(c.getString(columns[0]),c.getString(columns[1]),directory,directory?0:c.getLong(columns[3]),c.isNull(columns[4])?0:c.getLong(columns[4]));
    }
    private static boolean incomplete(Cursor c) {
        android.os.Bundle extra=c.getExtras();return extra!=null && (extra.getBoolean(DocumentsContract.EXTRA_LOADING,false) || extra.containsKey(DocumentsContract.EXTRA_ERROR));
    }
    private List<FolderReader.Doc> query(Uri uri) throws Exception {
        signal.throwIfCanceled();List<FolderReader.Doc> rows=new ArrayList<>();
        try(Cursor c=resolver.query(uri,COLUMNS,null,null,null,signal)) {
            if(c==null || incomplete(c)) throw new FolderReader.Failure("The folder provider has not returned a complete listing.");
            while(c.moveToNext()) { signal.throwIfCanceled();if(rows.size()>=FolderReader.MAX_ENTRIES) throw new FolderReader.Failure("Folder exceeds the scan limit. Choose a smaller folder.");rows.add(row(c)); }
            if(incomplete(c)) throw new FolderReader.Failure("The folder provider has not returned a complete listing.");
        }
        return rows;
    }
    @Override public FolderReader.Doc root() throws Exception { return stat(DocumentsContract.getTreeDocumentId(tree)); }
    @Override public FolderReader.Doc stat(String id) throws Exception {
        List<FolderReader.Doc> rows=query(uri(id));if(rows.size()!=1 || !id.equals(rows.get(0).id)) throw new FolderReader.Failure("The selected item is unavailable.");return rows.get(0);
    }
    @Override public List<FolderReader.Doc> children(String id) throws Exception { return query(DocumentsContract.buildChildDocumentsUriUsingTree(tree,id)); }
    @Override public InputStream open(String id) throws Exception {
        android.content.res.AssetFileDescriptor descriptor=resolver.openAssetFileDescriptor(uri(id),"r",signal);
        if(descriptor==null) throw new FolderReader.Failure("The provider could not open the file.");
        try { return descriptor.createInputStream(); } catch(Exception failure) { descriptor.close();throw failure; }
    }
}
