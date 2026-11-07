const fs=require('fs');const out='/tmp/native-artifacts',started=Date.now();let lastPids=new Set();
const read=p=>{try{return fs.readFileSync(p,'utf8').trim()}catch{return null}};
const snap=()=>{
 const processes=fs.readdirSync('/proc').filter(n=>/^\d+$/.test(n)).flatMap(pid=>{const status=read('/proc/'+pid+'/status');if(!status)return[];const field=k=>status.match(new RegExp('^'+k+':\\s*(.*)$','m'))?.[1]??null;return[{pid:Number(pid),ppid:Number(field('PPid')),comm:field('Name'),rssKiB:parseInt(field('VmRSS')||'0')||0}]}).sort((a,b)=>b.rssKiB-a.rssKiB);
 const pids=new Set(processes.map(p=>p.pid)),gone=[...lastPids].filter(p=>!pids.has(p));lastPids=pids;
 fs.appendFileSync(out+'/memory-samples.jsonl',JSON.stringify({at:new Date().toISOString(),elapsedMs:Date.now()-started,phase:read(out+'/phase.json'),current:read('/sys/fs/cgroup/memory.current'),peak:read('/sys/fs/cgroup/memory.peak'),events:read('/sys/fs/cgroup/memory.events'),memoryStat:(read('/sys/fs/cgroup/memory.stat')||'').split('\n').filter(s=>/^(anon|file|shmem|kernel|slab) /.test(s)),processes,gone})+'\n');
 if(fs.existsSync(out+'/observer-stop')||Date.now()-started>480000)process.exit(0);
};snap();setInterval(snap,500);
