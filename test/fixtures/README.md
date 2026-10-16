# Test fixtures

`signed.jpg` is a genuinely C2PA-signed image, taken from the
[c2pa-rs](https://github.com/contentauth/c2pa-rs) test suite (Apache-2.0 / MIT).

Every other fixture in this suite is built by hand, which is fast and precise
but shares the parser's assumptions. This one does not: it caught the CBOR
reader assuming manifests contain no indefinite-length items, when a real claim
opens one 172 bytes in. Keep it, and prefer adding more real files over more
synthetic ones.

`scan-stripes.j2k` is a 300×20 JPEG 2000 codestream of dark strokes on paper,
made with ImageMagick (`convert … -define jp2:quality=20`). It stands in for a
scanned line under an OCR text layer. Decoding it needs PDF.js's OpenJPEG
module; when that module was not supplied, the scan rendered as blank paper and
the OCR text over it read as hidden.
