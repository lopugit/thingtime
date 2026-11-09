import { Binary, ObjectId } from 'mongodb';
import { createHash, randomBytes } from 'node:crypto';
import { createCookie } from '~/api/cookies';
import { getHomeThingsCollection, getAuthOtpsCollection, getSessionsCollection, getUsersCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { insertAccountedThing, updateAccountedThing, HOME_ACCOUNTED_STORAGE_OPTIONS } from '../storage/accountedThings';
import { findUserById, getUserPasswordVerification, setUserPasswordVerification } from '../auth/users';
import { verifyJwt } from '../auth/jwt';
import { getLiveSession } from '../auth/sessions';
import { readPassword, savePassword, PasswordManagerError } from './passwords';
import { isPasswordFillEntry, passwordCanAutofillAtOrigin, passwordFieldValue } from '~/passwords/model';
import { verificationContext, verificationWindow, rememberedVerificationValid, type VerificationWindow, type EntryVerificationWindow, type VerificationContext, type RememberedVerification } from '~/passwords/verificationPolicy';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

const KIND = 'password-verification-device';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
// Browser storage can be cleared/evicted. Server Never records deliberately have
// no expiry. Renew on use within browsers' maximum persistent-cookie lifetime.
const deviceCookie = (ownerId:string,origin:string) => createCookie('tt_password_device_' + hash([ownerId,origin]).slice(0,16), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 34_560_000 });
const deviceProof = async (request: Request, ownerId:string,origin:string) => {
  const proof = await deviceCookie(ownerId,origin).parse(request.headers.get('Cookie'));
  return typeof proof === 'string' && /^[A-Za-z0-9_-]{43}$/.test(proof) ? proof : null;
};
type Identity = { ownerId: string; origin: string; token: string; session: string; passwordVersion: string; jti: string };
type Trust = RememberedVerification & { scope:string;policyRevision?:string };
const policyVersion=(settings:{revision:string|null;epoch?:string|null})=>hash([settings.revision,settings.epoch??null]);
const trustID = (identity: Identity, proof: string, scope: string) => 'pwd-device-' + hash([identity.ownerId, identity.origin, hash(proof), scope]);
const defaultStore = {
  async read(id: string, ownerId: string): Promise<Trust | null> {
    const row = await (await getHomeThingsCollection()).findOne({ shareId: id, ownerId, thingtime: KIND });
    if (!row?.secure || row.revokedAt) return null;
    return JSON.parse(Buffer.from((row.secure as Binary).buffer).toString('utf8'));
  },
  async write(id: string, identity: Identity, proof: string, value: Trust) {
    const things = await getHomeThingsCollection();
    await withHomeMongoTransaction(async session => {
      const filter = { shareId: id, ownerId: identity.ownerId, thingtime: KIND };
      const previous = await things.findOne(filter, { session });
      if (value.scope !== 'device') {
        const anchor = await things.findOne({shareId:trustID(identity,proof,'device'),ownerId:identity.ownerId,thingtime:KIND},{session});
        if (!anchor || anchor.revokedAt) throw new PasswordManagerError(409,'This device was forgotten. Start again.');
        // Write the anchor too: a snapshot read alone cannot serialize a new
        // scope enrollment against a concurrent device-wide Forget.
        await updateAccountedThing(things,{shareId:anchor.shareId,ownerId:identity.ownerId,thingtime:KIND,revokedAt:{$exists:false}},{$inc:{passwordVerificationGeneration:1},$set:{updatedAt:new Date()}},{session,...HOME_ACCOUNTED_STORAGE_OPTIONS});
      }
      // A concurrent Forget must win over a verification started before it.
      if (previous?.revokedAt) throw new PasswordManagerError(409, 'This device was forgotten. Start a new approval.');
      const secure = new Binary(Buffer.from(JSON.stringify(value)));
      if (previous) await updateAccountedThing(things, filter, { $set: { secure, updatedAt: new Date() } }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
      else await insertAccountedThing(things, { ...filter, thingtime: [KIND], parentId: identity.ownerId, targetId: hash([identity.origin, hash(proof)]), secure,
        passwordVerificationGeneration:0, crystal: {}, acl: [ACL_OWNER], schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, createdAt: new Date(), updatedAt: new Date() }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS });
    });
  },
  async forget(identity: Identity, proof: string) {
    const things = await getHomeThingsCollection();
    // Accounted, bounded rows: one independent trust record per enrolled scope.
    const cursor = things.find({ ownerId: identity.ownerId, thingtime: KIND, targetId: hash([identity.origin, hash(proof)]) });
    for await (const row of cursor) await withHomeMongoTransaction(session => updateAccountedThing(things,
      { shareId: row.shareId, ownerId: identity.ownerId, thingtime: KIND }, { $set: { revokedAt: new Date(), updatedAt: new Date() }, $unset: { secure: '' } }, { session, ...HOME_ACCOUNTED_STORAGE_OPTIONS }));
  },
  async ceremony(id: string) { return (await getAuthOtpsCollection()).findOne({ challenge: id, type: 'password-verification' }); },
  async authorize(id: string, value: any) { await (await getAuthOtpsCollection()).updateOne({ challenge: id, type: 'password-verification' }, { $set: value }, { upsert: true }); },
  async lock(identity: Identity) { await (await getAuthOtpsCollection()).deleteMany({ type: 'password-verification', userId: identity.ownerId, verificationSession: identity.session }); },
};
export function createPasswordVerificationService(deps = { store: defaultStore, readPassword, savePassword, findUserById, getUserPasswordVerification, setUserPasswordVerification, now: Date.now }) {
  async function identity(ownerId: string, origin: string, token: string): Promise<Identity> {
    const claims = await verifyJwt(token), session = claims && await getLiveSession(claims.jti);
    const user = await deps.findUserById(ownerId);
    if (!claims || claims.sub !== ownerId || !session || session.userId !== ownerId || (session.purpose !== undefined && session.purpose !== 'browser') || !user?.passwordHash)
      throw new PasswordManagerError(401, 'Use your current signed-in Thingtime browser session.');
    return { ownerId, origin, token, jti: claims.jti, session: hash([claims.jti, session.meta?.passwordVerificationLock || '']), passwordVersion: hash(['password-verification-version-v1', user.passwordHash]) };
  }
  async function policy(who: Identity, context: VerificationContext) {
    if (context.purpose === 'account-create' && context.rp !== new URL(who.origin).hostname) throw new PasswordManagerError(403, 'Use this Thingtime origin to add an account passkey.');
    const settings = await deps.getUserPasswordVerification(who.ownerId);
    let entryWindow:EntryVerificationWindow = 'global';
    let changedAt = settings.changedAt ?? 0;
    let window = settings.reuseRecentDeviceVerification === false ? 'always' as const : settings.window, scope = 'global';
    if (context.purpose !== 'create' && context.purpose !== 'account-create') {
      const saved = await deps.readPassword(who.ownerId, context.entryId);
      if (context.purpose === 'get' && (saved.entry.passwordType !== 'passkey' || passwordFieldValue(saved.entry, 'relyingParty') !== context.rp))
        throw new PasswordManagerError(403, 'Choose a saved passkey for this website.');
      if (context.purpose === 'fill' && !isPasswordFillEntry(saved.entry)) throw new PasswordManagerError(403, 'Choose a saved login with a password.');
      if (context.purpose === 'fill' && !passwordCanAutofillAtOrigin(saved.entry, context.origin))
        throw new PasswordManagerError(403, 'Choose a saved login for this exact website origin.');
      entryWindow = saved.entry.verificationWindow ?? 'global';
      changedAt = Math.max(changedAt, saved.verificationChangedAt ?? 0);
      if (settings.reuseRecentDeviceVerification !== false && saved.entry.verificationWindow && saved.entry.verificationWindow !== 'global') { window = saved.entry.verificationWindow; scope = `entry:${context.entryId}`; }
    }
    return { settings, window, scope, changedAt, entryWindow };
  }
  const ceremonyID = (who: Identity, requestId: string, context: VerificationContext) => hash(['password-ceremony-v1', who.ownerId, who.origin, who.session, requestId, context]);
  async function check(request: Request, who: Identity, context: VerificationContext, requestId?: string, issuedProof?: string | null) {
    const current = await identity(who.ownerId, who.origin, who.token);
    if (current.passwordVersion !== who.passwordVersion || current.session !== who.session) throw new PasswordManagerError(401, 'Your account password changed. Start again.');
    const selected = await policy(who, context), proof = issuedProof ?? await deviceProof(request, who.ownerId,who.origin);
    const anchor = proof ? await deps.store.read(trustID(who, proof, 'device'), who.ownerId) : null;
    const trust = proof && anchor ? await deps.store.read(trustID(who, proof, selected.scope), who.ownerId) : null;
    const ceremony = requestId ? await deps.store.ceremony(ceremonyID(who, requestId, context)) : null;
    const latestPolicy = await policy(who,context);
    const latestIdentity = await identity(who.ownerId,who.origin,who.token);
    if (latestIdentity.passwordVersion !== who.passwordVersion || latestIdentity.session !== who.session) throw new PasswordManagerError(401,'Your account or current approval changed. Start again.');
    if (latestPolicy.window !== selected.window || latestPolicy.scope !== selected.scope || latestPolicy.changedAt !== selected.changedAt || latestPolicy.settings.reuseRecentDeviceVerification !== selected.settings.reuseRecentDeviceVerification || policyVersion(latestPolicy.settings)!==policyVersion(selected.settings)) throw new PasswordManagerError(409,'Password confirmation settings changed. Start again.');
    const latestAnchor = proof ? await deps.store.read(trustID(who,proof,'device'),who.ownerId) : null;
    const deviceStillTrusted = !proof || !!latestAnchor;
    const now=deps.now();
    const valid=!!trust&&trust.verifiedAt>=selected.changedAt&&trust.policyRevision===policyVersion(selected.settings)&&rememberedVerificationValid(trust,selected.window,who.session,who.passwordVersion,now);
    const approved=!!ceremony&&ceremony.expiresAt.getTime()>now&&ceremony.passwordVersion===who.passwordVersion&&
      (!ceremony.deviceHash||(proof&&ceremony.deviceHash===hash(proof)&&latestAnchor))&&ceremony.policyRevision===policyVersion(selected.settings)&&ceremony.policy===selected.window&&ceremony.approvedAt>=selected.changedAt&&(ceremony.fresh===true||valid);
    return {...selected,proof,valid:!!valid&&deviceStillTrusted,approved:!!approved&&deviceStillTrusted};
  }
  return {
    identity,
    async settingsForOwner(ownerId:string) {return deps.getUserPasswordVerification(ownerId);},
    async settings(who: Identity) { return deps.getUserPasswordVerification(who.ownerId); },
    async setSettings(who: Identity, value: unknown, revision: string | null, reuse?:unknown) {
      const current=await deps.getUserPasswordVerification(who.ownerId);
      if(reuse!==undefined&&typeof reuse!=='boolean')throw new PasswordManagerError(400,'Choose whether to reuse device verification.');
      return deps.setUserPasswordVerification(who.ownerId, value===undefined?current.window:verificationWindow(value), revision, reuse===undefined?current.reuseRecentDeviceVerification:reuse as boolean);
    },
    async setEntry(who: Identity, id: string, value: unknown) {
      const window = value === 'global' ? 'global' : verificationWindow(value);
      const saved = await deps.readPassword(who.ownerId, id);
      await deps.savePassword(who.ownerId, { id, writeId: crypto.randomUUID(), revision: saved.revision, entry: { ...saved.entry, verificationWindow: window } });
    },
    async status(request: Request, who: Identity, input: unknown) {
      const context = verificationContext(input), state = await check(request, who, context);
      // A status response never creates authority or exposes the device proof.
      return { settings: state.settings, window: state.window, entryWindow:state.entryWindow, required: !state.valid };
    },
    async verify(request: Request, who: Identity, input: unknown, requestId: string, fresh: boolean) {
      const context = verificationContext(input), state = await check(request, who, context, requestId);
      if (!fresh && !state.valid && !state.approved) throw new PasswordManagerError(403, 'Verify your Thingtime account password for this request.');
      let proof = state.proof;
      if (proof && !await deps.store.read(trustID(who, proof, 'device'), who.ownerId)) throw new PasswordManagerError(409, 'This device was forgotten. Reload to approve again.');
      if (fresh && state.window !== 'always') {
        if (!proof) {
          proof = randomBytes(32).toString('base64url');
          await deps.store.write(trustID(who, proof, 'device'), who, proof, { scope: 'device', verifiedAt: deps.now(), duration: 'never', session: who.session, passwordVersion: who.passwordVersion });
        }
        await deps.store.write(trustID(who, proof, state.scope), who, proof, { scope: state.scope, verifiedAt: deps.now(), duration: state.window, session: who.session, passwordVersion: who.passwordVersion, policyRevision:policyVersion(state.settings) });
      }
      await deps.store.authorize(ceremonyID(who, requestId, context), { type: 'password-verification', userId: who.ownerId, verificationSession: who.session,
        expiresAt: new Date(deps.now() + 600_000), passwordVersion: who.passwordVersion, policyRevision:policyVersion(state.settings), deviceHash:proof ? hash(proof) : null, policy: state.window, approvedAt: deps.now(), fresh });
      const final = await check(request, who, context, requestId, proof);
      if (!final.approved) throw new PasswordManagerError(403, 'Your approval ended. Start again.'); // Revocation/account changes after writes cannot release success.
      return proof ? deviceCookie(who.ownerId,who.origin).serialize(proof) : null;
    },
    async commitAccountRegistration<T>(request:Request,who:Identity,input:unknown,requestId:string,write:(session:any)=>Promise<T>):Promise<T> {
      const context=verificationContext(input);
      if(context.purpose!=='account-create')throw new PasswordManagerError(403,'Use account passkey setup.');
      return withHomeMongoTransaction(async session=>{
        const sessions=await getSessionsCollection(), current=await sessions.findOne({jti:who.jti},{session});
        if(!current||current.revokedAt||current.userId!==who.ownerId||(current.expiresAt&&new Date(current.expiresAt).getTime()<=deps.now())||hash([who.jti,current.meta?.passwordVerificationLock||''])!==who.session)throw new PasswordManagerError(401,'Your current approval ended.');
        // These writes serialize the final insert against session revoke/Lock,
        // preference/password changes and device Forget. A snapshot read alone
        // would allow a concurrent revocation to commit on a different row.
        await sessions.updateOne({jti:who.jti},{$inc:{'meta.passwordVerificationCommitFence':1}},{session});
        const things=await getHomeThingsCollection();
        const user=await things.findOne({shareId:who.ownerId,thingtime:'user'},{session,projection:{shareId:1}});
        if(user)await updateAccountedThing(things,{shareId:who.ownerId,thingtime:'user'},{$inc:{passwordVerificationFence:1}},{session,...HOME_ACCOUNTED_STORAGE_OPTIONS});
        else if(ObjectId.isValid(who.ownerId))await (await getUsersCollection()).updateOne({_id:new ObjectId(who.ownerId)},{$inc:{passwordVerificationFence:1}},{session});
        else throw new PasswordManagerError(401,'Your account changed.');
        const proof=await deviceProof(request,who.ownerId,who.origin);
        if(proof){const updated=await updateAccountedThing(things,{shareId:trustID(who,proof,'device'),ownerId:who.ownerId,thingtime:KIND,revokedAt:{$exists:false}},{$inc:{passwordVerificationGeneration:1}},{session,...HOME_ACCOUNTED_STORAGE_OPTIONS});if(updated.matchedCount!==1)throw new PasswordManagerError(403,'This device was forgotten.');}
        const latest=await check(request,who,context,requestId);
        if(!latest.approved)throw new PasswordManagerError(403,'Your password confirmation ended.');
        return write(session);
      });
    },
    async require(request: Request, who: Identity, input: unknown, requestId: string) {
      const context = verificationContext(input), state = await check(request, who, context, requestId);
      if (!state.approved) throw new PasswordManagerError(403, 'Your password confirmation ended. Verify again.');
    },
    async lock(who: Identity) { await (await getSessionsCollection()).updateOne({jti: who.jti, revokedAt: null}, {$set: {'meta.passwordVerificationLock': crypto.randomUUID()}}); await deps.store.lock(who); },
    async forget(request: Request, who: Identity) { await (await getSessionsCollection()).updateOne({jti:who.jti,revokedAt:null},{$set:{'meta.passwordVerificationLock':crypto.randomUUID()}}); const proof = await deviceProof(request, who.ownerId,who.origin); if (proof) await deps.store.forget(who, proof); await deps.store.lock(who); return deviceCookie(who.ownerId,who.origin).serialize('', { maxAge: 0 }); },
  };
}
export const passwordVerification = createPasswordVerificationService();
