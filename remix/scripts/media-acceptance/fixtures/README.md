# Media acceptance fixtures

These tiny synthetic HEIC color fixtures are copied unchanged from the official
[libheif](https://github.com/strukturag/libheif) test corpus at commit
`364905fc9841bdda229e0ae2c5fda13b5fc98d1a` (retrieved 2026-10-22):

| File | Source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `colors-no-alpha.heic` | [upstream file](https://github.com/strukturag/libheif/blob/364905fc9841bdda229e0ae2c5fda13b5fc98d1a/fuzzing/data/corpus/colors-no-alpha.heic) | 499 | `76f82ffc717a647b1c9c2551e5ea0545832a2d3216c7540f7e5b092282a04b63` |
| `colors-with-alpha.heic` | [upstream file](https://github.com/strukturag/libheif/blob/364905fc9841bdda229e0ae2c5fda13b5fc98d1a/fuzzing/data/corpus/colors-with-alpha.heic) | 817 | `cbe33c0e3efe098570787a9dcded1061436f9d06b09cd5b2afd0d02eacce527b` |

Both decode as one 64 × 64 image. The second includes transparency. They verify
the actual bundled HEIC decoder and output alpha rather than inferring support
from a format registry. They are test inputs, never user uploads or app assets.

The upstream root `COPYING` states that libheif uses GNU LGPL version 3 and its
sample applications/wrappers use MIT. These files live in `fuzzing/data/corpus`,
outside the MIT-licensed `examples` directory; no separate fixture license notice
was present there. The complete upstream license/notice file is retained unchanged
as [`COPYING.libheif`](COPYING.libheif), including the LGPL/GPL and MIT texts.
