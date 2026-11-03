import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';

export type ExtensionAccount = { id:string; username:string; displayName:string; active:boolean };
/** The first-party roster is read with its own httpOnly cookies. This projection
 * is metadata only: no email, session identifier, token, roles or account data. */
export async function extensionAccounts(signal:AbortSignal):Promise<ExtensionAccount[]> {
  await requireThingtimeCapability('api.auth-accounts','1.0.0');
  const response=await fetch('/api/v1/auth/accounts',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  const result=await response.json();
  signal.throwIfAborted();
  if(!response.ok||result?.ok!==true||!Array.isArray(result.accounts))throw Error('Account discovery is unavailable.');
  return result.accounts.filter((value:any)=>typeof value?.user?.id==='string'&&!value.user.temporary&&value.user.accountKind!=='service').map((value:any)=>({id:value.user.id,username:typeof value.user.username==='string'?value.user.username:'',displayName:typeof value.user.displayName==='string'?value.user.displayName:'',active:value.active===true}));
}
