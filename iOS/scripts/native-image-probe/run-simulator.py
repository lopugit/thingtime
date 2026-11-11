#!/usr/bin/env python3
"""Run the recovered native Nitro stack in a new disposable simulator."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import runpy
import shutil
import signal
import socket
import subprocess
import time
HERE=Path(__file__).resolve().parent
ENTRY='39be8cf1b16f9eb99455cd337adb26e32829521d2643de72addc4169cb0dbfde'
IDENTITY='com.thingtime.imageprobe.pr1000'
def sha(path):
    with path.open('rb') as source:return hashlib.file_digest(source,'sha256').hexdigest()
def main(args):
    if not json.loads((args.cache/'verification.json').read_text()).get('addonLinked'):raise ValueError('Require checked recovered addon')
    source=args.runtime_cache/'ThingtimeNodeProbe.app'
    if sha(source/'.output/server/index.mjs')!=ENTRY:raise ValueError('Canonical Nitro hash changed')
    app=args.cache/'ThingtimeImageProbe.app'
    if app.exists():raise ValueError('Require fresh task app destination')
    env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR','DEVELOPER_DIR'] if k in os.environ}
    deadline=time.monotonic()+480
    commands=[];device=None;db_guard=None
    if args.http:
        db_guard=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        db_guard.bind(('127.0.0.1',0))
        db_port=db_guard.getsockname()[1]
        if db_port==27017:raise ValueError('Refuse default MongoDB port')
    report={'sourceSha256':ENTRY,'runtime':args.runtime,'simulatorDeleted':False,'apiStarted':False,'storageTested':False}
    def run(command):
        commands.append([str(x) for x in command])
        process=subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        (args.cache/'simulator-active-process.json').write_text(json.dumps({'pid':process.pid,'tool':str(command[0])})+'\n')
        try:
            stdout,stderr=process.communicate(timeout=min(120,max(1,deadline-time.monotonic())))
        except BaseException:
            os.killpg(process.pid,signal.SIGTERM)
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.wait()
            raise
        finally:
            (args.cache/'simulator-active-process.json').unlink(missing_ok=True)
        if process.returncode:raise RuntimeError(stderr[:2000])
        return stdout.strip()
    def guard_not_listening():
        # Darwin may reject SO_ACCEPTCONN; inspect only this process's reserved port.
        checked=subprocess.run(['/usr/sbin/lsof','-nP','-a','-p',str(os.getpid()),'-iTCP:'+str(db_port),'-sTCP:LISTEN'],capture_output=True,text=True,timeout=5)
        return checked.returncode==1 and not checked.stdout.strip()
    try:
        shutil.copytree(source,app,symlinks=False)
        if sha(app/'.output/server/index.mjs')!=ENTRY:raise ValueError('Canonical entry copy mismatch')
        addon=app/'.output/server/node_modules/sharp/src/build/Release/sharp-ios-arm64-0.35.5.node'
        addon.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(args.cache/'sharp-ios-arm64-0.35.5.node',addon)
        if args.http:
            script=(HERE/'http-probe.mjs').read_text().replace('__DB_PORT__',str(db_port)).replace('__ENTRY_SHA256__',ENTRY)
            (app/'probe.mjs').write_text(script)
            report['databaseFence']={'host':'127.0.0.1','port':db_port,'reservedNonListening':guard_not_listening()}
            if not report['databaseFence']['reservedNonListening']:raise RuntimeError('DB fence unexpectedly listening')
        else:
            shutil.copyfile(HERE/'probe.mjs',app/'probe.mjs')
        plist=plistlib.loads((app/'Info.plist').read_bytes());plist['CFBundleIdentifier']=IDENTITY;plist['CFBundleExecutable']='ThingtimeImageProbe';plist['CFBundleName']='Thingtime Image Probe'
        common=HERE.parent/'native-runtime-probe'
        plist['UIApplicationSceneManifest']=runpy.run_path(str(common/'run.py'))['probe_scene_manifest']()
        (app/'Info.plist').write_bytes(plistlib.dumps(plist))
        (app/'ThingtimeNodeProbe').unlink()
        sdk=run(['xcrun','--sdk','iphonesimulator','--show-sdk-path'])
        report['sdk']=Path(sdk).name
        run(['xcrun','clang++','-arch','arm64','-isysroot',sdk,'-mios-simulator-version-min=18.0','-fobjc-arc',str(common/'main.mm'),'-F',str(app/'Frameworks'),'-framework','NodeMobile','-framework','UIKit','-framework','Foundation','-Wl,-rpath,@executable_path/Frameworks','-o',str(app/'ThingtimeImageProbe')])
        for target in [addon,app/'Frameworks/NodeMobile.framework',app]:run(['/usr/bin/codesign','--force','--sign','-',str(target)])
        device=run(['xcrun','simctl','create','Thingtime isolated real Sharp probe','com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',args.runtime])
        (args.cache/'own-simulator.local.json').write_text(json.dumps({'udid':device,'bundleId':IDENTITY})+'\n')
        run(['xcrun','simctl','boot',device]);run(['xcrun','simctl','bootstatus',device,'-b'])
        run(['xcrun','simctl','install',device,str(app)]);run(['xcrun','simctl','launch',device,IDENTITY])
        data=Path(run(['xcrun','simctl','get_app_container',device,IDENTITY,'data']))
        receipt=data/'Documents/nitro-import.json'
        wait_until=min(deadline,time.monotonic()+60)
        while not receipt.exists() and time.monotonic()<wait_until:time.sleep(.2)
        if not receipt.exists():
            logs=run(['xcrun','simctl','spawn',device,'log','show','--last','3m','--style','compact','--predicate','process == "ThingtimeImageProbe"'])
            (args.cache/'runtime-process.local.log').write_text(logs+'\n')
            raise RuntimeError('No native image receipt within60seconds; inspect own process log')
        text=receipt.read_text();text=re.sub(r'/Users/[^\n"]*?/ThingtimeImageProbe\.app','<APP_BUNDLE>',text)
        report['native']=json.loads(text)
        report['apiStarted']=report['native'].get('apiStarted') is True
    except Exception as error:
        report['error']=str(error).replace(str(args.cache),'<CACHE>')
        raise
    finally:
        if device:
            for operation in ['terminate','shutdown','delete']:
                command=['xcrun','simctl',operation,device]+([IDENTITY] if operation=='terminate' else [])
                result=subprocess.run(command,env=env,capture_output=True,timeout=30)
                if operation=='delete':report['simulatorDeleted']=result.returncode==0
        if db_guard:
            report['databaseFence']['nonListeningAtCleanup']=guard_not_listening()
            db_guard.close()
        (args.cache/'simulator-verification.json').write_text(json.dumps(report,indent=2)+'\n')
        (args.cache/'simulator-commands.local.json').write_text(json.dumps(commands,indent=2)+'\n')
        if device and not report['simulatorDeleted']:raise RuntimeError('Own simulator cleanup failed')
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for flag in ['cache','runtime-cache']:parser.add_argument('--'+flag,required=True,type=lambda x:Path(x).resolve())
    parser.add_argument('--runtime',required=True)
    parser.add_argument('--http',action='store_true',help='Real HTTP manifest smoke with a reserved non-listening DB destination')
    main(parser.parse_args())
