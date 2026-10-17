package com.thingtime.mobile;

import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;

public class FolderReaderTest {
    private static class Provider implements FolderReader.Provider {
        Map<String,FolderReader.Doc> docs=new LinkedHashMap<>();Map<String,byte[]> bytes=new HashMap<>();Map<String,List<String>> children=new HashMap<>();
        Provider() { docs.put("root",new FolderReader.Doc("root","Selected",true,0,0));children.put("root",new ArrayList<>()); }
        void file(String id,String name,byte[] data) { docs.put(id,new FolderReader.Doc(id,name,false,data.length,0));bytes.put(id,data);children.get("root").add(id); }
        public FolderReader.Doc root() throws Exception { return stat("root"); }
        public FolderReader.Doc stat(String id) throws Exception { if(!docs.containsKey(id)) throw new IOException("Missing");return docs.get(id); }
        public List<FolderReader.Doc> children(String id) throws Exception { if(!children.containsKey(id)) throw new IOException("Missing");List<FolderReader.Doc> result=new ArrayList<>();for(String child:children.get(id)) result.add(stat(child));return result; }
        public InputStream open(String id) { return new ByteArrayInputStream(bytes.get(id)); }
        FolderReader reader() { return new FolderReader(this,()->{}); }
    }
    @Test public void multipartContractAndTailReadMatchIndependentHashes() throws Exception {
        Provider p=new Provider();byte[] bytes=new byte[8*1024*1024+17];Arrays.fill(bytes,(byte)13);p.file("file","original.bin",bytes);
        JSONObject row=p.reader().scan().getJSONObject(0),fingerprint=row.getJSONObject("fingerprint");
        MessageDigest h=MessageDigest.getInstance("SHA-256"),composite=MessageDigest.getInstance("SHA-256");
        composite.update(h.digest(Arrays.copyOfRange(bytes,0,8*1024*1024)));composite.update(h.digest(Arrays.copyOfRange(bytes,8*1024*1024,bytes.length)));
        assertEquals(FolderReader.hex(composite.digest()),fingerprint.getString("sha256"));assertEquals(2,fingerprint.getInt("partCount"));assertEquals(8*1024*1024,fingerprint.getInt("partSizeBytes"));
        JSONObject chunk=p.reader().read("original.bin",row.getString("version"),8*1024*1024,65536);
        assertArrayEquals(Arrays.copyOfRange(bytes,8*1024*1024,bytes.length),Base64.getDecoder().decode(chunk.getString("data")));
        assertThrows(Exception.class,()->p.reader().read("original.bin",row.getString("version"),0,65537));
    }
    @Test public void unchangedProviderTimestampCannotSubstituteChangedBytes() throws Exception {
        Provider p=new Provider();p.file("file","file",new byte[]{1,2,3});JSONObject row=p.reader().scan().getJSONObject(0);
        p.bytes.put("file",new byte[]{4,5,6}); // Same opaque ID, size and zero/unknown modification time.
        assertThrows(Exception.class,()->p.reader().read("file",row.getString("version"),0,3));
        assertNotEquals(row.getString("version"),p.reader().scan().getJSONObject(0).getString("version"));
    }
    @Test public void directoriesAndEmptyFilesRemainInCompleteInventory() throws Exception {
        Provider p=new Provider();p.docs.put("nested",new FolderReader.Doc("nested","nested",true,0,0));p.children.get("root").add("nested");p.children.put("nested",new ArrayList<>());
        p.file("file","empty",new byte[0]);p.children.get("root").remove("file");p.children.get("nested").add("file");
        JSONArray rows=p.reader().scan();assertEquals("folder",rows.getJSONObject(0).getString("kind"));assertEquals("nested/empty",rows.getJSONObject(1).getString("path"));
        assertEquals(FolderReader.hex(MessageDigest.getInstance("SHA-256").digest()),rows.getJSONObject(1).getString("sha256"));
        assertEquals("",p.reader().read("nested/empty",rows.getJSONObject(1).getString("version"),0,1).getString("data"));
    }
    @Test public void missingIncompleteAndUnsafeTreesNeverBecomeEmptySuccess() throws Exception {
        Provider p=new Provider();assertEquals(0,p.reader().scan().length());p.children.remove("root");assertThrows(Exception.class,()->p.reader().scan());
        for(String name:new String[]{"../file","a/b","a\\b","a\u0000b","a\u200db","."}) {
            Provider unsafe=new Provider();unsafe.file("file",name,new byte[0]);assertThrows(Exception.class,()->unsafe.reader().scan());
        }
        Provider aliases=new Provider();aliases.file("a","FILE",new byte[0]);aliases.file("b","file",new byte[0]);assertThrows(Exception.class,()->aliases.reader().scan());
        Provider loop=new Provider();loop.children.get("root").add("root");assertThrows(Exception.class,()->loop.reader().scan());
    }
    @Test public void partialExtraBytesChangedIdentityAndUnknownSizeAreRefused() throws Exception {
        for(int size:new int[]{-1,2,4}) {
            Provider p=new Provider();p.file("file","file",new byte[]{1,2,3});p.docs.put("file",new FolderReader.Doc("file","file",false,size,0));assertThrows(Exception.class,()->p.reader().scan());
        }
        Provider p=new Provider();p.file("file","file",new byte[]{1});JSONObject row=p.reader().scan().getJSONObject(0);
        for(String path:new String[]{"../file","/file","a//file","a/./file"}) assertThrows(Exception.class,()->p.reader().read(path,row.getString("version"),0,1));
        p.children.get("root").clear();p.file("replacement","file",new byte[]{1});assertThrows(Exception.class,()->p.reader().read("file",row.getString("version"),0,1));
    }
    @Test public void scansAreBoundedAndCancellationDoesNotReturnResults() throws Exception {
        Provider p=new Provider();for(int i=0;i<10001;i++) p.file("id"+i,"file"+i,new byte[0]);assertThrows(Exception.class,()->p.reader().scan());
        Provider empty=new Provider();FolderReader reader=new FolderReader(empty,()->{throw new java.util.concurrent.CancellationException();});assertThrows(java.util.concurrent.CancellationException.class,reader::scan);
    }
    @Test public void concurrentDirectoryChangesInvalidateTheScan() throws Exception {
        Provider p=new Provider() {
            @Override public InputStream open(String id) { children.get("root").clear();return super.open(id); }
        };
        p.file("file","file",new byte[]{1});assertThrows(Exception.class,()->p.reader().scan());
    }
    @Test public void verifiedRangesReadLinearBytesAndFullCheckStillDetectsUnchangedTimestampEdits() throws Exception {
        long[] reads={0};
        Provider p=new Provider() {
            @Override public InputStream open(String id) {
                return new ByteArrayInputStream(bytes.get(id)) {
                    @Override public synchronized int read(byte[] b,int off,int len) { int n=super.read(b,off,len);if(n>0)reads[0]+=n;return n; }
                };
            }
        };
        byte[] bytes=new byte[8*1024*1024+17];new Random(5).nextBytes(bytes);p.file("file","file",bytes);
        FolderReader.ProofCache proofs=new FolderReader.ProofCache();
        FolderReader reader=new FolderReader(p,()->{},proofs,"owner/root");
        String version=reader.scan().getJSONObject(0).getString("version");assertEquals(bytes.length,reads[0]);reads[0]=0;
        ByteArrayOutputStream observed=new ByteArrayOutputStream();
        for(int offset=0;offset<bytes.length;offset+=FolderReader.MAX_READ) {
            // Each bridge request uses a fresh reader with the same scoped proofs.
            JSONObject chunk=new FolderReader(p,()->{},proofs,"owner/root").read("file",version,offset,FolderReader.MAX_READ,true);
            observed.write(Base64.getDecoder().decode(chunk.getString("data")));
        }
        assertArrayEquals(bytes,observed.toByteArray());assertEquals(bytes.length,reads[0]);
        JSONObject crossing=reader.read("file",version,FolderReader.MAX_READ-2,5,true);
        assertArrayEquals(Arrays.copyOfRange(bytes,FolderReader.MAX_READ-2,FolderReader.MAX_READ+3),Base64.getDecoder().decode(crossing.getString("data")));
        // Same ID/size/timestamp, change a byte outside a prefix read.
        p.bytes.get("file")[bytes.length-1]^=1;
        assertEquals(1,Base64.getDecoder().decode(reader.read("file",version,0,1,true).getString("data")).length);
        assertThrows(Exception.class,()->reader.read("file",version,bytes.length-1,1,true));
        assertThrows(Exception.class,()->reader.read("file",version,0,1)); // Full pre-publication verification.
        assertThrows(Exception.class,()->new FolderReader(p,()->{},proofs,"different owner/root").read("file",version,0,1,true));
        proofs.clear();assertThrows(Exception.class,()->reader.read("file",version,0,1,true));
    }
    @Test public void verifiedRangeEvictionFallsBackToFullValidationAndCancellationNeverReturnsBytes() throws Exception {
        FolderReader.ProofCache proofs=new FolderReader.ProofCache();Provider p=new Provider();p.file("file","file",new byte[]{1,2,3});
        FolderReader reader=new FolderReader(p,()->{},proofs,"scope");String version=reader.scan().getJSONObject(0).getString("version");
        for(int i=0;i<FolderReader.ProofCache.MAX_FILES;i++)proofs.put("test-"+i,new byte[32]);
        p.bytes.put("file",new byte[]{1,2,4});assertThrows(Exception.class,()->reader.read("file",version,0,1,true));
        String current=reader.scan().getJSONObject(0).getString("version");
        assertThrows(java.util.concurrent.CancellationException.class,()->new FolderReader(p,()->{throw new java.util.concurrent.CancellationException();},proofs,"scope").read("file",current,0,1,true));
    }

    @Test public void aRetiredReaderCannotRepopulateClearedProofs() {
        FolderReader.ProofCache proofs=new FolderReader.ProofCache();long generation=proofs.generation();proofs.clear();
        proofs.put("late",new byte[32],generation);assertNull(proofs.get("late",proofs.generation()));
    }

}
