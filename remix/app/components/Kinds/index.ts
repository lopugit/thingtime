// One import gives you the registry API with every built-in renderer:
// import { RenderThing } from '~/components/Kinds';
//
// Built-ins self-register lazily inside kindRegistry on first access — do
// NOT move registration here as top-level statements or side-effect imports:
// remix/package.json sets "sideEffects": false, so the production bundler
// skips re-export glue and side-effect-only modules, shipping an empty
// registry (dev serves modules unbundled, which hides the difference).

export {
	RenderThing,
	getKindRenderer,
	getKindRenderers,
	isKindSafeForUntrusted,
	registerKindRenderer,
	resolveKindRender,
	resolveKindRenderer
} from './kindRegistry';
export type { KindRenderContext, KindRenderer, PollRenderPollContext, RenderThingProps } from './kindRegistry';
export { HtmlThingRenderer } from './HtmlThingRenderer';
export type { HtmlThingNode } from './HtmlThingRenderer';
export { ChakraThingRenderer, isChakraThingNode } from './ChakraThingRenderer';
export type { ChakraThingNode } from './ChakraThingRenderer';
export { RichTextBlocks } from './kindRenderersMedia';
export { sampleKindThings } from './sampleKindThings';
