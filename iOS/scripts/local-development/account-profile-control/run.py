#!/usr/bin/env python3
"""One fresh simulator, actual Keychain profile retention across two processes. No server."""
import datetime,hashlib,json,os,plistlib,subprocess,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
PROFILE=ROOT/'iOS/Thingtime/LocalRuntime/ThingtimeLocalAccountProfile.swift'
BUNDLE='com.thingtime.localaccountprofilecontrol'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--cache',required=True,type=Path);parser.add_argument('--budget-anchor',type=Path);args=parser.parse_args()
 cache=args.cache.resolve();cache.mkdir(exist_ok=False);deadline=time.monotonic()+max(0,600-(time.time()-args.budget_anchor.stat().st_birthtime) if args.budget_anchor else 600);device=None
 report={'passed':False,'launches':[],'cleanup':[],'scope':'iOS Simulator actual Keychain profile; no Node/Nitro/HTTP or physical-device acceptance','sourceHashes':{str(p.relative_to(ROOT)):sha(p) for p in [PROFILE,HERE/'main.swift',HERE/'run.py']}}
 def call(parts,seconds=60):
  budget=min(seconds,deadline-time.monotonic())
  if budget<=0:raise TimeoutError('Control deadline before admission')
  result=subprocess.run([str(x) for x in parts],capture_output=True,text=True,timeout=budget)
  if result.returncode:raise RuntimeError(str(parts[0])+': '+result.stderr[-1200:])
  return result.stdout.strip()
 try:
  app=cache/'ProfileControl.app';app.mkdir();sdk=call(['xcrun','--sdk','iphonesimulator','--show-sdk-path'])
  report['sdk']=sdk;report['toolchain']=call(['xcodebuild','-version'])
  call(['xcrun','--sdk','iphonesimulator','swiftc','-parse-as-library','-DTHINGTIME_LOCAL_DEVELOPMENT','-target','arm64-apple-ios18.0-simulator','-sdk',sdk,PROFILE,HERE/'main.swift','-o',app/'ProfileControl','-framework','UIKit','-framework','Security','-framework','LocalAuthentication'],120)
  (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':BUNDLE,'CFBundleExecutable':'ProfileControl','CFBundleName':'ProfileControl','CFBundleVersion':'1','CFBundleShortVersionString':'1','CFBundlePackageType':'APPL','LSRequiresIPhoneOS':True,'UILaunchScreen':{},'UIApplicationSceneManifest':{'UIApplicationSupportsMultipleScenes':False,'UISceneConfigurations':{}}}))
  entitlements=cache/'simulator.entitlements';entitlements.write_bytes(plistlib.dumps({'application-identifier':BUNDLE,'keychain-access-groups':[BUNDLE]}))
  call(['codesign','--force','--sign','-','--entitlements',entitlements,app]);report['signedEntitlements']=call(['codesign','-d','--entitlements',':-',app]);report['binarySha256']=sha(app/'ProfileControl')
  device=call(['xcrun','simctl','create','Thingtime protected account profile control','com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro','com.apple.CoreSimulator.SimRuntime.iOS-27-0']);report['ownSimulator']=device
  call(['xcrun','simctl','boot',device]);call(['xcrun','simctl','bootstatus',device,'-b'],120);call(['xcrun','simctl','install',device,app])
  data=Path(call(['xcrun','simctl','get_app_container',device,BUNDLE,'data']));receipt=data/'Documents/receipt.json'
  for mode in ['initial','restart']:
   receipt.unlink(missing_ok=True)
   launch={'mode':mode,'launchOutput':call(['xcrun','simctl','launch',device,BUNDLE,mode])};report['launches'].append(launch)
   until=min(deadline,time.monotonic()+30)
   while not receipt.exists() and time.monotonic()<until:time.sleep(.2)
   launch['receipt']=json.loads(receipt.read_text())
   if not launch['receipt'].get('passed'):raise RuntimeError('Profile control refused: '+mode)
   call(['xcrun','simctl','terminate',device,BUNDLE],15);launch['terminated']=True
  if report['launches'][0]['receipt']['pid']==report['launches'][1]['receipt']['pid']:raise RuntimeError('Distinct process restart was not proven')
  report['passed']=True
 except Exception as error:report['error']=str(error)
 finally:
  if device:
   for operation in ['shutdown','delete']:
    try:
     result=subprocess.run(['xcrun','simctl',operation,device],capture_output=True,text=True,timeout=30)
     report['cleanup'].append({'operation':operation,'returncode':result.returncode})
    except Exception as error:report['cleanup'].append({'operation':operation,'error':type(error).__name__})
  report['passed']=report['passed'] and device is not None and len(report['cleanup'])==2 and all(item.get('returncode')==0 for item in report['cleanup'])
  report['observedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(cache/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
 print('Profile control passed:',report['passed'],'receipt:',cache/'verification.json')
 if not report['passed']:raise SystemExit(1)
if __name__=='__main__':main()
