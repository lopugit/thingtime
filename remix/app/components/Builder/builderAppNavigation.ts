import { isBuilderApp, thingLiveHref, type ThingsThing } from '../Things/thingsCore';

export const builderAppLaunchHref = (thing: ThingsThing): string | null =>
  isBuilderApp(thing) ? `/builder?app=${encodeURIComponent(thing.id)}` : null;

export function builderAppEntryPointId(app: ThingsThing): string | null {
  const value = app.crystal?.metadata?.entryPointThingId ?? app.crystal?.metadata?.entryPageId;
  if (value === undefined || value === null || value === '') return null;
  // A saved Thing identity, never a URL, route or executable expression.
  if (typeof value !== 'string' || value.trim() !== value || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('The app entry point must be a saved Thing ID.');
  return value;
}

export function builderAppEntryPointHref(app: ThingsThing, target: ThingsThing): string {
  if (target.id === app.id || target.thingtime.includes('folder'))
    throw new Error('Choose a page or another presentable Thing, rather than an app or folder.');
  const href = thingLiveHref(target);
  if (!href) throw new Error('This Thing has no live presentation. Choose a page or another presentable Thing.');
  return href;
}

/** Each read uses the caller's current API authority. App membership is never
 * borrowed to read its target, and navigation never runs an Action. */
export async function resolveBuilderAppEntryPoint(id: string, get: (id: string) => Promise<any>): Promise<string> {
  const response = await get(id);
  const app: ThingsThing | undefined = response?.thing;
  if (!response?.ok || !app || !isBuilderApp(app)) throw new Error('This app is unavailable.');
  const targetId = builderAppEntryPointId(app);
  if (!targetId) return `/builder?folder=${encodeURIComponent(app.id)}&kind=all`;
  const target = await get(targetId).catch(() => { throw new Error('The app entry point could not be read. Retry or browse the app.'); });
  if (!target?.ok || !target.thing) throw new Error('The app entry point is missing or unavailable to this account.');
  return builderAppEntryPointHref(app, target.thing);
}

/** The entry-point setting owns its key. Keep advanced metadata independent so
 * editing or clearing JSON cannot silently restore an older pointer. */
export function builderAppAdditionalMetadata(app?: ThingsThing | null): Record<string, unknown> {
  const metadata = { ...(app?.crystal?.metadata || {}) };
  delete metadata.entryPointThingId;
  delete metadata.entryPageId;
  return metadata;
}

export function builderAppMetadata(additional: Record<string, unknown>, entryPoint: string): Record<string, unknown> {
  if (Object.prototype.hasOwnProperty.call(additional, 'entryPointThingId') || Object.prototype.hasOwnProperty.call(additional, 'entryPageId'))
    throw new Error('Use the Entry point setting to change the app entry point.');
  return { ...additional, ...(entryPoint.trim() ? { entryPointThingId: entryPoint.trim() } : {}) };
}
