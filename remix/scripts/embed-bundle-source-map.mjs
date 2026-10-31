/**
 * Shared source-map assertion for the single-file embed bundle.
 *
 * The embed artifact must stay self-contained, so it must not carry a source
 * map annotation pointing at a separate `.map` file. The annotation is what
 * matters, not the substring: a plain `source.includes('sourceMappingURL=')`
 * scan also matches the literal text inside vendored css-loader/style-loader
 * runtimes (Editor.js ships pre-webpacked), which merely *build* an inline
 * `data:` URI at runtime and say nothing about this artifact.
 *
 * Browsers and Node only honour the final annotation in a file, and every
 * bundler emits it as a trailing comment, so anchoring at end-of-file matches
 * exactly the real regression this guards against (someone turning
 * `build.sourcemap` back on) with no false positives from bundled bytes.
 */
const SOURCE_MAP_ANNOTATION = /(?:\/\/|\/\*)[@#]\s*sourceMappingURL=(\S+?)(?:\s*\*\/)?$/;

/**
 * @param {string} source Bundle contents.
 * @returns {string | null} The referenced source map URL, or null when the
 *   bundle carries no trailing source map annotation.
 */
export const findSourceMapAnnotation = (source) => {
	const match = SOURCE_MAP_ANNOTATION.exec(source.trimEnd());

	return match ? match[1] : null;
};
