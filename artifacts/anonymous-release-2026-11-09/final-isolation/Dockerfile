FROM a0fa68f65311
USER root
WORKDIR /opt/thingtime-qa
COPY output/static public
COPY output/functions/__server.func server
COPY output/config.json config.json
COPY runtime.mjs runtime.mjs
COPY start.cjs start.cjs
COPY tests tests
RUN node -e "const fs=require('fs'),r='/opt/thingtime-qa/server/node_modules',s='/opt/thingtime-browser/node_modules';for(const n of ['sharp','@resvg/resvg-js','cbor-extract']){const a=require(r+'/'+n+'/package.json').version,b=require(s+'/'+n+'/package.json').version;if(a!==b)throw Error(n+' version drift');fs.rmSync(r+'/'+n,{recursive:true,force:true});fs.symlinkSync(s+'/'+n,r+'/'+n,'dir')}" \
 && NODE_PATH=/opt/thingtime-browser/node_modules node -e "const r=require('module').createRequire('/opt/thingtime-qa/server/index.mjs');for(const n of ['bcrypt','sharp','@resvg/resvg-js','cbor-extract'])r(n)" \
 && chown -R pwuser:pwuser /opt/thingtime-qa
USER pwuser
