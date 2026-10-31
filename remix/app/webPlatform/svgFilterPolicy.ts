import type { Policy } from './domBridge';
export const SVG_FILTER_RECEIVER_POLICY: Record<string, Policy> = {
	SVGComponentTransferFunctionElement: {
		reads:
			'amplitude exponent intercept offset slope tableValues type SVG_FECOMPONENTTRANSFER_TYPE_DISCRETE SVG_FECOMPONENTTRANSFER_TYPE_GAMMA SVG_FECOMPONENTTRANSFER_TYPE_IDENTITY SVG_FECOMPONENTTRANSFER_TYPE_LINEAR SVG_FECOMPONENTTRANSFER_TYPE_TABLE SVG_FECOMPONENTTRANSFER_TYPE_UNKNOWN'
	},
	SVGFEBlendElement: {
		reads:
			'in1 in2 mode SVG_FEBLEND_MODE_COLOR SVG_FEBLEND_MODE_COLOR_BURN SVG_FEBLEND_MODE_COLOR_DODGE SVG_FEBLEND_MODE_DARKEN SVG_FEBLEND_MODE_DIFFERENCE SVG_FEBLEND_MODE_EXCLUSION SVG_FEBLEND_MODE_HARD_LIGHT SVG_FEBLEND_MODE_HUE SVG_FEBLEND_MODE_LIGHTEN SVG_FEBLEND_MODE_LUMINOSITY SVG_FEBLEND_MODE_MULTIPLY SVG_FEBLEND_MODE_NORMAL SVG_FEBLEND_MODE_OVERLAY SVG_FEBLEND_MODE_SATURATION SVG_FEBLEND_MODE_SCREEN SVG_FEBLEND_MODE_SOFT_LIGHT SVG_FEBLEND_MODE_UNKNOWN x y width height result'
	},
	SVGFEColorMatrixElement: {
		reads:
			'in1 type values SVG_FECOLORMATRIX_TYPE_HUEROTATE SVG_FECOLORMATRIX_TYPE_LUMINANCETOALPHA SVG_FECOLORMATRIX_TYPE_MATRIX SVG_FECOLORMATRIX_TYPE_SATURATE SVG_FECOLORMATRIX_TYPE_UNKNOWN x y width height result'
	},
	SVGFEComponentTransferElement: { reads: 'in1 x y width height result' },
	SVGFECompositeElement: {
		reads:
			'in1 in2 k1 k2 k3 k4 operator SVG_FECOMPOSITE_OPERATOR_ARITHMETIC SVG_FECOMPOSITE_OPERATOR_ATOP SVG_FECOMPOSITE_OPERATOR_IN SVG_FECOMPOSITE_OPERATOR_OUT SVG_FECOMPOSITE_OPERATOR_OVER SVG_FECOMPOSITE_OPERATOR_UNKNOWN SVG_FECOMPOSITE_OPERATOR_XOR x y width height result'
	},
	SVGFEConvolveMatrixElement: {
		reads:
			'bias divisor edgeMode in1 kernelMatrix kernelUnitLengthX kernelUnitLengthY orderX orderY preserveAlpha targetX targetY SVG_EDGEMODE_DUPLICATE SVG_EDGEMODE_NONE SVG_EDGEMODE_UNKNOWN SVG_EDGEMODE_WRAP x y width height result'
	},
	SVGFEDiffuseLightingElement: { reads: 'diffuseConstant in1 kernelUnitLengthX kernelUnitLengthY surfaceScale x y width height result' },
	SVGFEDisplacementMapElement: {
		reads:
			'in1 in2 scale xChannelSelector yChannelSelector SVG_CHANNEL_A SVG_CHANNEL_B SVG_CHANNEL_G SVG_CHANNEL_R SVG_CHANNEL_UNKNOWN x y width height result'
	},
	SVGFEDistantLightElement: { reads: 'azimuth elevation' },
	SVGFEDropShadowElement: {
		reads: 'dx dy in1 stdDeviationX stdDeviationY x y width height result',
		calls: { setStdDeviation: { args: ['svg-number', 'svg-number'], min: 2, mutates: true } }
	},
	SVGFEFloodElement: { reads: 'x y width height result' },
	SVGFEFuncAElement: { reads: '' },
	SVGFEFuncBElement: { reads: '' },
	SVGFEFuncGElement: { reads: '' },
	SVGFEFuncRElement: { reads: '' },
	SVGFEGaussianBlurElement: {
		reads:
			'edgeMode in1 stdDeviationX stdDeviationY SVG_EDGEMODE_DUPLICATE SVG_EDGEMODE_NONE SVG_EDGEMODE_UNKNOWN SVG_EDGEMODE_WRAP x y width height result',
		calls: { setStdDeviation: { args: ['svg-number', 'svg-number'], min: 2, mutates: true } }
	},
	SVGFEImageElement: { reads: 'crossOrigin preserveAspectRatio x y width height result href' },
	SVGFEMergeElement: { reads: 'x y width height result' },
	SVGFEMergeNodeElement: { reads: 'in1' },
	SVGFEMorphologyElement: {
		reads:
			'in1 operator radiusX radiusY SVG_MORPHOLOGY_OPERATOR_DILATE SVG_MORPHOLOGY_OPERATOR_ERODE SVG_MORPHOLOGY_OPERATOR_UNKNOWN x y width height result'
	},
	SVGFEOffsetElement: { reads: 'dx dy in1 x y width height result' },
	SVGFEPointLightElement: { reads: 'x y z' },
	SVGFESpecularLightingElement: {
		reads: 'in1 kernelUnitLengthX kernelUnitLengthY specularConstant specularExponent surfaceScale x y width height result'
	},
	SVGFESpotLightElement: { reads: 'limitingConeAngle pointsAtX pointsAtY pointsAtZ specularExponent x y z' },
	SVGFETileElement: { reads: 'in1 x y width height result' },
	SVGFETurbulenceElement: {
		reads:
			'baseFrequencyX baseFrequencyY numOctaves seed stitchTiles type SVG_STITCHTYPE_NOSTITCH SVG_STITCHTYPE_STITCH SVG_STITCHTYPE_UNKNOWN SVG_TURBULENCE_TYPE_FRACTALNOISE SVG_TURBULENCE_TYPE_TURBULENCE SVG_TURBULENCE_TYPE_UNKNOWN x y width height result'
	},
	SVGFilterElement: { reads: 'filterUnits height primitiveUnits width x y' }
};
