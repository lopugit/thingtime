// Virtual bounding boxes for atomic things.
//
// Every atomic thing exposes three zones, each with its own box:
//   'key'    the property name area
//   'value'  the property value area
//   'thing'  the whole atomic thing (key + value union)
//
// Zones are marked in the DOM with data-tt-zone attributes (Thingtime.tsx
// stamps 'key' on the path row and 'value' on the atomic value box) so any
// pointer interaction — right-click today, drag/drop tomorrow — can resolve
// which part of a thing it hit and measure its box.
//
// Documented at /docs/design-system?component=thing-context-menu (Zones).

export type ThingZone = 'key' | 'value' | 'thing';

export const THING_ZONE_ATTR = 'data-tt-zone';

// Resolve which zone an event target falls in, scoped to one thing's element
// (nested things own their zones — their handlers stop propagation first, so
// a boundary only ever sees its own subtree).
export const resolveThingZone = (target: Element | null | undefined, boundary: Element | null | undefined): ThingZone => {
	if (!target || !boundary) {
		return 'thing';
	}

	const zoneEl = (target as HTMLElement).closest?.(`[${THING_ZONE_ATTR}]`);

	if (!zoneEl || !boundary.contains(zoneEl)) {
		return 'thing';
	}

	const zone = zoneEl.getAttribute(THING_ZONE_ATTR);

	return zone === 'key' || zone === 'value' ? zone : 'thing';
};

export type ThingZoneBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type ThingZoneBoxes = {
	key?: ThingZoneBox;
	value?: ThingZoneBox;
	// union of the atomic zones — the thing's virtual bounding box
	thing: ThingZoneBox;
};

const toBox = (rect: DOMRect): ThingZoneBox => ({
	x: rect.x,
	y: rect.y,
	width: rect.width,
	height: rect.height
});

const unionBoxes = (a: ThingZoneBox, b: ThingZoneBox): ThingZoneBox => {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);

	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y
	};
};

// Measure a thing's zone boxes in viewport coordinates. Only the element's
// own zones count — zones inside nested .thing descendants are ignored, so
// the 'thing' box is the atomic (key + value) area, not the whole subtree.
export const getThingZoneBoxes = (thingEl: HTMLElement | null | undefined): ThingZoneBoxes | null => {
	if (!thingEl) {
		return null;
	}

	const zoneEls = Array.from(thingEl.querySelectorAll(`[${THING_ZONE_ATTR}]`)).filter((el) => {
		// the first .thing ancestor of an owned zone is thingEl itself; for
		// non-.thing roots (docs fixtures) accept zones that no nested .thing
		// claims
		const nearestThing = el.closest('.thing');

		if (thingEl.classList.contains('thing')) {
			return nearestThing === thingEl;
		}

		return !nearestThing || !thingEl.contains(nearestThing);
	});

	let key: ThingZoneBox | undefined;
	let value: ThingZoneBox | undefined;

	zoneEls.forEach((el) => {
		const zone = el.getAttribute(THING_ZONE_ATTR);
		const box = toBox(el.getBoundingClientRect());

		if (zone === 'key' && !key) {
			key = box;
		} else if (zone === 'value' && !value) {
			value = box;
		}
	});

	const atomicBoxes = [key, value].filter(Boolean) as ThingZoneBox[];
	const thing = atomicBoxes.length
		? atomicBoxes.reduce(unionBoxes)
		: toBox(thingEl.getBoundingClientRect());

	return { key, value, thing };
};
