# Changelog

Every change a user of the command line, the library or the site can notice, newest first. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) from 1.0.0; before that, a minor version may break the
library's API, and this file says so when it does.

A release moves the **Unreleased** section under its version and date. The release workflow refuses to
publish a version this file does not describe (`scripts/check-release.mjs`).

## [Unreleased]

### Added

- **A link can preset the page**: `#tab=text`, `#lang=en`, `#format=pdf` in the fragment, never sent to a server.
### Changed

- **Cirta is now Ciirta.** The npm package and the command are `ciirta` (`ciirta/node` for the Node engines), the report schema `ciirta.report/1` and the manifest `ciirta.manifest/1`, the service's headers `X-Ciirta-Verdict` and `X-Ciirta-Findings`, the variables `CIIRTA_*`, the browser's keys `ciirta.*` — moved from `cirta.*` on the first visit, nothing lost. The repository and the site keep their addresses until the repository is renamed.
- **`ciirta mcp` stays inside its roots.** It reads and writes only in the folders given with `--root` (repeatable), the current one otherwise, links followed; a path elsewhere — through `..` or a link — and an `output` outside are refused with a JSON-RPC error. A configuration that named files outside the folder the server starts in needs a `--root`. `redact_file` takes `output` (`output_path` is still read).

### Added

- **A link can preset the page**: `#tab=text`, `#lang=en`, `#format=pdf` in the fragment, never sent to a server.

### Fixed

- **A cleaned phone photo keeps its orientation.** Cleaning a JPEG took the whole Exif block, so a portrait came out on its side; an Exif holding the orientation alone is written back, and not reported.
- **Character names begin with a capital** in the report, the page and the MCP tools, in both languages (« Espace sans chasse »); the core's label, in JSON and the library, is unchanged. `--help`'s Scope paragraph says what Ciirta reads today, in four lines, in English and with `--lang fr`.
- **Three things reported as someone's identity that are not.** The `AppVersion` of a `.doc` or `.xls` property set (and Office's other bookkeeping properties, in every format with custom properties) is informational provenance. A library's default values — python-docx's author "python-docx", python-pptx's, openpyxl's, ReportLab's "anonymous", "untitled", "unspecified" — are named as *the default value of* that library. A field whose value is only unresolved XML entities (`&xxe;`, `&lol9;`) is no longer an author or a title; the DTD that declared them is reported as *DTD with entities in an XML part (unresolved)*, probable, with the file an external entity names.
- **French reports of nested files.** A lookalike link or dash in a mail part, an attached message, a text attachment or a file inside a zip kept its explanation in English: the translation looked for the location « links » and found « part 1 (text/plain) → links ». It now reads the last step. A finding the text and HTML versions of a mail share is reported once, with both places.
- **A cleaned phone photo keeps its orientation.** Cleaning a JPEG took the whole Exif block, so a portrait came out on its side; an Exif holding the orientation alone is written back, and not reported.

### Security

