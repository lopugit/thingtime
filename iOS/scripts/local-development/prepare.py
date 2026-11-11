#!/usr/bin/env python3
"""Generate a distinct real-app iOS simulator development project outside source."""
import argparse, hashlib, json, os, pwd
from pathlib import Path
import shutil, subprocess, zipfile
import yaml
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
IOS=ROOT/'iOS'
RUNTIME_SHA='3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e'
ADDONS={
 '.output/server/node_modules/bcrypt/prebuilds/ios-arm64/bcrypt.node':'ef76191184be930143058f6f32ffe03fe52d7faca33f1a7e0997cdd72a531ad9',
 '.output/server/node_modules/sharp/src/build/Release/sharp-ios-arm64-0.35.5.node':'954e6b3e2c436b8b84834cfdcd96880785c7c0496c3381a916af7cc9fcd1d575'}
def sha(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def inventory(path):
 script="const {inventoryDirectory}=require('./native-bundles/inventory.cjs');const {canonical}=require('./native-bundles/release.cjs');const {createHash}=require('node:crypto');inventoryDirectory(process.argv[1]).then(files=>console.log(JSON.stringify({sha256:createHash('sha256').update(canonical(files)).digest('hex'),files:files.length,bytes:files.reduce((n,x)=>n+x.bytes,0)})));"
 return json.loads(subprocess.check_output(['node','-e',script,str(path)],cwd=ROOT,text=True,timeout=60))
def entries(path):
 script="require('./native-bundles/inventory.cjs').inventoryDirectory(process.argv[1]).then(files=>console.log(JSON.stringify(files)));"
 return json.loads(subprocess.check_output(['node','-e',script,str(path)],cwd=ROOT,text=True,timeout=60))
def verify_payload(canonical_output, staged_output, signed=False):
 expected={item['path']:item for item in entries(canonical_output)}
 observed={item['path']:item for item in entries(staged_output)}
 native={name.removeprefix('.output/'):digest for name,digest in ADDONS.items()}
 if set(observed)!=set(expected)|set(native):raise ValueError('Unexpected prepared/built payload paths')
 for name,item in expected.items():
  if name not in native and observed[name]!=item:raise ValueError('Canonical prepared/built payload bytes changed: '+name)
 for name,digest in native.items():
  if not signed and observed[name]['sha256']!=digest:raise ValueError('Unsigned genuine addon bytes changed')
 return {'canonicalFilesMatched':len(expected),'onlyExplicitAddonSubstitutions':True,'nativeAddons':{name:observed[name] for name in native},'inventory':inventory(staged_output)}
def validate(args):
 if args.cache.is_relative_to(ROOT):raise ValueError('Use a fresh cache outside checkout')
 if sha(args.web_output/'server/index.mjs')!=args.entry_sha256:raise ValueError('Canonical Nitro entry mismatch')
 if not (args.web_output/'public/index.html').is_file():raise ValueError('Require canonical complete Vite/Nitro output')
 if sha(args.runtime_cache/'runtime.zip')!=RUNTIME_SHA:raise ValueError('Imported runtime archive mismatch')
 for p,digest in ADDONS.items():
  if sha(args.native_app/p)!=digest:raise ValueError('Verified simulator native addon mismatch')
 for name,version in [('bcrypt','6.0.0'),('sharp','0.35.5')]:
  if json.loads((args.web_output/'server/node_modules'/name/'package.json').read_text())['version']!=version:raise ValueError('Native addon package changed; rebuild/verify genuine addon first')
 if not 1024<args.port<65536:raise ValueError('Require distinct non-default private ports')
def prepare(args):
 validate(args)
 source_inventory=inventory(args.web_output)
 if args.check_inputs:print('Input validation passed; no writes or execution');return
 if not args.allow_public_prerelease:raise ValueError('Require explicit --allow-public-prerelease for disposable simulator development only')
 if args.resume_preparation:
  if (args.cache/'DerivedData').exists() or (args.cache/'own-simulator.local.json').exists():raise ValueError('Resume only a preparation failure before build or simulator creation')
  previous=json.loads((args.cache/'preparation.json').read_text())
  if previous['entrySha256']!=args.entry_sha256 or previous['canonicalOutputInventory']!=source_inventory:raise ValueError('Prepared source inventory changed')
 else:args.cache.mkdir(parents=True,exist_ok=False)
 assets=args.cache/'LocalRuntime'
 if not args.resume_preparation:assets.mkdir();shutil.copytree(args.web_output,assets/'.output',symlinks=False)
 if sha(assets/'.output/server/index.mjs')!=args.entry_sha256:raise ValueError('Canonical Nitro changed during stage')
 if args.resume_preparation:verify_payload(args.web_output,assets/'.output')
 elif inventory(assets/'.output')!=source_inventory or inventory(args.web_output)!=source_inventory:raise ValueError('Canonical full inventory changed during stage')
 shutil.copyfile(HERE/'entry.mjs',assets/'entry.mjs');shutil.copyfile(HERE/'acceptance.js',assets/'acceptance.js')
 for name in ADDONS:
  target=assets/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(args.native_app/name,target)
 framework=args.cache/'Frameworks';framework.mkdir(exist_ok=args.resume_preparation);prefix='NodeMobile.xcframework/ios-arm64-simulator/'
 with zipfile.ZipFile(args.runtime_cache/'runtime.zip') as archive:
  for item in archive.infolist():
   if item.is_dir() or not item.filename.startswith(prefix):continue
   relative=Path(item.filename[len(prefix):])
   if relative.is_absolute() or '..' in relative.parts:raise ValueError('Unsafe archive entry')
   target=framework/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(archive.read(item))
 spec=yaml.safe_load((IOS/'project.yml').read_text());target=spec['targets']['Thingtime']
 spec['options']['createIntermediateGroups']=False
 spec['name']='ThingtimeLocalDevelopment';spec['targets']={'ThingtimeLocalDevelopment':target}
 spec['schemes']={'ThingtimeLocalDevelopment':{'build':{'targets':{'ThingtimeLocalDevelopment':'all'}},'run':{'config':'Debug'}}}
 spec['configFiles']={name:str((IOS/path).resolve()) for name,path in spec.get('configFiles',{}).items()}
 for package in spec.get('packages',{}).values():
  if 'path' in package:package['path']=str((IOS/package['path']).resolve())
 for source in target['sources']:
  if isinstance(source,str):raise ValueError('Expected explicit source mapping')
  old=source['path'];source['path']=str((IOS/old).resolve())
  if old=='Thingtime':source.setdefault('excludes',[]).extend(['Resources/Info.plist','Resources/Thingtime.entitlements'])
 target['sources'].append({'path':str(assets),'type':'folder','buildPhase':'resources'})
 target['dependencies']=[x for x in target['dependencies'] if 'package' in x]+[{'framework':str(framework/'NodeMobile.framework'),'embed':True,'codeSign':False}]
 target.pop('entitlements',None)
 target['info']['path']=str(args.cache/'Info.plist')
 props=target['info']['properties'];props['CFBundleDisplayName']='Thingtime Local Dev';props['ThingtimeWebURL']=f'http://127.0.0.1:{args.port}'
 props['NSAppTransportSecurity']={'NSExceptionDomains':{'127.0.0.1':{'NSExceptionAllowsInsecureHTTPLoads':True,'NSIncludesSubdomains':False}}}
 props.pop('CFBundleURLTypes',None)
 settings=target['settings']['base'];settings.update({'PRODUCT_BUNDLE_IDENTIFIER':'com.thingtime.localdevelopment','THINGTIME_IOS_BUNDLE_IDENTIFIER':'com.thingtime.localdevelopment','THINGTIME_WIDGET_GROUP':'group.com.thingtime.localdevelopment','CODE_SIGNING_ALLOWED':'NO','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'$(inherited) DEBUG THINGTIME_LOCAL_DEVELOPMENT','GCC_PREPROCESSOR_DEFINITIONS':'$(inherited) THINGTIME_LOCAL_DEVELOPMENT=1','SWIFT_OBJC_BRIDGING_HEADER':str(args.cache/'Bridging.h'),'IPHONEOS_DEPLOYMENT_TARGET':'18.0'})
 (args.cache/'Bridging.h').write_text('#import "'+str(IOS/'ShareSupport/ShareItemProviderBridge.h')+'"\n#import "'+str(IOS/'Thingtime/LocalRuntime/ThingtimeLocalNode.h')+'"\n')
 for script in target.get('preBuildScripts',[]):script['script']=script['script'].replace('$SRCROOT/..',str(ROOT))
 spec['settings']['base']['DEVELOPMENT_TEAM']='';spec['settings']['base']['CODE_SIGNING_ALLOWED']='NO'
 (args.cache/'project.yml').write_text(yaml.safe_dump(spec,sort_keys=False))
 receipt={'entrySha256':args.entry_sha256,'canonicalOutputInventory':source_inventory,'runtimeArchiveSha256':RUNTIME_SHA,'sourceToBinaryReproducibility':'unproven','origin':props['ThingtimeWebURL'],'bundleId':'com.thingtime.localdevelopment','localAccountApiSupported':False,'nativeAddonSha256':ADDONS,'toolCheckoutHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True,timeout=10).strip()}
 (args.cache/'preparation.json').write_text(json.dumps(receipt,indent=2)+'\n')
 env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','DEVELOPER_DIR'] if k in os.environ}
 env['USER']=pwd.getpwuid(os.getuid()).pw_name
 generation=subprocess.run(['xcodegen','generate','--spec',str(args.cache/'project.yml'),'--project',str(args.cache)],env=env,capture_output=True,text=True,timeout=60)
 (args.cache/'generation.local.log').write_text(generation.stdout+generation.stderr)
 if generation.returncode:raise RuntimeError('XcodeGen failed: '+generation.stderr[-1500:])
 print('Prepared separate development project; no simulator/app was started')
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['cache','web-output','runtime-cache','native-app']:p.add_argument('--'+name,required=True,type=lambda x:Path(x).resolve())
 p.add_argument('--entry-sha256',required=True);p.add_argument('--port',type=int,default=29741)
 p.add_argument('--resume-preparation',action='store_true')
 p.add_argument('--check-inputs',action='store_true');p.add_argument('--allow-public-prerelease',action='store_true')
 prepare(p.parse_args())
