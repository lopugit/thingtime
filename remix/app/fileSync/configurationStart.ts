import { parseFileSyncConfiguration, type FileSyncConfiguration } from './configuration';
import { readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from './configuredPlan';
import type { ConfigurationEditorScope } from './configurationEditor';
export type ExplicitSyncStartTransport = {
 assertCurrent(): void;
 hasDraft(id: string): boolean;
 get(id: string): Promise<unknown>;
 update(id: string, configuration: FileSyncConfiguration, expectedUpdatedAt: string): Promise<unknown>;
};
const equal = (a: FileSyncConfiguration, b: FileSyncConfiguration) => JSON.stringify(a) === JSON.stringify(b);
/** An explicit user Start only. Confirm the exact reviewed connection, CAS its
 * pause flag if necessary, and verify the successful response before admission.
 * An uncertain save never admits a transfer, even if it might have committed. */
export async function prepareExplicitSyncStart(requested: SavedFileSyncConfiguration, scope: ConfigurationEditorScope, api: ExplicitSyncStartTransport): Promise<SavedFileSyncConfiguration> {
 const check = () => {
  api.assertCurrent();
  if (requested.configuration.deviceId !== scope.deviceId || api.hasDraft(requested.id))
   throw Error('Save or discard this connection’s draft before starting. Other connections are unchanged.');
 };
 const read = (value: unknown) => {
  const saved = readOwnedFileSyncConfiguration(value, scope.ownerId);
  if (saved.id !== requested.id || saved.configuration.deviceId !== scope.deviceId) throw Error('The connection identity changed. Refresh saved settings before starting.');
  return saved;
 };
 check();
 const current = read(await api.get(requested.id)); check();
 if (current.updatedAt !== requested.updatedAt || !equal(current.configuration, requested.configuration))
  throw Error('This connection changed elsewhere. Refresh saved settings before starting. No transfer was started.');
 if (!current.configuration.paused) return current;
 const configuration = parseFileSyncConfiguration({ ...current.configuration, paused: false });
 let response: unknown;
 try { check(); response = await api.update(current.id, configuration, current.updatedAt); }
 catch (cause) {
  check();
  if ((cause as { status?: number })?.status === 409) throw Error('This connection changed elsewhere. Refresh saved settings before starting. No transfer was started.');
  throw Error('Resume could not be confirmed. Refresh saved settings before starting. No transfer was started.');
 }
 check();
 const committed = read(response);
 if (!equal(committed.configuration, configuration)) throw Error('The resume response did not confirm these settings. Refresh before starting.');
 const verified = read(await api.get(current.id)); check();
 if (verified.updatedAt !== committed.updatedAt || !equal(verified.configuration, configuration))
  throw Error('This connection changed after resuming. Refresh saved settings before starting. No transfer was started.');
 return verified;
}
