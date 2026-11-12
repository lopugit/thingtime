#!/usr/bin/env python3
"""One fresh simulator, two bounded native environment assertion controls."""
import datetime,hashlib,json,os,plistlib,signal,subprocess,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
CACHE=Path('/tmp/thingtime-ios-reload-env-control-02')
BUDGET_ANCHOR=Path('/tmp/thingtime-ios-reload-env-control-01')
BUNDLE='com.thingtime.reloadenvcontrol'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 CACHE.mkdir(exist_ok=False);deadline=time.monotonic()+max(0,600-(time.time()-BUDGET_ANCHOR.stat().st_birthtime));device=None
 report={'passed':False,'launches':[],'cleanup':[],'sourceHashes':{p.name:sha(p) for p in [HERE/'main.swift',HERE/'run.py']}}
 def call(args,seconds=60):
  budget=min(seconds,deadline-time.monotonic())
  if budget<=0:raise TimeoutError('Control deadline before admission')
  p=subprocess.run([str(x) for x in args],capture_output=True,text=True,timeout=budget)
  if p.returncode:raise RuntimeError(str(args[0])+': '+p.stderr[-1000:])
  return p.stdout.strip()
 try:
  app=CACHE/'ReloadControl.app';app.mkdir()
  sdk=call(['xcrun','--sdk','iphonesimulator','--show-sdk-path'])
  call(['xcrun','--sdk','iphonesimulator','swiftc','-target','arm64-apple-ios18.0-simulator','-sdk',sdk,HERE/'main.swift','-o',app/'ReloadControl','-framework','UIKit','-framework','WebKit'],120)
  (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':BUNDLE,'CFBundleExecutable':'ReloadControl','CFBundleName':'ReloadControl','CFBundleVersion':'1','CFBundleShortVersionString':'1','CFBundlePackageType':'APPL','LSRequiresIPhoneOS':True,'UILaunchScreen':{},'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False,'UISceneConfigurations':{}}}))
  call(['codesign','--force','--sign','-',app]);report['binarySha256']=sha(app/'ReloadControl')
  device=call(['xcrun','simctl','create','Thingtime reload environment control','com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro','com.apple.CoreSimulator.SimRuntime.iOS-27-0']);report['ownSimulator']=device
  call(['xcrun','simctl','boot',device]);call(['xcrun','simctl','bootstatus',device,'-b'],120);call(['xcrun','simctl','install',device,app])
  data=Path(call(['xcrun','simctl','get_app_container',device,BUNDLE,'data']));receipt=data/'Documents/receipt.json'
  for mode in ['preserve','remove']:
   if receipt.exists():receipt.unlink()
   launch={'mode':mode,'launchOutput':call(['xcrun','simctl','launch',device,BUNDLE,mode])};report['launches'].append(launch)
   until=min(deadline,time.monotonic()+100)
   while time.monotonic()<until:
    try:events=json.loads(receipt.read_text())
    except (FileNotFoundError,json.JSONDecodeError):events=[]
    if any(e['stage']=='passed' for e in events):break
    # The negative process may abort; retain its latest receipt without relaunching.
    if mode=='remove' and any(e['stage']=='before-spellcheck' for e in events):
     time.sleep(3);break
    time.sleep(.25)
   launch['events']=json.loads(receipt.read_text()) if receipt.exists() else []
   p=subprocess.run(['xcrun','simctl','terminate',device,BUNDLE],capture_output=True,text=True,timeout=15);launch['terminateReturncode']=p.returncode
   if mode=='preserve' and not any(e['stage']=='passed' for e in launch['events']):raise RuntimeError('Preserved environment control did not finish; stop without negative launch')
  report['controlCompleted']=True
 except Exception as error:report['error']=str(error)
 finally:
  if device:
   for op in ['shutdown','delete']:
    try:
     p=subprocess.run(['xcrun','simctl',op,device],capture_output=True,text=True,timeout=30);report['cleanup'].append({'operation':op,'returncode':p.returncode})
    except Exception as e:report['cleanup'].append({'operation':op,'error':type(e).__name__})
  report['observedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(CACHE/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
 print('Control receipt:',CACHE/'verification.json')
if __name__=='__main__':main()
