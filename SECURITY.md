# Security

[Version française](SECURITY.fr.md)

## Reporting a vulnerability

Please report privately, through GitHub: the repository's **Security** tab, **Report a vulnerability**.
If that option is not offered, open an issue saying only that you have a security report and asking
for a private contact — no details, no proof of concept, no file.

A hostile document that makes Cirta crash, hang, read something it should not, or report a file as
clean when it is not, is in scope. Send the smallest input that shows it; if it is a real document,
say so, and do not send one that holds anyone's personal data.

Fixes go to the `main` branch; there is no maintained older release.

## Threat model

Cirta is pointed at documents from people the user has no reason to trust. Everything below follows
from that.

**What it protects.** The user's documents and what they contain. They are read on the user's machine
and nowhere else: the core makes no network request, the page's Content-Security-Policy forbids every
connection (`connect-src 'none'`), and the analysis worker removes `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource` and `WebTransport` from its own scope before it loads PDF.js — a worker does
not inherit the page's policy. The page's service worker fetches only the site's own files, inside
its folder, never a document. `test/no-network.test.ts` checks all of it.

**Who it defends against.** Whoever wrote the file: a sender who wants the parser to crash or hang, to
reach the file system or the network, to run code, or to make the report lie.

| Surface | What could go wrong | What Cirta does | Checked by |
|---|---|---|---|
| File parsers (PDF, ZIP, OOXML, ODF, OLE2/CFB, MSG, MIME, images, CBOR/JUMBF, notebooks, MP4/QuickTime, ID3, RIFF/WAVE, TAR, gzip, 7z and its LZMA/LZMA2 decoder) | Crash, hang, memory blow-up on a crafted length, offset or loop | Every length and offset checked; chains followed with a visited set; archive limits (8 192 members, 512 MB declared, nesting 3); a file inside a file read 3 levels down at most; a corrupt file becomes a coded refusal, never a raw exception; a gzip is inflated as a stream under the archive limits, a 7z's folders are refused past them before decoding, and every CRC a 7z gives is checked, so a decoding error is a refusal, never a misread member | `scripts/fuzz.mjs` (in `npm run verify`), `test/fuzz-parsers.test.ts`, `test/fuzz-regressions.test.ts` |
| XML | Entity expansion (billion laughs), external entities (XXE), deep nesting, huge attributes | XML is read by Cirta's own scanner, not a DOM parser: a DOCTYPE is text, no entity beyond the five predefined ones and numeric references is resolved, nothing is fetched | `test/xml-robustness.test.ts` |
| Active content | Macros, PDF JavaScript, DDE, remote templates run or fetched while inspecting | Read, never run: VBA is decompressed and quoted, PDF.js renders with `isEvalSupported: false` and XFA off, remote targets are reported and never requested | `test/ooxml-active.test.ts`, `test/pdf-active.test.ts`, `test/legacy-office.test.ts` |
| The terminal | A value carrying escape sequences rewrites the screen, sets the title, writes the clipboard | Control characters and bidirectional overrides in anything printed are shown as visible escapes | `test/terminal.test.ts` |
| The web page | A value rendered as markup (XSS) | Values are inserted as text, never as HTML | `test/no-network.test.ts` (no `innerHTML` in `src/web`) |
| Output files | A cleaned copy that does not open, or that still holds what it says it removed | Every cleaned copy is inspected again; one that does not parse is not delivered; "removed" means gone from the output, checked; what survives is named | `test/redact-truth.test.ts`, `scripts/real-files.mjs` |
| MCP server | An agent overwriting the user's files | Local stdio only; `redact_file` never overwrites the input, nor an existing file unless `overwrite` is true | `test/mcp.test.ts` |
| `cirta serve` (ICAP, HTTP) | A client on the network sends a malformed or endless request, a compressed body that expands without end, or reads what others submitted | Loopback unless `--host` says otherwise; no authentication, so it belongs behind the proxy or gateway that calls it, never exposed; headers and chunk lines bounded, bodies past `--max-size` (50 MB) read and dropped, decompression bounded by the same size, idle connections closed after 120 s; each request is answered to its own sender only, and the log holds labels and counts, never a value or a URL; it listens and never connects | `test/serve.test.ts`, `test/no-network.test.ts`, `test/docker.test.ts` |
| `cirta watch` | A cleaned copy written over the file someone is about to send, or a half-written file read as complete | `--clean` writes only to another folder, given with `--output`; `--in-place` is refused; a file is read once two looks a second apart find it unchanged | `test/watch.test.ts` |
| Thunderbird add-in | An attachment replaced by a broken copy, or the add-in reaching the network | An attachment is replaced only by a copy the library wrote and read back, never for a format it does not rewrite; one permission, `compose`; its policy forbids every connection, and its background script holds no network call | `test/thunderbird.test.ts` |
| Rules file | A pattern that backtracks badly | A rule's pattern runs as written; JavaScript gives no timeout. Documented; use rules you trust | — |

**Out of scope.**
- **Statistical watermarks** in the wording of a model's output. They live in word choices, need the
  vendor's key to read, and no local tool can detect or remove them. Cirta does not claim to.
- **Pixels.** An invisible watermark encoded in an image's data is neither detected nor removed;
  only the container's metadata is.
- **Formats inspected but never rewritten** — legacy Office (`.doc`, `.xls`, `.ppt`), Outlook `.msg`,
  plain archives: cleaning is refused rather than risked.
- **A compromised machine or browser**, and the supply chain of the dependencies (`pdf-lib`, `fflate`,
  PDF.js, `@napi-rs/canvas`), beyond the lockfile and the network removal described above.
