// Nested data viewer/editor concepts — alternative ways to walk, read, and
// edit a thing. Each viewer is a controlled component over a plain JSON thing:
//   <Viewer thing={json} onThingChange={next => …} edit variant="auto" />
// so any of them can be dropped into the editor, a feed card, or a route by
// wiring onThingChange to setThingtime.

export { MillerColumnsViewer } from './MillerColumnsViewer';
export { FocusCardsViewer } from './FocusCardsViewer';
export { OutlineDocViewer } from './OutlineDocViewer';
export { FormSheetViewer } from './FormSheetViewer';
export { OrbitCanvasViewer } from './OrbitCanvasViewer';

export { LeafValueEditor, KindFlip, ConceptCrumbs, AddChildButton, DeleteButton, useContainerWidth, useConceptLayout } from './conceptBits';
export type { ConceptViewerProps } from './conceptBits';

export * from './conceptData';
export { makeSampleWorld, makeSampleNote } from './sampleThings';
