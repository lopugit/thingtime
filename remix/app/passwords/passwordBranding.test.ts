import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
import { PASSWORD_BRAND_ICON, passwordBrandingMigration, migratePasswordPreviewContrast, PASSWORD_PREVIEW_ICON_CSS } from '~/components/Passwords/passwordBrandingBlocks';
import { BROWSER_PROVIDER_BLOCKS } from '~/components/Passwords/browserProviderBlocks';
import { PASSWORD_GENERATOR_BLOCKS } from '~/components/Passwords/passwordGeneratorDocument';
import { PASSWORD_PASSKEY_BLOCKS } from '~/components/Passwords/passwordPasskeyBlocks';
import { NATIVE_PASSWORD_CONNECTION_BLOCKS } from '~/components/Passwords/nativePasswordConnectionBlocks';
import { PASSWORD_MANAGER_SETTINGS_BLOCKS } from '~/components/Settings/passwordManagerSettingsBlocks';
import { passwordIconBlocks } from '~/components/Passwords/passwordIconBlocks';
const nodes=(blocks:WebpageBlock[]):WebpageBlock[]=>blocks.flatMap(block=>[block,...nodes(block.children||[])]);
test('provider, setup, connection, generator, entry-icon and settings documents expose an editable official tree',()=>{
 for(const blocks of [BROWSER_PROVIDER_BLOCKS,PASSWORD_GENERATOR_BLOCKS,PASSWORD_PASSKEY_BLOCKS,NATIVE_PASSWORD_CONNECTION_BLOCKS,PASSWORD_MANAGER_SETTINGS_BLOCKS,passwordIconBlocks]){
  const marks=nodes(blocks).filter(block=>block.type==='element'&&block.tag==='img'&&block.props?.src===PASSWORD_BRAND_ICON);
  assert.equal(marks.length,1);assert.equal(marks[0].props?.alt,'');assert.equal(marks[0].props?.['aria-hidden'],true);
  assert.equal(new Set(nodes(blocks).map(block=>block.id)).size,nodes(blocks).length);
 }
});
test('branding migration preserves authored text and styling, is idempotent, and respects deleting the editable image',()=>{
 const title={id:'test-title',type:'element',tag:'h2',text:'My vault',css:{color:'rebeccapurple'}} as WebpageBlock;
 const migrate=passwordBrandingMigration(title.id),before=[{id:'authored',type:'element',tag:'section',children:[title]}] as WebpageBlock[];
 const branded=migrate(before);assert.strictEqual(branded[0].children![0].children![1],title);assert.strictEqual(migrate(branded),branded);
 branded[0].children![0].children!.shift();assert.strictEqual(migrate(branded),branded);assert.equal(nodes(branded).filter(x=>x.tag==='img').length,0);
 const custom=[{id:'custom',type:'element',tag:'p',text:'Author layout without known heading'}] as WebpageBlock[];assert.strictEqual(migrate(custom),custom);
 assert.equal(before[0].children!.length,1);
});

test('subtitle repair preserves authored layouts, custom colors, deleted fields and input identity',()=>{
 const old={id:'pp-username',type:'element',tag:'span',text:'My account: {item.usernameLabel}',css:{color:'var(--tt-muted, #6b7280)','font-weight':'600'}} as WebpageBlock;
 const custom={id:'pp-type',type:'element',tag:'span',text:'Custom type',css:{color:'rebeccapurple'}} as WebpageBlock;
 const unrelated={...old,id:'authored-subtitle'};
 const before=[{id:'custom-container',type:'element',tag:'section',children:[old,custom,unrelated]}] as WebpageBlock[];
 const repaired=migratePasswordPreviewContrast(before),children=repaired[0].children!;
 assert.equal(children[0].text,old.text);assert.equal(children[0].css?.['font-weight'],'600');
 assert.equal(children[0].css?.color,'inherit');assert.equal(old.css?.color,'var(--tt-muted, #6b7280)');
 assert.strictEqual(children[1],custom);assert.strictEqual(children[2],unrelated);
 assert.strictEqual(migratePasswordPreviewContrast(repaired),repaired);
 const deleted=[{...before[0],children:[custom]}];assert.strictEqual(migratePasswordPreviewContrast(deleted),deleted);
});

test('default logo backplate upgrades exact old image CSS without replacing authored styles or deleted blocks',()=>{
 const old={id:'pp-icon',type:'element',tag:'img',props:{src:'{item.image}',title:'My icon'},css:{width:'32px',height:'32px','object-fit':'contain','flex-shrink':'0'}} as WebpageBlock;
 const before=[old],migrated=migratePasswordPreviewContrast(before);assert.deepEqual(migrated[0].css,PASSWORD_PREVIEW_ICON_CSS);assert.strictEqual(migrated[0].props,old.props);assert.equal(old.css?.background,undefined);assert.strictEqual(migratePasswordPreviewContrast(migrated),migrated);
 for(const css of [{...old.css,background:'rebeccapurple'},{...old.css,padding:'5px'},{...old.css,width:'48px'}]){const authored=[{...old,css}];assert.strictEqual(migratePasswordPreviewContrast(authored),authored);}
 const deletedBackground={...PASSWORD_PREVIEW_ICON_CSS};delete deletedBackground.background;const authored=[{...old,css:deletedBackground}];assert.strictEqual(migratePasswordPreviewContrast(authored),authored);
 const deleted:WebpageBlock[]=[];assert.strictEqual(migratePasswordPreviewContrast(deleted),deleted);
});
