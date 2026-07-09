// One import gives you the registry API *and* registers every built-in
// renderer: import { RenderThing } from '~/components/Kinds';

import './kindRenderers';

export {
	RenderThing,
	getKindRenderer,
	getKindRenderers,
	registerKindRenderer,
	resolveKindRenderer
} from './kindRegistry';
export type { KindRenderContext, KindRenderer, RenderThingProps } from './kindRegistry';
export { HtmlThingRenderer } from './HtmlThingRenderer';
export type { HtmlThingNode } from './HtmlThingRenderer';
export { sampleKindThings } from './sampleKindThings';
