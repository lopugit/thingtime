#!/usr/bin/env python3
"""Build/run the real opt-in app once on a new simulator, retaining diagnostics."""
import argparse, datetime, hashlib, json, os, pwd
from pathlib import Path
import plistlib, signal, socket, subprocess, time
from prepare import verify_payload, inventory
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
BUNDLE='com.thingtime.localdevelopment'
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def run(args):
 if args.cache.exists() and not args.resume_preparation:raise ValueError('Require a new private cache')
 env={key:os.environ[key] for key in ['PATH','HOME','TMPDIR','DEVELOPER_DIR'] if key in os.environ}
 env['USER']=pwd.getpwuid(os.getuid()).pw_name
 env['CARGO_TARGET_DIR']=str(args.cache/'rust-target')
 remaining_budget=1800-(max(0,time.time()-args.cache.stat().st_birthtime) if args.resume_preparation else 0)
 deadline=time.monotonic()+remaining_budget;device=None;commands=[]
 report={'passed':False,'simulatorDeleted':False,'sourceToBinaryReproducibility':'unproven','localAccountApiSupported':False,'networkUnavailableScope':'development WebView external HTTP(S) only; OS networking not disabled'}
 def remaining():
  value=deadline-time.monotonic()
  if value<=0:raise TimeoutError('Development experiment deadline expired before command admission')
  return value
 def command(parts,limit=120,log=None):
  parts=[str(p) for p in parts];budget=min(limit,remaining());commands.append(parts)
  p=subprocess.Popen(parts,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
  try:out,_=p.communicate(timeout=budget)
  except BaseException:
   os.killpg(p.pid,signal.SIGTERM)
   try:out,_=p.communicate(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);out,_=p.communicate(timeout=5)
   if log:log.write_text(out)
   raise
  if log:log.write_text(out)
  if p.returncode:raise RuntimeError('Command failed: '+parts[0]+': '+out[-2000:])
  return out.strip()
 try:
  check=socket.socket()
  try:check.bind(('127.0.0.1',args.port))
  finally:check.close()
  command(['python3',HERE/'prepare.py','--cache',args.cache,'--web-output',args.web_output,'--entry-sha256',args.entry_sha256,'--runtime-cache',args.runtime_cache,'--native-app',args.native_app,'--port',args.port,'--allow-public-prerelease']+(['--resume-preparation'] if args.resume_preparation else []))
  report['preparation']=json.loads((args.cache/'preparation.json').read_text())
  report['executedToolSha256']={str(p.relative_to(ROOT)):sha(p) for p in [HERE/'run.py',HERE/'prepare.py',HERE/'entry.mjs',HERE/'acceptance.js',ROOT/'iOS/Thingtime/LocalRuntime/ThingtimeLocalRuntime.swift',ROOT/'iOS/Thingtime/LocalRuntime/ThingtimeLocalNode.mm',ROOT/'iOS/Thingtime/App/ThingtimeApp.swift',ROOT/'iOS/Thingtime/Web/WebView.swift',ROOT/'iOS/Thingtime/Web/ThingtimeWebDestination.swift']}
  command(['xcodebuild','-project',args.cache/'ThingtimeLocalDevelopment.xcodeproj','-scheme','ThingtimeLocalDevelopment','-configuration','Debug','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',args.cache/'DerivedData','ARCHS=arm64','ONLY_ACTIVE_ARCH=YES','CODE_SIGNING_ALLOWED=NO','build'],limit=1200,log=args.cache/'build.local.log')
  app=args.cache/'DerivedData/Build/Products/Debug-iphonesimulator/ThingtimeLocalDevelopment.app'
  info=plistlib.loads((app/'Info.plist').read_bytes())
  if info['CFBundleIdentifier']!=BUNDLE or info['ThingtimeWebURL']!=f'http://127.0.0.1:{args.port}':raise RuntimeError('Development app identity/origin mismatch')
  if sha(app/'LocalRuntime/.output/server/index.mjs')!=args.entry_sha256:raise RuntimeError('Built app changed canonical Nitro entry')
  for name in ['bcrypt/prebuilds/ios-arm64/bcrypt.node','sharp/src/build/Release/sharp-ios-arm64-0.35.5.node']:
   command(['/usr/bin/codesign','--force','--sign','-',app/'LocalRuntime/.output/server/node_modules'/name])
  for p in [app/'Frameworks/NodeMobile.framework',app]:command(['/usr/bin/codesign','--force','--sign','-',p])
  command(['/usr/bin/codesign','--verify','--deep','--strict',app])
  report['signedPayload']=verify_payload(args.web_output,app/'LocalRuntime/.output',signed=True)
  report['signedLocalRuntimeInventory']=inventory(app/'LocalRuntime')
  report['signedAppInventory']=inventory(app)
  report['binarySha256']=sha(app/info['CFBundleExecutable']);report['frameworkSha256']=sha(app/'Frameworks/NodeMobile.framework/NodeMobile')
  device=command(['xcrun','simctl','create','Thingtime actual local development PR1000','com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',args.runtime]);(args.cache/'own-simulator.local.json').write_text(json.dumps({'udid':device,'bundleId':BUNDLE}))
  command(['xcrun','simctl','boot',device]);command(['xcrun','simctl','bootstatus',device,'-b']);command(['xcrun','simctl','install',device,app]);command(['xcrun','simctl','launch',device,BUNDLE])
  installed=Path(command(['xcrun','simctl','get_app_container',device,BUNDLE,'app']))
  report['installedAppInventory']=inventory(installed)
  if report['installedAppInventory']!=report['signedAppInventory']:raise RuntimeError('Installed executable/resources differ from exact signed built app')
  data=Path(command(['xcrun','simctl','get_app_container',device,BUNDLE,'data']));work=data/'Library/Application Support/ThingtimeLocalDevelopment'
  command(['xcrun','simctl','io',device,'screenshot',args.cache/'startup.png'])
  until=min(deadline,time.monotonic()+150)
  while time.monotonic()<until:
   if (work/'runtime.json').exists() and not json.loads((work/'runtime.json').read_text()).get('ready'):break
   if (work/'webview.json').exists():break
   time.sleep(.25)
  for name in ['runtime.json','ui-edit.json','webview.json','startup-error.json']:
   if (work/name).exists():report[name]=json.loads((work/name).read_text())
  command(['xcrun','simctl','io',device,'screenshot',args.cache/'rendered.png'])
  web=report.get('webview.json',{});native=report.get('runtime.json',{})
  report['passed']=native.get('ready') is True and web.get('passed') is True and web.get('manifestStatus')==200 and web.get('rootChildren',0)>0 and web.get('externalRequestRejected') is True and web.get('origin')==report['preparation']['origin']
 except Exception as error:report['error']=str(error).replace(str(args.cache),'<CACHE>')
 finally:
  report['cleanup']=[]
  if device:
   try:
    logs=subprocess.run(['xcrun','simctl','spawn',device,'log','show','--last','3m','--style','compact','--predicate','process == "ThingtimeLocalDevelopment"'],env=env,capture_output=True,text=True,timeout=30)
    (args.cache/'app-process.local.log').write_text(logs.stdout)
   except Exception:pass
   for operation in ['terminate','shutdown','delete']:
    item={'operation':operation,'passed':False}
    try:
     p=subprocess.run(['xcrun','simctl',operation,device]+([BUNDLE] if operation=='terminate' else []),env=env,capture_output=True,timeout=30);item['returncode']=p.returncode;item['passed']=p.returncode==0
     if operation=='delete':report['simulatorDeleted']=item['passed']
    except Exception as error:item['error']=type(error).__name__
    report['cleanup'].append(item)
  report['passed']=report['passed'] and report['simulatorDeleted'] and all(x['passed'] for x in report['cleanup'])
  report['observedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
  if args.cache.exists():
   (args.cache/'verification.json').write_text(json.dumps(report,indent=2)+'\n');(args.cache/'commands.local.json').write_text(json.dumps(commands,indent=2)+'\n')
  if not report['passed']:raise RuntimeError('Development app acceptance incomplete; inspect private verification/build diagnostics')
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['cache','web-output','runtime-cache','native-app']:p.add_argument('--'+name,required=True,type=lambda x:Path(x).resolve())
 p.add_argument('--resume-preparation',action='store_true')
 p.add_argument('--entry-sha256',required=True);p.add_argument('--runtime',required=True);p.add_argument('--port',default=29741,type=int)
 run(p.parse_args())
