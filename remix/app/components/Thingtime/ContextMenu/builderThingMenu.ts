import { thingBuilderHref, thingLiveHref, type ThingsThing } from '../../Things/thingsCore';
import type { ThingContextSection } from './contextMenuModel';

type BuilderMenuThing = Pick<ThingsThing, 'id' | 'thingtime'> & Partial<Pick<ThingsThing, 'crystal'>> & { author?: { id: string } | null };

// Shared by library rows, post attachments and embedded saved Things. These
// links are navigation hints; each destination rechecks read/edit authority.
export function builderThingMenuSections(thing: BuilderMenuThing | undefined, viewerId?: string | null, count = 1): ThingContextSection[] {
  if (!thing || count !== 1) return [];
  const builder = thingBuilderHref(thing, viewerId);
  const live = thingLiveHref(thing);
  const actions = [
    ...(builder ? [{ id: 'open-builder', command: 'open-builder', label: 'Open in Builder', icon: '🧱', lucide: 'blocks', href: builder }] : []),
    ...(live ? [{ id: 'open-live', command: 'open-live', label: 'Open live page', icon: '🌐', lucide: 'external-link', href: live }] : [])
  ];
  return actions.length ? [{ id: 'builder-navigation', actions }] : [];
}
