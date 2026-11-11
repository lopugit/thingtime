#!/usr/bin/env python3
"""Bounded real SQLite/BSON probe in a task-owned simulator; no backend or accounts."""
import argparse, datetime, hashlib, json, os
from pathlib import Path
import plistlib, runpy, shutil, signal, subprocess, time, zipfile
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
PIN='3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e'
IDENTITY='com.thingtime.sqliteprobe.pr1000'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def main(args):
 if args.cache.is_relative_to(ROOT):raise ValueError('Cache must be outside checkout')
 args.cache.mkdir(parents=True,exist_ok=False)
 env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','DEVELOPER_DIR'] if k in os.environ}
 deadline=time.monotonic()+1800; device=None;commands=[]
 report={'sourceRef':args.source_ref,'runtimeDistributionSha256':PIN,'sourceToBinaryReproducibility':'unproven','simulatorDeleted':False,'passed':False,'phases':[]}
 def remaining():
  value=deadline-time.monotonic()
  if value<=0:raise TimeoutError('Overall experiment deadline expired before operation admission')
  return value
 def run(command,limit=120,raw=False):
  budget=min(limit,remaining())
  command=[str(x) for x in command];commands.append(command)
  p=subprocess.Popen(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=not raw,start_new_session=True)
  try:out,err=p.communicate(timeout=budget)
  except BaseException:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
   raise
  if p.returncode:raise RuntimeError(str(err[:2400]))
  return out if raw else out.strip()
 try:
  archive=args.runtime_cache/'runtime.zip'
  if sha(archive)!=PIN:raise ValueError('Runtime archive digest mismatch')
  app=args.cache/'ThingtimeSqliteProbe.app';framework=app/'Frameworks';framework.mkdir(parents=True)
  prefix='NodeMobile.xcframework/ios-arm64-simulator/'
  with zipfile.ZipFile(archive) as z:
   for item in z.infolist():
    if item.is_dir() or not item.filename.startswith(prefix):continue
    relative=Path(item.filename[len(prefix):])
    if relative.is_absolute() or '..' in relative.parts:raise ValueError('Unsafe archive path')
    target=framework/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(item))
  report['frameworkSha256']=sha(framework/'NodeMobile.framework/NodeMobile')
  frozen=args.cache/'source';frozen.mkdir();report['sourceHashes']={}
  for name in ['contract.ts','sqliteStore.ts','collectionContract.ts','collectionProvider.ts']:
   source='remix/app/api/utils/documentStore/'+name
   content=run(['git','show',args.source_ref+':'+source],raw=True);(frozen/name).write_bytes(content);report['sourceHashes'][source]=sha(frozen/name)
  shutil.copyfile(HERE/'probe.mjs',frozen/'probe.mjs')
  resolution=json.loads(run(['node','-e',"const {createRequire}=require('node:module');const path=require('node:path');const r=createRequire(path.resolve('remix/package.json'));const v=createRequire(r.resolve('vite/package.json'));console.log(JSON.stringify({esbuild:v.resolve('esbuild'),mongodb:r.resolve('mongodb/package.json')}));"]))
  esbuild=Path(resolution['esbuild']);mongodb=Path(resolution['mongodb']).parent
  report['dependencyResolution']='workspace MongoDB and workspace Vite esbuild dependency'
  report['executedToolSha256']={str(p.relative_to(ROOT)):sha(p) for p in [HERE/'run.py',HERE/'probe.mjs',HERE.parent/'native-runtime-probe/main.mm']}
  build="const esbuild=require(process.argv[1]);esbuild.buildSync({entryPoints:[process.argv[2]],outfile:process.argv[3],bundle:true,platform:'node',format:'esm',target:'node24',packages:'bundle',nodePaths:[process.argv[4]],banner:{js:'import { createRequire as __probeCreateRequire } from \"node:module\"; const require=__probeCreateRequire(import.meta.url);'},metafile:true,logLevel:'error'});"
  # Runtime packages retain genuine MongoDB/BSON exports. Optional driver integrations remain external.
  build=build.replace("metafile:true","external:['kerberos','@mongodb-js/zstd','@aws-sdk/credential-providers','gcp-metadata','snappy','socks','aws4','mongodb-client-encryption'],metafile:true")
  run(['node','-e',build,esbuild,frozen/'probe.mjs',app/'probe.mjs',mongodb.parent])
  report['mongodbVersion']=json.loads((mongodb/'package.json').read_text())['version'];report['bundleSha256']=sha(app/'probe.mjs')
  report['esbuildVersion']=json.loads((esbuild.parent.parent/'package.json').read_text())['version']
  common=HERE.parent/'native-runtime-probe'
  plist={'CFBundleIdentifier':IDENTITY,'CFBundleName':'Thingtime SQLite Probe','CFBundleExecutable':'ThingtimeSqliteProbe','CFBundlePackageType':'APPL','CFBundleVersion':'1','CFBundleShortVersionString':'1.0','LSRequiresIPhoneOS':True,'MinimumOSVersion':'18.0','UIDeviceFamily':[1,2],'UILaunchScreen':{},'UIApplicationSceneManifest':runpy.run_path(str(common/'run.py'))['probe_scene_manifest']()}
  (app/'Info.plist').write_bytes(plistlib.dumps(plist))
  sdk=run(['xcrun','--sdk','iphonesimulator','--show-sdk-path']);report['sdk']=Path(sdk).name
  run(['xcrun','clang++','-arch','arm64','-isysroot',sdk,'-mios-simulator-version-min=18.0','-fobjc-arc',common/'main.mm','-F',framework,'-framework','NodeMobile','-framework','UIKit','-framework','Foundation','-Wl,-rpath,@executable_path/Frameworks','-o',app/'ThingtimeSqliteProbe'])
  for target in [framework/'NodeMobile.framework',app]:run(['/usr/bin/codesign','--force','--sign','-',target])
  device=run(['xcrun','simctl','create','Thingtime SQLite isolated PR1000','com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',args.runtime]);(args.cache/'own-simulator.local.json').write_text(json.dumps({'udid':device,'bundleId':IDENTITY}))
  report['runtime']=args.runtime
  run(['xcrun','simctl','boot',device]);run(['xcrun','simctl','bootstatus',device,'-b']);run(['xcrun','simctl','install',device,app])
  report['harnessBinarySha256']=sha(app/'ThingtimeSqliteProbe')
  installed=Path(run(['xcrun','simctl','get_app_container',device,IDENTITY,'app'])).resolve()
  executable=installed/'ThingtimeSqliteProbe'
  if device not in str(executable) or plistlib.loads((installed/'Info.plist').read_bytes())['CFBundleIdentifier']!=IDENTITY:raise RuntimeError('Installed task app ownership mismatch')
  def verify_pid(pid):
   # Only the PID returned by this exact simulator launch may be signalled.
   observed=run(['/bin/ps','-p',pid,'-o','comm='])
   if Path(observed).resolve()!=executable:raise RuntimeError('PID executable ownership mismatch; refusing signal')
   return {'pid':pid,'executableMatchesOwnInstalledApp':True,'executableSha256':sha(executable)}
  def wal_state():
   result={}
   for name in ['primitive.sqlite-wal','collections.sqlite-wal']:
    p=data/'Documents'/name
    if not p.is_file() or p.stat().st_size<=32:raise RuntimeError('Require observed nonempty SQLite WAL: '+name)
    result[name]={'size':p.stat().st_size,'sha256':sha(p)}
   return result
  data=Path(run(['xcrun','simctl','get_app_container',device,IDENTITY,'data']));receipt=data/'Documents/nitro-import.json'
  for phase in ['write','restart-read']:
   launch=run(['xcrun','simctl','launch',device,IDENTITY]);report.setdefault('launchPids',[]).append(int(launch.rsplit(':',1)[1].strip()))
   until=min(deadline,time.monotonic()+60)
   while not receipt.exists() and time.monotonic()<until:time.sleep(.2)
   if not receipt.exists():raise RuntimeError('No SQLite receipt within 60 seconds')
   result=json.loads(receipt.read_text());report['phases'].append(result)
   if result['phase']!=phase or not result['passed']:raise RuntimeError('Native SQLite phase failed: '+json.dumps(result))
   if phase=='write':
    pid=report['launchPids'][-1]
    report['writerOwnership']=verify_pid(pid)
    report['walBeforeKill']=wal_state()
    # Revalidate exact executable immediately before SIGKILL; any exit/mismatch aborts.
    report['immediatePreSignalOwnership']=verify_pid(pid)
    remaining();os.kill(pid,signal.SIGKILL)
    report['writerSignal']='SIGKILL'
    until=min(deadline,time.monotonic()+10)
    while time.monotonic()<until:
     state=subprocess.run(['/bin/ps','-p',str(pid),'-o','stat='],capture_output=True,text=True,timeout=min(2,remaining()))
     if state.returncode==1 or state.stdout.strip().startswith('Z'):break
     time.sleep(.1)
    else:raise RuntimeError('Killed writer did not exit within deadline')
    report['walAfterKill']=wal_state()
    if report['walBeforeKill']!=report['walAfterKill']:raise RuntimeError('Committed WAL bytes changed before recovery launch')
    report['uncleanWriterExitVerified']=True
   else:
    report['readerOwnership']=verify_pid(report['launchPids'][-1])
   receipt.unlink()
  report['distinctProcessRestart']=len(set(report['launchPids']))==2
  report['databaseHeaders']={p.name:p.open('rb').read(16).decode('ascii') for p in (data/'Documents').glob('*.sqlite')}
  report['passed']=report['distinctProcessRestart'] and len(report['databaseHeaders'])==2 and all(x=='SQLite format 3\u0000' for x in report['databaseHeaders'].values())
 except Exception as e:report['error']=str(e).replace(str(args.cache),'<CACHE>');raise
 finally:
  report['cleanup']=[]
  try:
   if device:
    for operation in ['terminate','shutdown','delete']:
     item={'operation':operation,'passed':False}
     try:
      result=subprocess.run(['xcrun','simctl',operation,device]+([IDENTITY] if operation=='terminate' else []),env=env,capture_output=True,timeout=30)
      item['returncode']=result.returncode;item['passed']=result.returncode==0
      if operation=='delete':report['simulatorDeleted']=item['passed']
     except Exception as error:item['error']=type(error).__name__
     report['cleanup'].append(item)
  finally:
   report['cleanupPassed']=not device or all(item['passed'] for item in report['cleanup'])
   report['passed']=report['passed'] and report['cleanupPassed'] and report['simulatorDeleted']
   report['observedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
   # Persist the final receipt even if an independent cleanup operation timed out.
   (args.cache/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
   (args.cache/'commands.local.json').write_text(json.dumps(commands,indent=2)+'\n')
  if not report['passed']:raise RuntimeError('Experiment or exact task simulator cleanup failed; inspect verification.json')
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for flag in ['cache','runtime-cache']:p.add_argument('--'+flag,required=True,type=lambda x:Path(x).resolve())
 p.add_argument('--source-ref',default='40c57f919ac1824103cb8307a1fcda145ceb25f5');p.add_argument('--runtime',required=True)
 main(p.parse_args())
