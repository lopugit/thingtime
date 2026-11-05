import { emptyLocalMail, readMailLocal, writeMailLocal } from '../../../remix/app/mail/localStore';
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
export async function seed(ownerId: string, marker: string) {
 const scope = { kind: 'account' as const, origin: location.origin, ownerId };
 const local = emptyLocalMail();
 local.state.accounts = [{ id:'scope_mailbox', name:'Saved scope mailbox', address:'fixture@example.test', revision:0,
 servers:{imap:{host:'imap.example.test',port:993,security:'tls',username:'fixture@example.test'}},sync:{local:false,cloud:false,transport:'native'} }];
 local.localAccountIds = ['scope_mailbox'];
 local.state.folders = [{id:'scope_folder',accountId:'scope_mailbox',protocol:'imap',path:'INBOX',name:'Scope inbox',inbox:true}];
 local.state.messages = [{id:'scope_message',accountId:'scope_mailbox',folderId:'scope_folder',remoteId:'1',subject:marker+' subject',text:marker+' private body',from:'fixture@example.test',to:'fixture@example.test',date:null,unread:true,attachmentCount:0,truncated:false}];
 await writeMailLocal(scope,local,lease);
 return { subject:local.state.messages[0].subject, body:local.state.messages[0].text };
}
export async function proof(ownerId: string) {
 const local = await readMailLocal({kind:'account',origin:location.origin,ownerId},lease);
 return local.state.messages.map(row=>({subject:row.subject,text:row.text}));
}
