import type { CharacterRoster } from '../components/Characters/characterClient';
import { offlineWorkspaceUser } from '../hooks/useWorkspaceUser';
import { validDraftId } from '../drafts/draftCore';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';

type Scope = Extract<WorkspaceScope,{kind:'account'}>;
type Label = {id:string;username:string;displayName:string|null;isCharacter:boolean};
type Roster = {principal:Label;activeCharacterId:string|null;characters:{user:Label;loginMode:'switch'|'inherit'|'password';disabled:boolean}[];nextCursor:null};
const invalid = () => new WorkspaceError('CHARACTER_ROSTER_INVALID','Character choices could not be verified. Reconnect and retry.',502);
const label = (value:any):Label => {
 if(!value || !validDraftId(value.id) || typeof value.username!=='string' || (value.displayName!==null && typeof value.displayName!=='string'))throw invalid();
 return {id:value.id,username:value.username,displayName:value.displayName,isCharacter:value.isCharacter===true};
};
function project(input:any,scope:Scope):Roster {
 if(scope.delegatedBy!==undefined || !input || !Array.isArray(input.characters) || input.nextCursor!==null || (input.activeCharacterId!==null && !validDraftId(input.activeCharacterId)))throw invalid();
 const principal=label(input.principal), characters=input.characters.map((row:any)=>{
  if(!row || !['switch','inherit','password'].includes(row.loginMode) || typeof row.disabled!=='boolean')throw invalid();
  return {user:label(row.user),loginMode:row.loginMode as 'switch'|'inherit'|'password',disabled:row.disabled};
 });
 const ids=[principal.id,...characters.map(row=>row.user.id)];
 if(new Set(ids).size!==ids.length || !ids.includes(scope.ownerId) || (input.activeCharacterId && !ids.includes(input.activeCharacterId)))throw invalid();
 return {principal,characters,activeCharacterId:input.activeCharacterId,nextCursor:null};
}
/** Private labels only, under the current root workspace. No sessions, profile
 * details, upload grants, admin privileges or remote management authority. */
export const retainCharacterRoster = (db:WorkspaceDatabase,scope:Scope,lease:WorkspaceLease,input:CharacterRoster) => {
 const value=project(input,scope);
 return db.transaction(scope,'readwrite',lease,tx=>tx.put('character-roster','choices',value));
};
export const readCharacterRoster = (db:WorkspaceDatabase,scope:Scope,lease:WorkspaceLease):Promise<CharacterRoster|null> => db.transaction(scope,'readonly',lease,async tx=>{
 const saved=await tx.get<Roster>('character-roster','choices');if(!saved)return null;
 const row=project(saved,scope);
 return {...row,canManage:false,principal:offlineWorkspaceUser(row.principal),characters:row.characters.map(character=>({...character,user:offlineWorkspaceUser(character.user)}))};
});
