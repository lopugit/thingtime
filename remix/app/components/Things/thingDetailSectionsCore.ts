// `/thing/:id` serves two different payloads: an ordinary Thing, which renders
// the `Views` card with the `Rendered preview` and `Thing data` switches, and a
// migration diagnostic, whose only content is the redacted error card and which
// renders no switches at all.
//
// React keeps the route component mounted across id changes, so switch state
// set on a Thing survives a client-side navigation to a diagnostic. Gating the
// diagnostic on `Thing data` therefore stranded it: the page went blank with no
// control left to turn it back on, and only a reload recovered it.
//
// The invariant this encodes is that a switch may gate a section only where
// that switch is on screen.
export type ThingDetailSectionInput = {
	hasThing: boolean;
	showPreview: boolean;
	showData: boolean;
};

export type ThingDetailSections = {
	// The `Views` switches describe a Thing's two representations; a diagnostic
	// has no preview to offer, so it never renders them.
	viewToggles: boolean;
	preview: boolean;
	// Named `detail` because it carries the Thing JSON *or* the redacted error.
	detail: boolean;
};

export const thingDetailSections = ({ hasThing, showPreview, showData }: ThingDetailSectionInput): ThingDetailSections => ({
	viewToggles: hasThing,
	preview: hasThing && showPreview,
	detail: !hasThing || showData
});
