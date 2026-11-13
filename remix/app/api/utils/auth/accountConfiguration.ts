import { createHash, randomUUID } from 'node:crypto';
import { Binary } from 'mongodb';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { encryptOwnerValue, decryptOwnerValue, ownerVaultConfigured } from './vaultCipher';
import type { SavedMongoEndpoint, SavedDeploymentLink } from './users';

export const ACCOUNT_CONFIG_KIND = 'account-config-entry';
export const ACCOUNT_CONFIG_MARKER = 'accountConfigurationRelationalV1';
const namespace = 'thingtime-account-configuration:v1:';
type Family = 'mongo-endpoint' | 'deployment-link' | 'deployment-path-rule';
export type AccountConfigurations = { mongoEndpoints: SavedMongoEndpoint[]; deploymentLinks: SavedDeploymentLink[] };
export const emptyAccountConfigurations = (): AccountConfigurations => ({ mongoEndpoints: [], deploymentLinks: [] });
export const accountConfigurationVaultReady = ownerVaultConfigured;
export const accountConfigurationId = (ownerId: string, family: Family, id: string) =>
  'account-config:' + createHash('sha256').update(JSON.stringify([ownerId, family, id])).digest('hex');
const decode = (ownerId: string, row: any) => {
  try {
    const envelope = JSON.parse(Buffer.from(row.secure.buffer).toString('utf8'));
    return JSON.parse(decryptOwnerValue(namespace, ownerId, row.shareId, envelope));
  } catch { throw new Error('Saved account configuration cannot be unlocked.'); }
};
const encode = (ownerId: string, id: string, value: unknown) => new Binary(Buffer.from(JSON.stringify(
  encryptOwnerValue(namespace, ownerId, id, JSON.stringify(value))
), 'utf8'));

/** This repository is server-only, owner-selected and home-pinned by users.ts.
 * Call writes inside the same transaction as the owner's secure-version CAS.
 * Root records never accumulate configuration values or path-rule arrays. */
export function accountConfigurationRepository(things: any, ownerId: string, session: any) {
  const rootFilter = { thingtime: ACCOUNT_CONFIG_KIND, ownerId };
  const rows = async (family: Family) => {
    const values = [];
    const cursor = things.find({ ...rootFilter, 'crystal.family': family }, { session });
    for await (const row of cursor) values.push(row);
    values.sort((a, b) => a.crystal.position - b.crystal.position || a.shareId.localeCompare(b.shareId));
    return values;
  };
  const read = async (): Promise<AccountConfigurations> => {
    const endpoints = await rows('mongo-endpoint');
    const links = await rows('deployment-link');
    const rules = await rows('deployment-path-rule');
    const rulesByParent = new Map<string, any[]>();
    for (const row of rules) {
      const value = decode(ownerId, row);
      const list = rulesByParent.get(row.parentId) || [];
      list.push(value); rulesByParent.set(row.parentId, list);
    }
    return {
      mongoEndpoints: endpoints.map(row => decode(ownerId, row)),
      deploymentLinks: links.map(row => ({ ...decode(ownerId, row), pathRules: rulesByParent.get(row.shareId) || [] }))
    };
  };
  const writeRow = async (family: Family, entryId: string, position: number, value: unknown, parentId = ownerId) => {
    const shareId = accountConfigurationId(ownerId, family, entryId), now = new Date();
    await things.updateOne({ ...rootFilter, shareId }, {
      $set: { secure: encode(ownerId, shareId, value), updatedAt: now, 'crystal.position': position, 'crystal.revision': randomUUID() },
      $setOnInsert: { schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, shareId, thingtime: [ACCOUNT_CONFIG_KIND], ownerId,
        parentId, acl: ['tt:user'], storageClass: 'control', createdAt: now, 'crystal.family': family }
    }, { session, upsert: true });
  };
  const readEndpoint = async (id: string): Promise<SavedMongoEndpoint | null> => {
    const row = await things.findOne({ ...rootFilter, shareId: accountConfigurationId(ownerId, 'mongo-endpoint', id), 'crystal.family': 'mongo-endpoint' }, { session });
    return row ? decode(ownerId, row) : null;
  };
  const readLink = async (id: string): Promise<SavedDeploymentLink | null> => {
    const shareId = accountConfigurationId(ownerId, 'deployment-link', id);
    const row = await things.findOne({ ...rootFilter, shareId, 'crystal.family': 'deployment-link' }, { session });
    if (!row) return null;
    const children = [];
    const cursor = things.find({ ...rootFilter, parentId: shareId, 'crystal.family': 'deployment-path-rule' }, { session });
    for await (const child of cursor) children.push(child);
    children.sort((a,b) => a.crystal.position - b.crystal.position);
    return { ...decode(ownerId, row), pathRules: children.map(child => decode(ownerId, child)) };
  };
  const removeRow = (family: Family, id: string) => things.deleteOne({ ...rootFilter, shareId: accountConfigurationId(ownerId, family, id) }, { session });
  const write = async (before: AccountConfigurations, after: AccountConfigurations) => {
    for (const list of [after.mongoEndpoints, after.deploymentLinks]) {
      if (new Set(list.map(entry => entry.id)).size !== list.length) throw new Error('Saved account configuration has duplicate record identities.');
    }
    const endpoints = new Map(before.mongoEndpoints.map((entry, i) => [entry.id, { entry, i }]));
    for (const [i, entry] of after.mongoEndpoints.entries()) {
      const previous = endpoints.get(entry.id); endpoints.delete(entry.id);
      if (!previous || previous.i !== i || JSON.stringify(previous.entry) !== JSON.stringify(entry)) await writeRow('mongo-endpoint', entry.id, i, entry);
    }
    for (const id of endpoints.keys()) await removeRow('mongo-endpoint', id);
    const links = new Map(before.deploymentLinks.map((entry, i) => [entry.id, { entry, i }]));
    for (const [i, entry] of after.deploymentLinks.entries()) {
      const previous = links.get(entry.id); links.delete(entry.id);
      const { pathRules, ...value } = entry;
      const priorValue = previous ? (({ pathRules: _, ...rest }) => rest)(previous.entry) : undefined;
      if (!previous || previous.i !== i || JSON.stringify(priorValue) !== JSON.stringify(value)) await writeRow('deployment-link', entry.id, i, value);
      if (!previous || JSON.stringify(previous.entry.pathRules) !== JSON.stringify(pathRules)) {
        const parentId = accountConfigurationId(ownerId, 'deployment-link', entry.id);
        await things.deleteMany({ ...rootFilter, parentId, 'crystal.family': 'deployment-path-rule' }, { session });
        for (const [position, rule] of pathRules.entries()) await writeRow('deployment-path-rule', JSON.stringify([entry.id, position]), position, rule, parentId);
      }
    }
    for (const id of links.keys()) {
      await things.deleteMany({ ...rootFilter, parentId: accountConfigurationId(ownerId, 'deployment-link', id), 'crystal.family': 'deployment-path-rule' }, { session });
      await removeRow('deployment-link', id);
    }
  };
  return { read, write, readEndpoint, readLink };
}
