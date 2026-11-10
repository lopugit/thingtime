# Local image compression engines

The browser compressor distributes unmodified, pinned engine builds. Selected
media is processed locally; no third-party codec CDN is contacted.

- **@imagemagick/magick-wasm 0.0.45**, Copyright Dirk Lemstra, Apache-2.0
  wrapper. [Source](https://github.com/dlemstra/magick-wasm).
  ImageMagick and its bundled delegates retain their respective licenses and
  notices. The complete npm package LICENSE and dependency NOTICE are included
  unchanged at `/platform/magick-wasm-LICENSE.txt` and
  `/platform/magick-wasm-NOTICE.txt`.
- **@resvg/resvg-wasm 2.6.2**, MPL-2.0.
  [Source and build instructions](https://github.com/yisibl/resvg-js/tree/v2.6.2).
  The MPL-2.0 text is included at `/platform/resvg-LICENSE.txt`.
- **Mediabunny 1.61.6**, MPL-2.0, remains the local video container/conversion
  engine. Its existing notice is `/platform/mediabunny-LICENSE.txt`.

HEIC test fixtures have separate pinned-source provenance, hashes and the
upstream libheif notices in `scripts/media-acceptance/fixtures/`.
