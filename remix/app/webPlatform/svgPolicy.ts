import { SVG_FILTER_RECEIVER_POLICY } from './svgFilterPolicy';
import type { Arg, Policy } from './domBridge';
const call = (args: Arg[] = [], min = args.length, mutates = false) => ({ args, min, mutates });
const write = (reads: string, writes = reads, writeArgs: Record<string, Arg> = {}): Policy => ({
	reads,
	writes,
	writeArgs: Object.fromEntries(
		writes
			.split(' ')
			.filter(Boolean)
			.map((k) => [k, writeArgs[k] || 'svg-number'])
	)
});
const lengthConstants =
	'SVG_LENGTHTYPE_UNKNOWN SVG_LENGTHTYPE_NUMBER SVG_LENGTHTYPE_PERCENTAGE SVG_LENGTHTYPE_EMS SVG_LENGTHTYPE_EXS SVG_LENGTHTYPE_PX SVG_LENGTHTYPE_CM SVG_LENGTHTYPE_MM SVG_LENGTHTYPE_IN SVG_LENGTHTYPE_PT SVG_LENGTHTYPE_PC';
const angleConstants = 'SVG_ANGLETYPE_UNKNOWN SVG_ANGLETYPE_UNSPECIFIED SVG_ANGLETYPE_DEG SVG_ANGLETYPE_RAD SVG_ANGLETYPE_GRAD';
const aspectConstants =
	'SVG_PRESERVEASPECTRATIO_UNKNOWN SVG_PRESERVEASPECTRATIO_NONE SVG_PRESERVEASPECTRATIO_XMINYMIN SVG_PRESERVEASPECTRATIO_XMIDYMIN SVG_PRESERVEASPECTRATIO_XMAXYMIN SVG_PRESERVEASPECTRATIO_XMINYMID SVG_PRESERVEASPECTRATIO_XMIDYMID SVG_PRESERVEASPECTRATIO_XMAXYMID SVG_PRESERVEASPECTRATIO_XMINYMAX SVG_PRESERVEASPECTRATIO_XMIDYMAX SVG_PRESERVEASPECTRATIO_XMAXYMAX SVG_MEETORSLICE_UNKNOWN SVG_MEETORSLICE_MEET SVG_MEETORSLICE_SLICE';
const unitConstants = 'SVG_UNIT_TYPE_UNKNOWN SVG_UNIT_TYPE_USERSPACEONUSE SVG_UNIT_TYPE_OBJECTBOUNDINGBOX';
const transformConstants =
	'SVG_TRANSFORM_UNKNOWN SVG_TRANSFORM_MATRIX SVG_TRANSFORM_TRANSLATE SVG_TRANSFORM_SCALE SVG_TRANSFORM_ROTATE SVG_TRANSFORM_SKEWX SVG_TRANSFORM_SKEWY';
