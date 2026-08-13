# Test fixtures

`signed.jpg` is a genuinely C2PA-signed image, taken from the
[c2pa-rs](https://github.com/contentauth/c2pa-rs) test suite (Apache-2.0 / MIT).

Every other fixture in this suite is built by hand, which is fast and precise
but shares the parser's assumptions. This one does not: it caught the CBOR
reader assuming manifests contain no indefinite-length items, when a real claim
opens one 172 bytes in. Keep it, and prefer adding more real files over more
synthetic ones.
