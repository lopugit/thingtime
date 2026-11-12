import fs from 'node:fs';
import assert from 'node:assert/strict';
const report = { node:process.version, platform:process.platform, arch:process.arch,
  sourceSha256:'39be8cf1b16f9eb99455cd337adb26e32829521d2643de72addc4169cb0dbfde',
  sharpExecuted:false,nitroImported:false,apiStarted:false,storageTested:false,checks:{} };
try {
  const {default:bcrypt}=await import('./.output/server/node_modules/bcrypt/bcrypt.js');
  const hash=await bcrypt.hash('disposable-node-ios-fixture',10);
  assert(await bcrypt.compare('disposable-node-ios-fixture',hash));
  assert.equal(await bcrypt.compare('different-fixture',hash),false);
  report.checks.bcrypt=true;
  const {default:sharp}=await import('./.output/server/node_modules/sharp/dist/index.mjs');
  report.versions=sharp.versions;
  assert.equal(sharp.versions.vips,'8.18.7');
  const rgba=Buffer.from([255,0,0,255,0,255,0,128,0,0,255,0,255,255,255,255,0,0,0,255,90,80,70,64]);
  const raw={width:2,height:3,channels:4};
  const png=await sharp(rgba,{raw}).png().toBuffer();
  const decoded=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(decoded.info.width,2);assert.equal(decoded.info.height,3);assert.deepEqual(decoded.data,rgba);
  report.checks.pngRgbaAlpha=true;
  const webp=await sharp(png).resize({width:2,withoutEnlargement:true}).webp({lossless:true}).toBuffer();
  const webpPixels=await sharp(webp).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(webpPixels.info.width,2);assert.equal(webpPixels.info.height,3);
  assert.equal(webpPixels.data[7],128);assert.equal(webpPixels.data[11],0);
  const social=await sharp(webp).timeout({seconds:8}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  assert.equal(social.info.width,2);assert.equal(social.info.height,3);
  report.checks.webpAlphaAndSocialPng=true;
  const jpeg=await sharp(rgba,{raw}).jpeg().withMetadata({orientation:6}).toBuffer();
  assert.equal((await sharp(jpeg).metadata()).orientation,6);
  const rotated=await sharp(jpeg).rotate().png().toBuffer({resolveWithObject:true});
  assert.equal(rotated.info.width,3);assert.equal(rotated.info.height,2);
  const avatar=await sharp(jpeg).rotate().resize(128,128,{fit:'cover'}).png({compressionLevel:9,palette:false}).toBuffer({resolveWithObject:true});
  assert.equal(avatar.info.width,128);assert.equal(avatar.info.height,128);
  report.checks.exifRotateAndCover=true;
  const header=[...Buffer.from('GIF89a'),1,0,1,0,128,0,0,255,0,0,0,0,255];
  const frame=(code)=>[33,249,4,0,10,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,code,1,0];
  const gif=Buffer.from([...header,...frame(68),...frame(76),59]);
  const animated=sharp(gif,{animated:true,failOn:'warning'});
  assert.equal((await animated.metadata()).pages,2);
  const stats=await animated.stats();
  assert.equal(stats.channels[0].mean,127.5);assert.equal(stats.channels[2].mean,127.5);
  report.checks.fullAnimatedStats=true;
  const broken=Buffer.from([...header,...frame(68),...frame(124),59]);
  let rejected=false;
  try{await sharp(broken,{animated:true,failOn:'warning'}).stats();}catch{rejected=true;}
  assert(rejected,'corrupt second frame must fail full decode');
  report.checks.corruptLaterFrameRejected=true;
  report.sharpExecuted=true;
  const application=await import('./.output/server/index.mjs');
  report.nitroImported=true;report.middleware=typeof application.middleware;
} catch(error){report.error={name:error.name,code:error.code||null,message:error.message,stack:error.stack};}
fs.writeFileSync(process.env.PROBE_REPORT,JSON.stringify(report,null,2));
