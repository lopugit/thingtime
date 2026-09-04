import assert from 'node:assert/strict';
import test from 'node:test';

import { findSourceMapAnnotation } from './embed-bundle-source-map.mjs';

test('reports a trailing source map annotation', () => {
	assert.equal(findSourceMapAnnotation('x=1\n//# sourceMappingURL=thingtime.min.js.map'), 'thingtime.min.js.map');
	assert.equal(findSourceMapAnnotation('x=1\n//# sourceMappingURL=thingtime.min.js.map\n'), 'thingtime.min.js.map');
	assert.equal(findSourceMapAnnotation('body{}\n/*# sourceMappingURL=a.css.map */'), 'a.css.map');
	assert.equal(findSourceMapAnnotation('x=1\n//@ sourceMappingURL=legacy.map'), 'legacy.map');
	assert.equal(
		findSourceMapAnnotation('x=1\n//# sourceMappingURL=data:application/json;base64,AAAA'),
		'data:application/json;base64,AAAA'
	);
});

test('ignores the literal string inside bundled vendor runtimes', () => {
	// Editor.js ships pre-webpacked, so the embed bundle carries css-loader and
	// style-loader runtimes that assemble an inline source map at runtime. Those
	// are ordinary bundled bytes mid-file, not an annotation for the artifact,
	// and a whole-file substring scan used to fail the build on them.
	const cssLoaderRuntime =
		'var di=(Da=ui,`/*# sourceMappingURL=data:application/json;charset=utf-8;base64,`+btoa(x)+` */`)';
	const styleLoaderRuntime = 'di&&(ui+=`\\n/*# sourceMappingURL=data:application/json;base64,`+btoa(y)+` */`)';

	assert.equal(findSourceMapAnnotation(`${cssLoaderRuntime};${styleLoaderRuntime};window.Thingtime=t}})();`), null);
});

test('accepts a self-contained bundle', () => {
	assert.equal(findSourceMapAnnotation('(function(){window.Thingtime={}})();'), null);
	assert.equal(findSourceMapAnnotation(''), null);
});
