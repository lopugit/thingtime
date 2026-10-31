import { openSyncJournal } from '../../../remix/app/fileSync/journal.client';
import { createSyncRun, executeSyncRun } from '../../../remix/app/fileSync/execute';
import { planFileSync, type SyncScope } from '../../../remix/app/fileSync/reconcile';
import { newFileSyncConfiguration } from '../../../remix/app/fileSync/configuration';
import { configurationDraftKey, persistConfigurationDraft, readConfigurationDraft, type ConfigurationDraft } from '../../../remix/app/fileSync/configurationEditor';

const scope: SyncScope = { origin: 'https://desktop-restart.invalid', ownerId: 'owner', dataPlane: 'home', rootId: 'connection', deviceId: 'mac' };
const editorScope = { origin: scope.origin, ownerId: scope.ownerId, dataPlane: scope.dataPlane, deviceId: scope.deviceId };
const key = configurationDraftKey(editorScope);
const entries = ['a', 'b'].map(path => ({ path, id: path, version: '1', kind: 'file' as const, size: 10, sha256: 'a'.repeat(64) }));
const baseline = { scope, entries: entries.map(entry => ({ path: entry.path, local: entry, remote: entry })) };
const make = () => {
    let id = 0;
    const run = createSyncRun(planFileSync({ scope, complete: true, entries }, { scope, complete: true, entries: [] }, { scope, entries: [] },
        { mode: 'two-way', propagateDeletes: false }), () => `restart-${++id}`);
    run.operations[0].confirmed = true;
    return run;
};
const draft: ConfigurationDraft = { version: 1, id: 'connection', baseUpdatedAt: null, pending: true, exclusions: '',
    configuration: newFileSyncConfiguration({ name: 'Restart documents', deviceId: 'mac', localRootId: 'local-root', remoteFolderId: 'cloud-root' }) };
const equal = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Error('Restart fixture state mismatch'); };

(window as any).verifyRestart = async (stage: string) => {
    const journal = await openSyncJournal();
    try {
        const run = make();
        if (stage === 'seed') {
            equal(await journal.read(scope), null);
            await journal.persist(run);
            persistConfigurationDraft(localStorage, key, null, draft);
        } else {
            equal(readConfigurationDraft(localStorage.getItem(key), 'mac'), draft);
            for (const field of ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId']) {
                equal(await journal.read({ ...scope, [field]: field === 'origin' ? 'https://other.invalid' : 'other' }), null);
            }
            equal(localStorage.getItem(configurationDraftKey({ ...editorScope, ownerId: 'other' })), null);
            equal(localStorage.getItem(configurationDraftKey({ ...editorScope, origin: 'https://other.invalid' })), null);
            if (stage === 'recover') {
                equal(await journal.read(scope), run);
                const lookups: string[] = [];
                // Synthetic accepted-operation receipt models a lost reply. The
                // real executor must skip confirmed work and must not reapply it.
                const completed = await executeSyncRun((await journal.read(scope))!, {
                    currentScope: () => scope, persist: journal.persist,
                    lookup: async operationId => { lookups.push(operationId); return { status: 'complete', receipt: { operationId, scope, entry: entries[1] } }; },
                    read: async () => { throw Error('Recovery unexpectedly read file bytes'); },
                    apply: async () => { throw Error('Recovery replayed a file operation'); }
                });
                equal(lookups, [run.operations[1].id]);
                equal(completed.operations.map(op => op.confirmed), [true, true]);
                await journal.complete({ version: 1, runId: run.id, localRootId: 'local-root', remoteFolderId: 'cloud-root', baseline });
            } else if (stage === 'verify') {
                const completed = await journal.read(scope);
                equal(completed?.operations.map(op => op.confirmed), [true, true]);
                equal(completed?.operations.map(op => op.id), run.operations.map(op => op.id));
                equal(await journal.checkpoint(scope), { version: 1, runId: run.id, localRootId: 'local-root', remoteFolderId: 'cloud-root', baseline });
            } else throw Error('Unknown restart fixture stage');
        }
        return { stage, origin: location.origin, runId: run.id, operationIds: run.operations.map(op => op.id), draftId: draft.id };
    } finally { journal.close(); }
};
