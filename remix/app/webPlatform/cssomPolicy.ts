import type { Policy, Arg } from './domBridge';
export type CSSOMArg = 'cssom-text' | 'cssom-rule' | 'cssom-options' | 'cssom-sheets' | 'cssom-shadow' | 'cssom-element' | 'cssom-pseudo';
const call = (args: Arg[] = [], extra: { min?: number; mutates?: boolean; awaitResult?: boolean } = {}) => ({ args, ...extra });
export const CSSOM_PROPERTIES =
	'cssFloat bleed margin marginTop marginRight marginBottom marginLeft margin-top margin-right margin-bottom margin-left marks pageOrientation page-orientation size'.split(
		' '
	);
export const CSSOM_CONSTRUCTORS = { CSSStyleSheet: call(['cssom-options'], { min: 0 }) };
export const CSSOM_STATIC = {
	CSS: { escape: call(['cssom-text']) },
	Window: { getComputedStyle: call(['cssom-element', 'cssom-pseudo'], { min: 1 }) }
};
export const CSSOM_RECEIVER_POLICY: Record<string, Policy> = {
	CSSImportRule: { reads: 'href layerName supportsText media styleSheet' },
	CSSNamespaceRule: { reads: 'namespaceURI prefix' },
	CSSMarginRule: { reads: 'name style' },
	CSSPageRule: { reads: 'selectorText style', writes: 'selectorText', writeArgs: { selectorText: 'cssom-text' } },
	CSSStyleRule: { reads: 'selectorText style cssText styleMap', writes: 'selectorText', writeArgs: { selectorText: 'cssom-text' } },
	CSSGroupingRule: {
		reads: 'cssRules',
		calls: { insertRule: call(['cssom-rule', 'number'], { min: 1, mutates: true }), deleteRule: call(['number'], { mutates: true }) }
	},
	CSSRule: {
		reads:
			'cssText parentRule parentStyleSheet type STYLE_RULE CHARSET_RULE IMPORT_RULE MEDIA_RULE FONT_FACE_RULE PAGE_RULE MARGIN_RULE NAMESPACE_RULE',
		writes: 'cssText',
		writeArgs: { cssText: 'cssom-rule' }
	},
	CSSStyleSheet: {
		reads: 'cssRules ownerRule rules',
		calls: {
			insertRule: call(['cssom-rule', 'number'], { min: 1, mutates: true }),
			deleteRule: call(['number'], { mutates: true }),
			replaceSync: call(['cssom-rule'], { mutates: true }),
			replace: call(['cssom-rule'], { mutates: true, awaitResult: true }),
			addRule: call(['cssom-text', 'cssom-text', 'number'], { min: 0, mutates: true }),
			removeRule: call(['number'], { min: 0, mutates: true })
		}
	},
	StyleSheet: { reads: 'type href ownerNode parentStyleSheet title media disabled', writes: 'disabled', writeArgs: { disabled: 'boolean' } },
	CSSRuleList: { reads: 'length', calls: { item: call(['number']) } },
	StyleSheetList: { reads: 'length', calls: { item: call(['number']) } },
	MediaList: {
		reads: 'length mediaText',
		writes: 'mediaText',
		writeArgs: { mediaText: 'cssom-text' },
		calls: { item: call(['number']), appendMedium: call(['cssom-text'], { mutates: true }), deleteMedium: call(['cssom-text'], { mutates: true }) }
	},
	CSSStyleDeclaration: {
		reads: 'cssText length parentRule ' + CSSOM_PROPERTIES.join(' '),
		writes: 'cssText ' + CSSOM_PROPERTIES.join(' '),
		writeArgs: Object.fromEntries(['cssText', ...CSSOM_PROPERTIES].map((k) => [k, 'cssom-text' as Arg])),
		calls: {
			item: call(['number']),
			getPropertyValue: call(['cssom-text']),
			getPropertyPriority: call(['cssom-text']),
			setProperty: call(['cssom-text', 'cssom-text', 'cssom-text'], { min: 2, mutates: true }),
			removeProperty: call(['cssom-text'], { mutates: true })
		}
	},
	HTMLStyleElement: {
		reads: 'sheet media type disabled',
		writes: 'media type disabled',
		writeArgs: { media: 'cssom-text', type: 'cssom-text', disabled: 'boolean' }
	},
	ShadowRoot: { reads: 'host styleSheets adoptedStyleSheets', writes: 'adoptedStyleSheets', writeArgs: { adoptedStyleSheets: 'cssom-sheets' } }
};
