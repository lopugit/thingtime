import hashlib,json,os,struct,sys,zipfile
expected=json.load(open(sys.argv[2]))
with zipfile.ZipFile(sys.argv[1]) as archive:
 info=archive.getinfo('files/000000');assert info.file_size==0x100000001;assert info.extract_version>=45
 digest=hashlib.sha256();total=0;last=None
 with archive.open(info) as source:
  while True:
   chunk=source.read(1024*1024)
   if not chunk:break
   digest.update(chunk);total+=len(chunk);last=chunk[-1]
 assert total==info.file_size and last==173 and digest.hexdigest()==expected['digest']
 trailing=archive.getinfo('files/000001');assert trailing.header_offset>0xffffffff;assert trailing.extract_version>=45
 assert hashlib.sha256(archive.read(trailing)).hexdigest()==expected['trailingDigest']
 manifest=json.loads(archive.read('thingtime.json'));assert manifest['files'][0]['bytes']==total;assert manifest['files'][0]['sha256']==expected['digest']
 with open(sys.argv[1],'rb') as raw:
  raw.seek(-98,2);footer=raw.read(98)
  assert footer[:4]==b'PK\x06\x06' and footer[56:60]==b'PK\x06\x07' and footer[76:80]==b'PK\x05\x06'
  assert struct.unpack_from('<Q',footer,32)[0]==3 and struct.unpack_from('<Q',footer,48)[0]>0xffffffff
 print(json.dumps({'payloadBytes':total,'archiveBytes':os.path.getsize(sys.argv[1]),'payloadSha256':digest.hexdigest(),'lastByte':last,'trailingOffset':trailing.header_offset,'verification':'Python zipfile streamed every payload byte; CRC32, SHA256, manifest, trailing entry, ZIP64 directory/footer/locator'}))
