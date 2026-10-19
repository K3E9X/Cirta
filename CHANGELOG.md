# Changelog

Every change a user of the command line, the library or the site can notice, newest first. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) from 1.0.0; before that, a minor version may break the
library's API, and this file says so when it does.

A release moves the **Unreleased** section under its version and date. The release workflow refuses to
publish a version this file does not describe (`scripts/check-release.mjs`).

## [Unreleased]

### Added

- **Formats.**
  - Legacy Office (`.doc`, `.xls`, `.ppt`) and Outlook `.msg`: inspected; cleaning is refused, with what to do instead.
  - Jupyter notebooks: inspected and cleaned, `--clear-outputs`.
  - RTF, EPUB and Visio `.vsdx`: inspected and cleaned.
  - WebP and GIF: inspected and cleaned.
  - TIFF, HEIC and AVIF: inspected; cleaning is refused.
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
  - `cirta verify` and `--fail-on`.
  - `cirta sanitize-for-llm`.
  - A local MCP server (`cirta mcp`).
  - SARIF output.
- **Profiles.** `--profile minimal|balanced|strict`.
- **Chain of custody.**
  - Deterministic output: the same file cleaned twice gives the same bytes.
  - A `--manifest` with SHA-256 and findings, before and after, by label and never by value.
  - Archives cleaned member by member; an archive is refused, and each member it cannot clean named.
- **Reports.** `inspect --report` writes an HTML page or Markdown, in French or English.
- **Library.**
  - A documented API (`cirta`, `cirta/node`) with its types.
  - A versioned JSON report, `schema/report.v1.json`.
- **Site.**
  - Whole folders, cleaned at once into a ZIP with its manifest.
  - Report export.
  - Works offline: a service worker that keeps only the site's files.
  - A « Check this site » box, `SHA256SUMS`, and a provenance attestation for every published file.
- **Interface.** French and English throughout, in the terminal and on the page.
- **Performance budget.** Every format, at 50 MB, held to a time and a peak memory on every push.
- **Distribution.**
  - Single-file binaries for Linux, macOS and Windows, built and run in CI, attested at release.
  - npm publication with provenance from a version tag, after the release checks.
  - `cirta --version`.

### Changed

- **Cleaning re-inspects its output.** It names what survived, and refuses to hand over a copy it cannot read back.
- **Fewer false positives.** Typographic spaces, an arithmetic minus sign, a single decomposed accent, a camera's fixed preview.

### Fixed

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

[Unreleased]: https://github.com/K3E9X/Cirta/compare/b23fca9...HEAD
