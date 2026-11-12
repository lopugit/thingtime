import datetime, hashlib, json, os, pathlib, shlex, subprocess, time
ROOT=pathlib.Path(__file__).resolve().parents[4]
OUT=pathlib.Path(__file__).resolve().parent
receipt={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':[],'claim':'Isolated compiled Nitro/provider fixtures; not installed full Builder or iOS acceptance'}
def save(): (OUT/'verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
commands=[('build-web',['corepack','pnpm','--dir','electron','run','build:web'],1800),('verify-web',['corepack','pnpm','--dir','electron','run','verify:web'],300),('mongo-http',['node','electron/scripts/test-bundled-local-runtime.cjs'],300),('sqlite-http',['node','electron/scripts/test-bundled-sqlite-account.cjs'],300)]
for name,args,timeout in commands:
 env=os.environ.copy()
 if name in ['mongo-http','sqlite-http']:
  entry=ROOT/'electron/dist/web/.output/server/index.mjs'
  receipt['nitroSha256']=hashlib.sha256(entry.read_bytes()).hexdigest()
 if name=='sqlite-http': env.update({'THINGTIME_RUN_BUNDLED_SQLITE_ACCOUNT_TEST':'1','THINGTIME_SQLITE_EXPECTED_NITRO_SHA':receipt['nitroSha256']})
 log=OUT/(name+'.log');start=time.monotonic();print('START '+name,flush=True)
 with log.open('w') as output:
  try: result=subprocess.run(args,cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=timeout);code=result.returncode
  except subprocess.TimeoutExpired: code=None
 receipt['checks'].append({'name':name,'command':shlex.join(args),'exitCode':code,'elapsedSeconds':round(time.monotonic()-start,3),'log':log.name})
 save();print('END '+name+' '+str(code),flush=True)
 if code!=0: break
receipt['endedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
