const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'../..'),esbuild=require(path.join(root,'MCP/node_modules/esbuild'));
for(const [entry,output,globalName]of [['test.ts','test.mjs',null],['fixture.ts','fixture.js','protectedRecoveryFixture']]){
 const name='protectedRecovery.browser.'+entry;
 esbuild.buildSync({absWorkingDir:root,entryPoints:['remix/app/local-workspace/'+name],outfile:'tmp/continuation/protected-account.'+output,bundle:true,platform:globalName?'browser':'node',format:globalName?'iife':'esm',...(globalName?{globalName,define:{'process.env.NODE_ENV':'"production"'}}:{})});
}