const lists: Record<string, Arg> = {
	SVGLengthList: 'svg-length',
	SVGNumberList: 'svg-number-value',
	SVGPointList: 'svg-point-value',
	SVGTransformList: 'svg-transform',
	SVGStringList: 'svg-text'
};
export const SVG_RECEIVER_POLICY: Record<string, Policy> = {
	...SVG_FILTER_RECEIVER_POLICY,
	SVGUnitTypes: { reads: unitConstants },
	SVGSVGElement: {
		reads: 'x y width height currentScale currentTranslate viewBox preserveAspectRatio',
		writes: 'currentScale',
		writeArgs: { currentScale: 'svg-number' },
		calls: {
			createSVGNumber: call(),
			createSVGLength: call(),
			createSVGAngle: call(),
			createSVGPoint: call(),
			createSVGMatrix: call(),
			createSVGRect: call(),
			createSVGTransform: call(),
			createSVGTransformFromMatrix: call(['svg-matrix'], 0),
			getElementById: call(['text']),
			getIntersectionList: call(['svg-rect', 'svg-nullable-element']),
			getEnclosureList: call(['svg-rect', 'svg-nullable-element']),
			checkIntersection: call(['svg-element', 'svg-rect']),
			checkEnclosure: call(['svg-element', 'svg-rect'])
		}
	},
	SVGRectElement: { reads: 'x y width height rx ry' },
	SVGCircleElement: { reads: 'cx cy r' },
	SVGEllipseElement: { reads: 'cx cy rx ry' },
	SVGLineElement: { reads: 'x1 y1 x2 y2' },
	SVGPolylineElement: { reads: 'points animatedPoints' },
	SVGPolygonElement: { reads: 'points animatedPoints' },
	SVGPathElement: { reads: '' },
	SVGTextElement: { reads: '' },
	SVGTSpanElement: { reads: '' },
	SVGTextPositioningElement: { reads: 'x y dx dy rotate' },
	SVGTextContentElement: {
		reads: 'textLength lengthAdjust LENGTHADJUST_UNKNOWN LENGTHADJUST_SPACING LENGTHADJUST_SPACINGANDGLYPHS',
		calls: {
			getNumberOfChars: call(),
			getComputedTextLength: call(),
			getSubStringLength: call(['number', 'number']),
			getStartPositionOfChar: call(['number']),
			getEndPositionOfChar: call(['number']),
			getExtentOfChar: call(['number']),
			getRotationOfChar: call(['number']),
			getCharNumAtPosition: call(['svg-point'], 0)
		}
	},
	SVGLinearGradientElement: { reads: 'x1 y1 x2 y2' },
	SVGRadialGradientElement: { reads: 'cx cy r fx fy fr' },
	SVGStopElement: { reads: 'offset' },
	SVGGradientElement: {
		reads:
			'gradientUnits gradientTransform spreadMethod href SVG_SPREADMETHOD_UNKNOWN SVG_SPREADMETHOD_PAD SVG_SPREADMETHOD_REFLECT SVG_SPREADMETHOD_REPEAT ' +
			unitConstants
	},
	SVGPatternElement: {
		reads: 'x y width height patternUnits patternContentUnits patternTransform viewBox preserveAspectRatio href ' + unitConstants
	},
	SVGClipPathElement: { reads: 'clipPathUnits ' + unitConstants },
	SVGMaskElement: { reads: 'x y width height maskUnits maskContentUnits ' + unitConstants },
	SVGMarkerElement: {
		reads:
			'refX refY markerUnits markerWidth markerHeight orientType orientAngle viewBox preserveAspectRatio SVG_MARKERUNITS_UNKNOWN SVG_MARKERUNITS_USERSPACEONUSE SVG_MARKERUNITS_STROKEWIDTH SVG_MARKER_ORIENT_UNKNOWN SVG_MARKER_ORIENT_AUTO SVG_MARKER_ORIENT_ANGLE SVG_MARKER_ORIENT_AUTO_START_REVERSE',
		calls: { setOrientToAuto: call([], 0, true), setOrientToAngle: call(['svg-angle'], 1, true) }
	},
	SVGSymbolElement: { reads: 'viewBox preserveAspectRatio' },
	SVGViewElement: { reads: 'viewBox preserveAspectRatio' },
	SVGGElement: { reads: '' },
	SVGDefsElement: { reads: '' },
	SVGDescElement: { reads: '' },
	SVGMetadataElement: { reads: '' },
	SVGTitleElement: { reads: '' },
	SVGSwitchElement: { reads: '' },
	SVGGeometryElement: {
		reads: 'pathLength',
		calls: {
			getTotalLength: call(),
			getPointAtLength: call(['svg-number']),
			isPointInFill: call(['svg-point'], 0),
			isPointInStroke: call(['svg-point'], 0)
		}
	},
	SVGGraphicsElement: {
		reads: 'transform requiredExtensions systemLanguage',
		calls: { getBBox: call(['svg-box-options'], 0), getCTM: call(), getScreenCTM: call() }
	},
	SVGElement: { reads: 'className ownerSVGElement viewportElement' },
	SVGNumber: write('value'),
	SVGLength: {
		...write('unitType value valueInSpecifiedUnits valueAsString ' + lengthConstants, 'value valueInSpecifiedUnits valueAsString', {
			valueAsString: 'svg-unit'
		}),
		calls: { newValueSpecifiedUnits: call(['number', 'svg-number'], 2, true), convertToSpecifiedUnits: call(['number'], 1, true) }
	},
	SVGAngle: {
		...write('unitType value valueInSpecifiedUnits valueAsString ' + angleConstants, 'value valueInSpecifiedUnits valueAsString', {
			valueAsString: 'svg-unit'
		}),
		calls: { newValueSpecifiedUnits: call(['number', 'svg-number'], 2, true), convertToSpecifiedUnits: call(['number'], 1, true) }
	},
	SVGTransform: {
		reads: 'type matrix angle ' + transformConstants,
		calls: {
			setMatrix: call(['svg-matrix'], 0, true),
			setTranslate: call(['svg-number', 'svg-number'], 2, true),
			setScale: call(['svg-number', 'svg-number'], 2, true),
			setRotate: call(['svg-number', 'svg-number', 'svg-number'], 3, true),
			setSkewX: call(['svg-number'], 1, true),
			setSkewY: call(['svg-number'], 1, true)
		}
	},
	SVGPreserveAspectRatio: write('align meetOrSlice ' + aspectConstants, 'align meetOrSlice', { align: 'number', meetOrSlice: 'number' }),
	SVGPoint: write('x y'),
	SVGRect: write('x y width height'),
	SVGMatrix: write('a b c d e f'),
	DOMPoint: write('x y z w'),
	DOMPointReadOnly: { reads: 'x y z w' },
	DOMRect: write('x y width height'),
	DOMRectReadOnly: { reads: 'x y width height top right bottom left' },
	DOMMatrix: write('a b c d e f'),
	...Object.fromEntries(
		['Boolean', 'Enumeration', 'Integer', 'Number'].map((type) => [
			'SVGAnimated' + type,
			write('baseVal animVal', 'baseVal', { baseVal: type === 'Boolean' ? 'boolean' : type === 'Number' ? 'svg-number' : 'number' })
		])
	),
	SVGAnimatedString: write('baseVal animVal', 'baseVal', { baseVal: 'svg-fragment' }),
	...Object.fromEntries(
		['Length', 'Angle', 'Rect', 'NumberList', 'LengthList', 'TransformList', 'PreserveAspectRatio'].map((type) => [
			'SVGAnimated' + type,
			{ reads: 'baseVal animVal' }
		])
	),
	...Object.fromEntries(
		Object.entries(lists).map(([type, item]) => [
			type,
			{
				reads: 'length numberOfItems',
				calls: {
					clear: call([], 0, true),
					initialize: call([item], 1, true),
					getItem: call(['number']),
					insertItemBefore: call([item, 'number'], 2, true),
					replaceItem: call([item, 'number'], 2, true),
					removeItem: call(['number'], 1, true),
					appendItem: call([item], 1, true),
					...(type === 'SVGTransformList' ? { consolidate: call([], 0, true), createSVGTransformFromMatrix: call(['svg-matrix'], 0) } : {})
				}
			}
		])
	)
};
export const SVG_LIST_TYPES = Object.keys(lists);