- **`sanitize-for-llm` says where a deceptive link goes.** A link showing `https://paypal.com/login` on the way to a lookalike domain reached the model as that address. The text now reads `https://paypal.com/login [→ https://xn--l-7sba6dbr.com/login]`, for link text naming another site (HTML, Markdown, a mail's HTML) and addresses in lookalike letters; `--json` and the library carry `deceptiveLinks`, stderr says so, and `--fail-on-deceptive-links` exits 1.
- **`ciirta serve` answers only its own names on the loopback.** A web page could point a name it controls at 127.0.0.1 and read the HTTP API from its own origin (DNS rebinding). On the loopback, a `Host` other than `127.0.0.1`, `localhost`, `[::1]`, the `--host` given or an `--allowed-host` now gets 421.
- **What runs in a page, a picture or a mail's HTML.** HTML, SVG, Markdown and the HTML parts of a mail reported a `javascript:` link and nothing else. Now named: `<script>` inline or from a file, `on…` attributes, `javascript:`, `vbscript:` and `data:` page addresses wherever one is followed (src, action, formaction, xlink:href, SVG animations), `<meta http-equiv="refresh">`, `<object>`, `<embed>`, `<applet>`, and a form that sends to another address. `--strip-active` takes them out of these formats, a mail's HTML parts and HTML or SVG attachments included, each encoded again as it was; a link keeps its text. « Run again with --strip-active » is no longer offered for what the option would leave — remote pictures are `--strip-remote-resources`' business.

## [0.3.0] — 2026-10-20

The library's four entry points, stable; readers that a hostile file can no longer hold. Published to
npm with provenance by the release workflow once the repository variable `PUBLISH_NPM` is `true`.

### Added

- **Hidden keyword stuffing.** A pile of skills hidden in a CV for the screening software is reported as *Hidden keyword stuffing*, confirmed, apart from an order to a model.
- **Hidden text in OpenDocument and RTF**: hidden formatting and fields, a colour on its background, type under 2 pt, a frame off the page (ODT).
- **`sanitizeForLlm` from the library's entry point**, beside `inspectFile`, `redactFile` and `scanText`; the README's example uses all four and is run against the packed package.

### Security

- **Regular expressions that a hostile file could make backtrack.** One was exponential: 195 bytes of broken comments at the head of any part of a DOCX, XLSX or PPTX held Ciirta for 9 s, a few more for hours. 190 were quadratic, in the Office, OpenDocument, EPUB, HTML, SVG, Markdown, mail, PDF and plain-text readers: a DOCX of 1.4 KB took 8 s. They read their input in linear time now, and the few still quadratic see only bounded input; `test/redos.test.ts` keeps one hostile file per family, and a CI job checks every pattern (`npm run redos`).

### Fixed

- **The library reads a file name as the command line does**: `inspectFile(bytes, 'cv.html')` reads HTML, `'notes.md'` Markdown, where the library used to read them as plain text and miss what their markup hides.
- **VS Code underlines an invisible character in Markdown, HTML and SVG** where it is, as it did in plain text.

## [0.2.0] — 2026-10-19

Released on GitHub — single-file binaries, the library as one file, the editor, browser and Thunderbird
extensions, each attested — and not published to npm.

### Added

- **Licence.** The MIT licence's text, with its holder, in `LICENSE`.
- **Formats.**
  - Legacy Office (`.doc`, `.xls`, `.ppt`) and Outlook `.msg`: inspected; cleaning is refused, with what to do instead.
  - Jupyter notebooks: inspected and cleaned, `--clear-outputs`.
  - RTF, EPUB and Visio `.vsdx`: inspected and cleaned.
  - WebP and GIF: inspected and cleaned.
  - TIFF, HEIC and AVIF: inspected; cleaning is refused.
  - MP4, QuickTime and M4A: the place, the device, the software, the dates; cleaned in place, no byte of the media moved.
  - MP3 (ID3v2, ID3v1, APEv2) and WAV (INFO, bext, iXML, XMP, id3): read and removed, the audio kept byte for byte; RF64 inspected only.
  - TAR, gzip and 7z: inspected only — owners, dates, the download address macOS and Linux keep, links, each member read; 7z's LZMA and LZMA2 decoded.
  - LaTeX: comments removed, the `%` kept.
  - iCalendar and vCard.
- **Active content and attack vectors.**
  - PDF actions and scripts, Office macros, DDE fields, remote templates, OLE objects, data connections, Power Query sources.
  - Links that run a script, carry a page or bounce through an open redirector.
  - File names that lie: right-to-left override, double extension, zip slip.
  - `--strip-active`, `--strip-remote-resources`, `--strip-tracking-params`.
- **Content options.**
  - `--remove-hidden`, `--accept-changes`, `--remove-comments`, `--remove-notes`, `--remove-hidden-slides`, `--remove-hidden-sheets`.
  - `--remove-attachments`, `--flatten-annotations`, `--burn-redactions`.
- **Pictures.** `--reencode-images` rebuilds a JPEG or PNG from its pixels: orientation applied, colour profile kept.
- **Text a reader cannot see, which a model reads.** PDF pages rendered and checked letter by letter; hidden runs in Word, PowerPoint, HTML and mail; orders aimed at a model flagged.
- **DLP.** Personal data (`--pii`) and an organisation's own rules (`--rules`).
- **For pipelines and agents.**
  - `ciirta verify` and `--fail-on`.
  - `ciirta sanitize-for-llm`.
  - A local MCP server (`ciirta mcp`).
  - SARIF output.
- **As a service.** `ciirta serve`: ICAP (RESPMOD, REQMOD) for a proxy or a mail gateway, and an HTTP API; inspection only unless `--block-on` or `--allow-clean`. A Docker image of it.
- **One file.** The library as a single ES module and a classic script, for the tools that embed it.
- **Integrations.**
  - `--changed-only` and `--base <ref>`: only the files a commit or a pull request changes.
  - A pre-commit hook (`.pre-commit-hooks.yaml`).
  - A GitHub Action: findings annotated on the pull request, the check failed at `fail-on`, SARIF for code scanning on request.
  - A VS Code extension: invisible characters underlined where they are, any file inspected or cleaned from the Explorer.
  - A browser extension for Chrome and Firefox: the page, with no permission and no connection allowed.
  - A Thunderbird add-in: attachments read before a message is sent, the message held back when one names its sender, cleaned in the message on request. Not yet run in Thunderbird itself.
  - `ciirta watch <folder>`: each file inspected as it arrives; `--clean -o <folder>` writes cleaned copies elsewhere, never in place.
- **Profiles.** `--profile minimal|balanced|strict`.
- **Chain of custody.**
  - Deterministic output: the same file cleaned twice gives the same bytes.
  - A `--manifest` with SHA-256 and findings, before and after, by label and never by value.
  - Archives cleaned member by member; an archive is refused, and each member it cannot clean named.
- **Reports.** `inspect --report` writes an HTML page or Markdown, in French or English.
- **Library.**
  - A documented API (`ciirta`, `ciirta/node`) with its types.
  - A versioned JSON report, `schema/report.v1.json`.
- **Site.**
  - Whole folders, cleaned at once into a ZIP with its manifest.
  - Report export.
  - Works offline: a service worker that keeps only the site's files.
  - A « Check this site » box, `SHA256SUMS`, and a provenance attestation for every published file.
  - A light and a dark theme, following the system or chosen in the header.
  - Accessibility: real buttons in the drop zone, results announced to screen readers, every label in both languages; an axe-core audit, a keyboard walk and a 320px check on every push (`scripts/a11y.mjs`).
- **Interface.** French and English throughout, in the terminal and on the page.
- **Performance budget.** Every format, at 50 MB, held to a time and a peak memory on every push.
- **Distribution.**
  - Single-file binaries for Linux, macOS and Windows, built and run in CI, attested at release.
  - npm publication with provenance from a version tag, after the release checks.
  - `ciirta --version`.

### Changed

- **Cleaning re-inspects its output.** It names what survived, and refuses to hand over a copy it cannot read back.
- **Fewer false positives.** Typographic spaces, an arithmetic minus sign, a single decomposed accent, a camera's fixed preview.

### Fixed

- The release workflow was not valid YAML; GitHub would have refused it.
- An encrypted PDF is refused rather than rewritten into an unreadable copy.
- Terminal escape sequences in a document can no longer drive the terminal (CWE-150).
- Text replaced through a new content stream in a later PDF revision is found.
- The 50 MB text pass ran in quadratic memory; it now reads 50 MB in about 10 s and 1 GB.
- A ZIP member that inflates a thousand times its size is refused before it is inflated.
- The page's code is typechecked; its configuration had left it out.

### Security

- `SECURITY.md` states the threat model and what each surface is checked by.
- The parsers are fuzzed, the new ones in `npm test`.

## [0.1.0]

The first version: metadata of PDF, Office Open XML, OpenDocument, SVG, HTML, Markdown, JPEG and PNG;
invisible characters in text and documents; C2PA manifests; the command line and the site. Never
published to npm.

[Unreleased]: https://github.com/K3E9X/Cirta/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/K3E9X/Cirta/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/K3E9X/Cirta/compare/b23fca9...v0.2.0
[0.1.0]: https://github.com/K3E9X/Cirta/tree/b23fca9
