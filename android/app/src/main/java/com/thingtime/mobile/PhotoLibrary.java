package com.thingtime.mobile;

import android.Manifest;
import android.content.Context;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import java.io.InputStream;
import java.util.*;

/** Read-only original media adapter. Runtime permission is never persisted as
 * authority. Existing folder grants still bind each account to a selected tree. */
final class PhotoLibrary implements FolderReader.Provider {
    static final String ROOT="library";
    private static final String[] COLUMNS={MediaStore.Files.FileColumns._ID,MediaStore.MediaColumns.DISPLAY_NAME,MediaStore.MediaColumns.SIZE,MediaStore.MediaColumns.DATE_MODIFIED,MediaStore.MediaColumns.GENERATION_MODIFIED,MediaStore.MediaColumns.MIME_TYPE};
    final Context context;
    private final Map<String,Media> summaries=new HashMap<>();
    private final String selected;
    private final PairingEngine.Check check;
    private final CancellationSignal cancellation;
    PhotoLibrary(Context context,String selected,PairingEngine.Check check,CancellationSignal cancellation) throws Exception {
        this.context=context;this.selected=selected;this.check=check;this.cancellation=cancellation;parse(selected);
    }
    static boolean supported(){return Build.VERSION.SDK_INT>=30;}
    static String authority(Context context){return context.getPackageName()+".photos";}
    static boolean owns(Context context,Uri tree){return authority(context).equals(tree.getAuthority());}
    static boolean granted(Context context,String permission){return context.checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}
    static String access(Context context) {
        if(!supported() || !granted(context,Manifest.permission.ACCESS_MEDIA_LOCATION))return "unavailable";
        if(Build.VERSION.SDK_INT<33)return granted(context,Manifest.permission.READ_EXTERNAL_STORAGE)?"full":"unavailable";
        if(granted(context,Manifest.permission.READ_MEDIA_IMAGES)&&granted(context,Manifest.permission.READ_MEDIA_VIDEO))return "full";
        if(granted(context,Manifest.permission.READ_MEDIA_IMAGES)||granted(context,Manifest.permission.READ_MEDIA_VIDEO)||
            (Build.VERSION.SDK_INT>=34&&granted(context,Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)))return "limited";
        return "unavailable";
    }
    static String[] permissions() {
        if(Build.VERSION.SDK_INT<30)return new String[0];
        if(Build.VERSION.SDK_INT>=34)return new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO,Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,Manifest.permission.ACCESS_MEDIA_LOCATION};
        if(Build.VERSION.SDK_INT>=33)return new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO,Manifest.permission.ACCESS_MEDIA_LOCATION};
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE,Manifest.permission.ACCESS_MEDIA_LOCATION};
    }
    private static FolderReader.Failure unavailable(){return new FolderReader.Failure("Photo access changed or an original is unavailable. Review photo permissions and try again.");}
    void require() throws Exception {check.run();if(cancellation!=null)cancellation.throwIfCanceled();if("unavailable".equals(access(context)))throw unavailable();}
    private static String[] parse(String id) throws Exception {
        if(ROOT.equals(id))return new String[0];String[] p=id.split("/",-1);
        if((p.length!=2&&p.length!=3)||!p[0].equals("volume")||!p[1].matches("[a-z0-9_-]{1,100}"))throw unavailable();
        if(p.length==3&&(!p[2].matches("[1-9][0-9]{0,18}")||Long.parseLong(p[2])<=0))throw unavailable();return p;
    }
    private Set<String> volumes() throws Exception {if(Build.VERSION.SDK_INT<30)throw unavailable();require();Set<String> names=new TreeSet<>(MediaStore.getExternalVolumeNames(context));if(names.isEmpty()||names.size()>32)throw unavailable();return names;}
    private void volume(String name) throws Exception {if(!volumes().contains(name))throw unavailable();}
    private String boundary(String volume) throws Exception {if(Build.VERSION.SDK_INT<30)throw unavailable();require();return access(context)+":"+MediaStore.getVersion(context,volume)+":"+MediaStore.getGeneration(context,volume);}
    private static long stamp(String text) throws Exception{return Long.parseLong(FolderReader.hash(text).substring(0,13),16);}
    @Override public FolderReader.Doc root() throws Exception{return stat(selected);}
    @Override public FolderReader.Doc stat(String id) throws Exception {
        require();String[] p=parse(id);
        if(p.length==0){StringBuilder versions=new StringBuilder(access(context));for(String name:volumes())versions.append(name).append(':').append(boundary(name)).append(';');return new FolderReader.Doc(ROOT,"Photo library",true,0,stamp(versions.toString()));}
        volume(p[1]);if(p.length==2)return new FolderReader.Doc(id,p[1],true,0,stamp(boundary(p[1])));
        List<Media> rows=query(p[1],p[2]);if(rows.size()!=1)throw unavailable();return rows.get(0).doc;
    }
    @Override public List<FolderReader.Doc> children(String id) throws Exception {
        require();String[] p=parse(id);List<FolderReader.Doc> result=new ArrayList<>();
        if(p.length==0){for(String name:volumes())result.add(stat("volume/"+name));}
        else if(p.length==2){for(Media row:query(p[1],null))result.add(row.doc);}
        else throw unavailable();require();return result;
    }
    private static String safeName(long id,String name,String mime) {
        String value=name==null?"media":name.replaceAll("[\\p{Cc}\\p{Cf}/\\\\]","_");
        if(value.isBlank()||value.equals(".")||value.equals(".."))value="media";
        if(value.codePointCount(0,value.length())>210)value=value.substring(0,value.offsetByCodePoints(0,210));
        return id+"-"+value;
    }
    static final class Media {
        final FolderReader.Doc doc;final String mime;final long modified;
        Media(FolderReader.Doc doc,String mime,long modified){this.doc=doc;this.mime=mime;this.modified=modified;}
    }
    private List<Media> query(String volume,String id) throws Exception {
        if(Build.VERSION.SDK_INT<30)throw unavailable();summaries.clear();volume(volume);String before=boundary(volume),libraryVersion=MediaStore.getVersion(context,volume);List<Media> result=new ArrayList<>();
        String where=MediaStore.Files.FileColumns.MEDIA_TYPE+" IN (?,?) AND "+MediaStore.MediaColumns.IS_PENDING+"=0 AND "+MediaStore.MediaColumns.IS_TRASHED+"=0";
        List<String> args=new ArrayList<>(Arrays.asList(Integer.toString(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE),Integer.toString(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)));
        if(id!=null){where+=" AND "+MediaStore.MediaColumns._ID+"=?";args.add(id);}
        Bundle options=new Bundle();options.putString(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION,where);options.putStringArray(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,args.toArray(new String[0]));
        options.putStringArray(android.content.ContentResolver.QUERY_ARG_SORT_COLUMNS,new String[]{MediaStore.MediaColumns._ID});options.putInt(android.content.ContentResolver.QUERY_ARG_SORT_DIRECTION,android.content.ContentResolver.QUERY_SORT_DIRECTION_ASCENDING);options.putInt(android.content.ContentResolver.QUERY_ARG_LIMIT,FolderReader.MAX_ENTRIES+1);
        try(Cursor rows=context.getContentResolver().query(MediaStore.Files.getContentUri(volume),COLUMNS,options,cancellation)) {
            if(rows==null)throw unavailable();
            while(rows.moveToNext()) {
                require();if(result.size()>=FolderReader.MAX_ENTRIES)throw new FolderReader.Failure("Photo library exceeds the current scan limit. Select fewer photos until large-library paging is available.");
                long key=rows.getLong(0),size=rows.getLong(2),modified=rows.getLong(3),generation=rows.getLong(4);String mime=rows.getString(5);
                if(key<=0||size<0||modified<0||modified>9007199254740L||generation<0||mime==null||(!mime.startsWith("image/")&&!mime.startsWith("video/")))throw unavailable();
                String document="volume/"+volume+"/"+key;
                result.add(new Media(new FolderReader.Doc(document,safeName(key,rows.getString(1),mime),false,size,stamp(libraryVersion+":"+generation+":"+modified)),mime,modified*1000));
            }
        }
        if(!before.equals(boundary(volume)))throw unavailable();for(Media row:result)summaries.put(row.doc.id,row);return result;
    }
    Media metadata(String id) throws Exception {Media saved=summaries.get(id);return saved==null?media(id):saved;}
    Media media(String id) throws Exception {String[] p=parse(id);if(p.length!=3)throw unavailable();List<Media> rows=query(p[1],p[2]);if(rows.size()!=1)throw unavailable();return rows.get(0);}
    boolean contains(String parent,String child) throws Exception {
        require();parse(parent);parse(child);if(parent.equals(child)){stat(parent);return true;}
        if(!parent.equals(ROOT)&&!child.startsWith(parent+"/"))return false;
        stat(parent);stat(child);return true;
    }
    ParcelFileDescriptor descriptor(String id) throws Exception {
        if(Build.VERSION.SDK_INT<30)throw unavailable();require();if(!contains(selected,id))throw unavailable();Media media=media(id);String[] p=parse(id);
        Uri original=MediaStore.setRequireOriginal(ContentUris.withAppendedId(MediaStore.Files.getContentUri(p[1]),Long.parseLong(p[2])));
        ParcelFileDescriptor fd;
        if(Build.VERSION.SDK_INT>=31) {
            Bundle options=new Bundle();options.putBoolean(MediaStore.EXTRA_ACCEPT_ORIGINAL_MEDIA_FORMAT,true);
            try(android.content.res.AssetFileDescriptor asset=context.getContentResolver().openTypedAssetFileDescriptor(original,"*/*",options,cancellation)) {
                if(asset==null||asset.getStartOffset()!=0)throw unavailable();fd=ParcelFileDescriptor.dup(asset.getFileDescriptor());
            }
        } else fd=context.getContentResolver().openFileDescriptor(original,"r",cancellation);
        if(fd==null)throw unavailable();try{
            require();if(!media.doc.metadata().equals(stat(id).metadata()))throw unavailable();return fd;}catch(Exception failure){fd.close();throw failure;}
    }
    @Override public InputStream open(String id) throws Exception {return new ParcelFileDescriptor.AutoCloseInputStream(descriptor(id));}
}
