<img src="assets/logo.svg" alt="" width="72" align="left" hspace="12" />

# Cirta

Inspects and strips provenance metadata from **PDF, Office and OpenDocument files, SVG, HTML and
Markdown**, the **Exif in embedded pictures**, and the **invisible Unicode** in text. It also
reconstructs the **traces the producing tool left** — assistant named, operating system, account
name, working directory. Available as a web interface and a command line.

Everything runs locally. The web interface makes no network requests: no document leaves your
machine.

*[Version française](README.fr.md) · the interface itself is bilingual, French and English.*

## What this tool does

| Support | Handled |
|---|---|
| PDF | The `/Info` dictionary **including non-standard keys**, XMP packet, trailer `/ID`, C2PA manifests, attachments, and a **scan of decompressed streams** — page text, JavaScript, attachments |
| PPTX / DOCX / XLSX | `docProps/core.xml`, `docProps/app.xml`, custom properties, thumbnail, `rsid` identifiers, comment authors, links to local or network paths, hidden slides, speaker notes, **and the invisible characters in the document body** |
| `customXml/` | The second property store, which `docProps` does not cover: content-control bindings, SharePoint library columns, classification labels |
| XLSX in particular | Comment authors (`<author>`, the `xl/persons` registry), defined names pointing outside the workbook, `xl/externalLinks/` parts — carriers neither Word nor PowerPoint uses |
| ODT / ODS / ODP | `meta.xml`: generator, initial creator, last modified by, dates, edit cycles and duration, user-defined properties, thumbnail, **and the invisible characters in the body** |
| SVG | The `<metadata>` block (RDF/Dublin Core, C2PA), editor namespaces (Inkscape, Figma, Sketch…), generator comments |
| HTML | `generator`, `author`, `creator`, `copyright`, `date` meta tags; `data-ai-*` attributes; generator comments; JSON-LD reported |
| Markdown | Front-matter keys, HTML generator comments, trailing attribution lines |
| JPEG / PNG | Exif (including GPS), XMP, IPTC/Photoshop, comments; `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME` chunks — standalone as well as embedded in a document |
| C2PA | Signed manifests in PDF (XMP), Office and OpenDocument (dedicated parts), SVG (`<metadata>`) and images (JUMBF in `APP11` for JPEG, `caBX` chunk for PNG) |
| ZIP / EPUB | Recursive traversal: every member goes through the normal detection path, and members no parser claims are scanned for credentials and provider identifiers |
| Text | Invisible characters (zero-width, variation selectors, tag characters, bidi controls, exotic spaces), with steganographic payloads decoded; **plus a generic net over the Unicode `Cf` category**, so the list does not fall behind the standard |
| **Email** | The RFC 5322 header block: `X-Mailer`, `User-Agent`, `X-Generated-By`, `Message-ID`, `Received`, `X-Originating-IP`, and **any unknown `X-` header** — that is where a pipeline signs itself. Tool headers are removed on cleaning; `From`, `Subject`, `Date` and `Message-ID` stay, they are the message |
| Text and source files | `.txt`, `.csv`, `.json`, `.yaml`, `.py`, `.js`, `.ts`, `.go`, `.rs`, `.sh`… and dotfiles (`.env`, `.npmrc`, `.netrc`) — same checks, same removal. A bidirectional control in source is the **Trojan Source** case (CVE-2021-42574) |
| Credentials | Anthropic, OpenAI, Google, Hugging Face, GitHub, **AWS**, Slack, Stripe keys; **PEM private key blocks**; call identifiers and LLM endpoints. Only patterns that cannot occur in ordinary prose — never a product name |
| Lookalike letters | Words mixing two scripts (`pаssword` with a Cyrillic `а`) or two widths (`Ａdmin`) — **reported, never replaced** |
| Unicode normalisation | A document containing both `é` (U+00E9) and `e`+U+0301 — same rendering, two encodings, **one free bit per accented letter** |
| Hyphen lookalikes | U+2010, U+2011, U+2012, U+2212 — indistinguishable from `-` on screen. Em and en dashes are excluded: they are visible and correct in typography |
| C0 controls | `NUL`, `BEL`, `BS`, `VT`, `ESC`, `DEL` — category `Cc`, which the `Cf` net does not cover. Reported, never removed: a colourised terminal log is full of legitimate `ESC` |
| Spacing channels | Trailing whitespace, inconsistent spacing after full stops, mixed CRLF/LF line endings — **reported, never rewritten** |

### What the text looks like

The third and last thing a local tool can say — and the one most easily abused, so its shape matters
as much as its content. **It measures; it does not conclude.**

This is not modesty. OpenAI withdrew its own AI-text classifier in July 2023 at 26% true positives
and 9% false positives. And [Liang et al. (Stanford, 2023)](https://arxiv.org/abs/2304.02819) showed
that the detectors still on the market flagged **61% of TOEFL essays by non-native English writers**
as machine-written — a false positive that lands, systematically, on the people least able to argue
with it. Any verdict built on these signals inherits that.

What survives honest scrutiny is the individual indicators:

```
Style  indicators, not a verdict
shape       7 sentences, 17.9 words on average
variation   0.50 — how much sentence length moves
dashes      24.0 em/en dashes per 1000 words
lead-ins    60% of paragraphs open with a bold phrase
phrases     crucial / holistic ×3 · it is important to note ×2 · in the landscape… ×1
reading     Several of these are present at once.
```

Four families of measurement:

- **Lexicon** — a **French-first** list, because nearly every published detector is trained on
  English, which makes them useless on the documents this tool exists for. Distinctive turns of
  phrase ("in today's ever-evolving digital landscape") count from the first occurrence; ordinary
  words ("crucial") need **at least two occurrences and a minimum rate**, because one means nothing.
- **Rhythm** — the variation in sentence length. People vary more than a model does; technical
  documentation varies less than either. The number is given, the threshold is not.
- **Punctuation** — em dashes per 1000 words.
- **Structure** — the share of paragraphs opening with a bolded lead-in.

**No score, and that is deliberate.** Weighting these signals would imply they had been calibrated
against a labelled corpus, which they have not, and the number would be read as a probability
whatever it was called. Aggregation therefore stops at *how many* are present.

The control that matters: on Camus's *L'Étranger* the reading is "few of these markers are present".
A module that flags Camus is worse than no module.

The intended use is the one the tool was built for: reading **your own draft** before you send it.
"Six of these markers are in your text, here is where" is actionable. "78% AI" is not, and would not
be true.

### Pasted text gets the same reading as a file

A real defect, found by measuring rather than assuming: **the same bytes did not give the same answer
depending on their extension.** A mail draft saved as `.md` declared its generative source and named
the assistant; the identical file as `.txt` reported nothing but its odd characters. Three paths led
to text — a file, standard input, the paste box on the page — and the three had drifted apart.

They now go through one function, `inspectPlainText()`, which stacks:

1. The character level — invisibles, lookalikes, spacing channels.
2. Payloads hidden **in** those characters.
3. Mail headers, when the text turns out to be a message.
4. The declared `digitalSourceType`.
5. Credentials and provider identifiers.
6. `fingerprint()`, which reads all of the above **and the body itself**.

Step 6 earns its caveat. The body is passed under a label that **disables tool-name matching**: a
`/home/lotfi/…` path or a `session_01ABCdef99` in a signature is a leak whatever the text is about,
but a *vendor name* in the body is the subject. Somebody writing an email **about** Claude has not
written that email **with** Claude. The test that keeps that distinction is in `test/email.test.ts`,
and it is the most important one in the file.

### Zero-width watermarks, actually decoded

Counting invisible characters is not enough: the question is **what they say**. The most widespread
scheme — the one every "invisible watermark" library on npm implements — uses U+200B and U+200C as
binary digits. A `KGX-2026` hidden behind a signature is 64 invisible characters that look like
nothing until you read them back as bits.

Cirta tries **both polarities** (no standard says which of the two means 1) and additionally reads a
four-symbol alphabet as base-4. Two guards, both of which came from a failing test:

- The threshold counts **bits, not characters**. A 24-character floor silently discarded a five-byte
  base-4 payload, which occupies only twenty.
- The result must say **more than one thing**. A regular alternation of two carriers decodes to
  `0101…`, that is `UUUU` — perfectly printable, perfectly meaningless. A decoder that always finds
  something is worth nothing.

When nothing decodes, the characters are still counted and removed: the absence of a readable payload
does not mean the absence of a channel.

### When the file declares it itself

There is a standard field where a generator *declares* how content was made: `digitalSourceType`,
the IPTC vocabulary. It is what C2PA carries in its `c2pa.actions` assertion, and it is what the EU
AI Act's transparency obligations are written around. An honest tool writes there that it generated
the content — a URI, in the metadata, meant to be read.

Cirta reads it in the XMP packet, in the C2PA assertion, in OOXML and ODF parts, and in the body of
text and markup. The vocabulary is distinguished term by term, because the terms do not mean the same
thing: `trainedAlgorithmicMedia` is a generative model, `algorithmicMedia` is a program that is not
necessarily a model, `digitalCapture` is a camera.

When a file declares itself, the report leads with it — a declaration outranks any inference drawn
from a producer string:

```
Produced by  a generative model — the file declares it
             digitalSourceType field (IPTC)
```

### Recognising a program that does not sign its work

Every detection above reads a field that **names** a tool. They find nothing the moment the tool does
not sign itself — and most do not.

A real report examined during this development had `dc:creator` filled with a department name,
`cp:lastModifiedBy` set to "Un-named", and **no tool named anywhere**. It had also, beyond any doubt,
been built by a library. Everything that said so was structural:

| Signal | Why |
|---|---|
| `docProps/app.xml` present but **empty** | Word always fills it: `Application`, `AppVersion`, `Words`, `Characters`, `DocSecurity`. A part created for the OPC schema and never filled is not what an Office application produces |
| Timestamp `…T15:22:28.698Z` | Milliseconds and a `Z`: that is what `Date.prototype.toISOString()` emits in JavaScript. Word writes whole seconds |
| Media named `0ff0d056…98.png` | Forty hex characters, a SHA-1. A library convention; Word writes `image1.png` |
| `word/settings.xml` with no `rsid` | Word always records revision session identifiers |
| `created` == `modified` to the millisecond | Never reopened, never saved again |

Each is weak on its own — a converter can produce one — so **at least two** are required before the
tool says anything. And what it concludes is narrow and checkable:

```
Produced by  no tool is named, but a program assembled this file
             the container has the shape a library leaves, not the one a word processor does.
             What it does not say is which program, or whether a model wrote the words.
```

The control: a `.docx` genuinely saved from Word — `app.xml` filled, `rsid` present, whole seconds —
is not accused, and its summary line answers with the plainest field there is: `Microsoft Office
Word`.

The same reasoning applies to the other two containers, each in its own vocabulary:

- **PDF** — two signals carry weight: a trailer with **no `/ID`** (the format asks for one; Acrobat,
  Word, LibreOffice and pdfTeX all write it) and `created` == `modified` at the same instant. Missing
  XMP and missing accessibility tagging only corroborate, because a file *printed to PDF* from a
  browser has neither — and a person did that. Without at least one weighty signal the tool says
  nothing.
- **ODF** — the cleanest signal of any format: `settings.xml` records window size, cursor position,
  zoom level. **That is the state of somebody's screen.** Nothing writes it but an application that
  had a window. Add the `meta:editing-cycles` counter, the thumbnail and `manifest.rdf`. The point:
  `meta:generator` is free text — a library can write `LibreOffice/7.5` into it and be believed. It
  cannot as easily fake having been open in a window, and the report then says so explicitly:
  *"… despite meta:generator naming LibreOffice/7.5"*.

These **structural** findings survive cleaning by definition: they describe how the file is built,
and a cleaning tool does not rebuild the file. A file cleaned by Cirta therefore keeps reporting
them — that is the honest state of the file, not a failure of the cleaning. The only way to change a
document's shape is to remake it in the application whose shape you want.

And the cleaning is held to the same standard: emptying metadata without removing it would leave a
trace nobody else produces — a present-but-empty `/Info` in a PDF, an empty `<meta:generator/>` in an
ODF. Cirta **removes** those elements rather than blanking them, and reports the "cleaned by somebody
else" shape when it meets it:

```
confirmed  provenance  Metadata has been stripped from this file
```

### What a document is about is not where it came from

A distinction that looks obvious written down, and that was missing.

A report titled "Claude versus ChatGPT: a comparison", typed by hand in Word by a person, was
reported as **attributed to an AI** — because the title was scanned for vendor names exactly like the
producer fields. Writing *about* a tool is not having been written *by* it, and a tool that cannot
tell the difference accuses everyone who covers the subject.

Fields that describe the content — title, subject, description, keywords, category — are no longer
read as tool names. Author fields still are: `dc:creator` set to "Claude Code" is a real attribution,
and a person's name matches nothing there anyway.

What **is still** read in a title: paths, system accounts, session identifiers. A `C:\Users\lotfi\`
path is a leak wherever it sits.

### The direct question: made by an AI, and which one?

Every report opens with a line that answers it, because the answer used to be spread over five rows
of the table that you had to assemble yourself:

```
Produced by  claude-opus-5 (Claude) · Claude / Anthropic · LangChain · ReportLab
             according to the file's own metadata, which can be absent, wrong or forged
```

Three possible answers, and the third matters most:

1. **An assistant, a model or an agent is named** — the line lists them, most specific first, with
   the reminder that it is the file's own metadata making the claim.
2. **Only a library is named** (`ReportLab`, `python-docx`) — a program built the container, which
   says nothing about who wrote the words. The tool says that and goes no further.
3. **Nothing names anything** — and the report says so explicitly instead of staying silent: *that is
   not the same as "not AI"*. The fields may have been cleared, never written, or the text pasted in
   by hand. And the wording itself — where a statistical watermark lives — cannot be read here.

A silent report reads as an acquittal. It is not one.

### Traces of the producing tool

A document produced by an assistant, an agent or a script never announces itself in a single field.
It leaks in pieces: a producer string naming the library, a template path carrying the operating
system and the account name, a working directory under a session identifier. Individually these look
innocuous; cross-referenced, they describe the machine the file was built on.

Cirta does that cross-referencing and says explicitly where each inference came from:

```
confirmed  provenance   Document generated programmatically  python-pptx
                        derived from docProps/app.xml:Application
confirmed  environment  Windows account                      lotfi (drive C:)
                        derived from docProps/app.xml:Template
confirmed  environment  Windows temporary directory          scratch directory
                        derived from docProps/app.xml:Template
```

Recognised:

- **Assistants** — Claude, ChatGPT/OpenAI, Gemini/Vertex, Copilot, Mistral, Llama, Perplexity,
  DeepSeek, Grok/xAI, Qwen, Cohere
- **Coding agents** — Claude Code, Cursor, Windsurf/Codeium, Devin, Aider, Cline, Bolt, v0,
  Replit Agent, Codex, Continue
- **Frameworks and runtimes** — LangChain, LlamaIndex, AutoGen, CrewAI, Haystack, Semantic Kernel,
  Ollama, vLLM, llama.cpp, LM Studio, transformers
- **Model identifiers** — `claude-opus-5`, `gpt-4o-mini`, `gemini-2.0-flash`… more precise than a
  vendor name: they date the generation
- **Call identifiers** — `msg_…`, `chatcmpl-…`, `thread_…`, `run_…`, request and conversation ids
- **Generation libraries** — python-pptx, python-docx, ReportLab, Pandoc, wkhtmltopdf, WeasyPrint,
  Puppeteer, Playwright, Skia, LibreOffice…
- **Environment** — operating system and account name inferred from path shapes, temporary
  directories, session or run identifiers (UUID)

### Depth by format

The analysis does not stop at the known metadata fields.

**PDF — reading page text for real.** A PDF string does not contain Unicode: it contains codes that
mean whatever the font says they mean. And as soon as text carries an accent, the producer embeds a
*subset* font, which numbers its glyphs from 1 in the order it met them. A page showing "Réduire les
flux" then appears in the stream as `<000100020003…>`, and looking for a zero-width space there never
finds anything.

The reverse mapping is in the file: every such font carries a `/ToUnicode` table. Cirta reads it,
follows the `Tf` operator to know which font is active at each moment, and decodes. Measured on a
stealth corpus rendered to PDF with an embedded font: **2067 characters out of 2088 recovered**, and
the 21 missing had never been written — the font had no glyph for them, so they were lost at
generation, not at analysis.

A page whose font carries no `ToUnicode` table is still read as raw codes: there, a hit is real but a
miss proves nothing.

**PDF** — the `/Info` dictionary is open-ended: a generation pipeline can write any key into it, and
those are often the most telling. Every non-standard key is therefore enumerated and reported.
Separately, page text, JavaScript and attachments live in compressed streams: they are decompressed
and the **string operands** decoded — page text is stored in hexadecimal (`<436F6E…>`), so a byte
search over a decompressed stream finds nothing even when the words are there in clear.

**Markdown** — beyond front matter, HTML generator comments and trailing attribution lines
(`*Generated by …*`) are detected. The match is on the **generation phrasing**, not on the publisher
name, and only in the last lines: a signature is in a footer, a mention mid-body is prose.

### Invisible characters in document bodies

A zero-width space in a paragraph survives a copy-paste out of the document exactly as it does in a
text file. The body is therefore scanned in **every** format, not just Office documents:

| Format | Detection | Removal |
|---|---|---|
| DOCX / PPTX / XLSX / ODT | Exact, numeric references included | Yes |
| Markdown | Exact | Yes |
| HTML / SVG | Exact, text between tags only | Yes |
| PDF | **Exact** when the font carries a `ToUnicode` table, which is the case as soon as an accent is present; otherwise reliable for detection, with an absence proving nothing | No — see below |

The report looks like this:

```
confirmed      zero-width space                  2 occurrences
                                                 word/document.xml (U+200B)
confirmed      Hidden payload in document text   tag characters → "ID42"
                                                 word/document.xml
informational  no-break space                    1 occurrence
                                                 word/document.xml (U+00A0)
```

Three points that matter:

- **Numeric references are resolved.** `&#x200B;` is a zero-width space written another way; not
  seeing it would make the check trivial to bypass.
- **Only visible text is touched.** Rewriting operates between `>` and `<`: never tag names, never
  attributes. The XML structure stays intact.
- **Structural parts are ignored.** The same codepoints in a theme or a relationships file are noise,
  not a mark.

Emoji joiners and Persian and Indic non-joiners are preserved in bodies as everywhere else.

**Typographic spaces are kept in documents.** A no-break space before a colon is correct French
typography: normalising it would degrade the document. It is therefore reported as `informational`
and left in place — unlike the Text tab, where cleaning a pasted excerpt does normalise them. The
difference is deliberate.

**The PDF case is weaker, and structurally so.** A PDF string operand contains glyph codes, not
Unicode. With a simple encoding the two coincide, but an embedded subset font maps them arbitrarily
and only its `ToUnicode` table allows the reverse. A hit is therefore real, an absence proves nothing
— the scope note says so. And removal is impossible without rewriting the content stream, so the
report states explicitly what it could not remove:

```
Not removed: zero-width space, Hidden payload in page text.
```

One detail that cost a round trip: many producers write their strings in UTF-16BE **with no byte
order mark**. Read as Latin-1, a zero-width space becomes a space followed by a vertical tab — the
character being looked for, silently destroyed. The presence of a NUL byte, impossible in a real
single-byte string, is therefore used to recognise that shape.

### What a PDF can reveal about its generation

On a PDF produced by a typical LLM pipeline, the report looks like this:

```
confirmed  C2PA content credentials              signed provenance manifest
confirmed  Custom info key: GeneratedBy          anthropic/claude-opus-5
confirmed  Custom info key: RequestId            msg_01XyZaBcDeFgHiJkLmNoPqRs
confirmed  Linux account                         lotfi
confirmed  Session identifier                    session_01ABCdef99
confirmed  Model identifier                      claude-opus-5 (Claude)
confirmed  Coding agent named in metadata        Claude Code
confirmed  Anthropic message id                  msg_01XyZaBcDeFgHiJkLmNoPqRs
probable   Tool credited by the C2PA manifest    claude/1.0 — asserted by the
                                                 manifest, signature not verified
```

The same treatment applies to **every format**, not just PDF. The open-ended part of each format —
the one where a generation pipeline writes whatever it likes — is read with its values:

| Format | Open-ended part read |
|---|---|
| PDF | Every `/Info` key, non-standard included |
| DOCX / PPTX / XLSX | `docProps/custom.xml`, each property with its value |
| ODT / ODS / ODP | `meta:user-defined`, each property with its value |
| Markdown | Every recognised front-matter key |
| SVG / HTML | The `<metadata>` block, `generator` tags, comments |

A key named `Model` says nothing; its value `claude-opus-5` says everything — and only the value
feeds the model inference. The C2PA manifest is read the same way in every container: PDF, Office,
OpenDocument, SVG and images.

**The asymmetry is fundamental and worth keeping in mind.** All of this rests on what the producer
*left behind*. These are traces, not a watermark: a clean generation pipeline — or a pass through
this tool's cleaning — makes all of them disappear. So a hit is solid evidence, and an absence proves
nothing at all.

**The C2PA manifest is read, not verified.** Its presence is a fact about the bytes, hence
`confirmed`. The `claim_generator` inside it is, however, the producer's *assertion*: checking that
it is authentic would mean walking a certificate chain up to the C2PA trust list, which Cirta does
not do. Anyone can write a manifest crediting anyone — hence the `probable` level and the explicit
mention in the value.

### Credentials left in files

An API key forgotten in a generated file is the most serious thing this tool can find. The `sk-ant-`,
`sk-proj-`, `AIza`, `hf_`, `gsk_`, `xai-` and `ghp_` shapes are looked for **in document and archive
bodies**, not only in metadata, and the value is **never printed in full**:

```
confirmed  identity  Credential left in file: Anthropic API key
                     sk-ant-api03-… (52 characters) — rotate this key
                     export/.env
```

The content scan looks **only** for what cannot be innocent prose: credentials, provider-issued
identifiers, API endpoints. Product names are deliberately absent — a document that *talks about*
Claude is not a document *produced by* Claude, and conflating the two is what makes these tools
untrustworthy.

### Reporting levels

Reporting every field at the same weight buries the two lines that matter under a dozen that do not.
Each item therefore carries its own level, and reports are sorted accordingly.

| Level | Meaning | Examples |
|---|---|---|
| `confirmed` | Verbatim identifying data, read directly from a known field | Author, company, manager, a template path containing your session name, custom properties, comment authors, C2PA manifest |
| `probable` | Real information about you or your work, not necessarily sensitive | Title, subject, timestamps, revision number, editing time, thumbnail, `rsid` |
| `informational` | Names the software, not the author | Producing application, version, non-ASCII typographic spaces |

### The three mechanisms Anthropic describes

| Mechanism | Covered |
|---|---|
| Invisible characters | **Yes** — detection, payload decoding, removal |
| C2PA metadata in files | **Yes** for *hard binding* (the manifest in the container). *Soft binding* — a mark in the content itself — is neither detected nor removed |
| Bias in token selection | **No**, and structurally so. Anthropic states that future Claude models carry one (a version of SynthID-Text), under the EU transparency code in force since 2 August 2026; earlier models follow over the coming months. Reading it needs their key, and the announced detection API is not published. Cirta instead reports what a silent report is worth at this length — see below |

## What it does not do, and why

**It does not detect or remove statistical language-model watermarks.**

This class of watermark lives in no erasable field: it is embedded in the **choice of tokens** during
generation. A detector must replay, token by token, the same `(context + secret key)` hash used at
generation, then measure whether the choices lean toward the key's pattern more than chance explains.
Without the key there is no test to run — there is no quantity to measure.

Three published families illustrate the principle: the green lists of
[Kirchenbauer et al. (2023)](https://arxiv.org/abs/2301.10226), Aaronson's Gumbel sampling, and
[SynthID-Text](https://www.nature.com/articles/s41586-024-08025-4) (DeepMind, *Nature* 2024). All are
keyed, all need enough text for statistical power, and none deposits a findable character.

#### "But SynthID is open source, why not use it?"

It has become the right question at the right time. In
["How Claude's text watermark works"](https://www.anthropic.com/news/claude-text-watermark),
Anthropic states that **future Claude models generate watermarked text**, using a *version of
SynthID-Text*, to comply with the EU transparency code that took effect on **2 August 2026**; models
released earlier are in a transition period and follow over the coming months. The algorithm family
is therefore the right one — it is no longer "another vendor's scheme". Two obstacles remain,
verified against DeepMind's official `synthid-text` package rather than from memory.

**1. The keys.** The detector computes *g-values* from a hash of `(token n-gram, key)`. The package
does ship keys — thirty integers in `DEFAULT_WATERMARKING_CONFIG` — but those are **demo keys
published in a public repository**. They detect only text you watermarked yourself with those same
keys: a self-test, not a detector. DeepMind's own README states that the reference hashing function
*"does not provide any guarantees of cryptographic security"* and that the code *"is not intended for
production use"*. Anthropic, for their part, write: *"We will soon be offering a watermark detection
API. We're in the process of working out the details of its implementation."*

**2. The tokens.** The g-values are computed over token identifiers, not characters. That would mean
shipping the model's exact tokenizer — and Cirta is TypeScript running in a tab with no network
calls.

#### A statistical watermark is *not* an invisible character

This is the most widespread confusion, and the press coverage fed it by calling both "invisible".
Anthropic is explicit: **"Nothing is added to the text and there are no hidden characters."**

The consequence for this tool is sharp, and cuts both ways:

- Everything the character-level analysis finds — zero-width spaces, variation selectors, lookalikes
  — **is not Anthropic's watermark**. It is a different mechanism, put there by somebody else: a
  pipeline, a CMS, a tracking tool, or somebody marking you.
- And **removing all of it does not touch the statistical watermark**, which lives in word choice.

Two further points from the same page, which close doors people assume are open:

- The mark **carries no identifying information**: not a person, an organisation or a chat. It does
  not "trace back" to anyone.
- Nor can it say which other model wrote a text: *"it can't tell whether the text was written by a
  different AI"* — another vendor would have another key, possibly another method entirely.

#### A measurement taken from the article: "where can the mark live?"

Length is not the only thing governing detectability, and this is the most usable point on the page.
The watermark rides on choices between **equally good** words — "overcast" or "grey". Where only one
answer is correct, it is not applied: after "Principia…" there is one right word, and `2 + 2 =` has
one right answer. Code is the systematic case: *"code—which in very many cases has to be exact—has
generally less watermarking"*, though the **comments** inside it are ordinary prose and can carry it.

A text's factual density cannot be measured without a model, and inventing a number would be exactly
what this project refuses. **Code can be.** Cirta therefore recognises source and counts:

```
room        Reads as source: 153 non-blank lines, 109 of them comment (71%).
            Anthropic states code carries less watermarking because it has to be exact; the
            mark lives where a choice is free, which here is mostly those comment lines.
```

Two guards. The threshold is high — over a quarter of lines must carry syntax no prose produces —
because calling somebody's letter "source code" would make the whole card wrong; a memo with bullet
lists and a quoted shell command stays prose. And the result is **reported as counts, not folded into
the length band**: mixing the two would produce a number that means neither thing.

#### What a future detector will, and will not, be able to claim

At best: *"how likely is it that Claude was involved in writing this text?"* Not "did a human write
this". Not "which AI". And above all, in Anthropic's words: **"It cannot distinguish 'Claude wrote
this' from 'Claude heavily edited this'."**

Mind the direction of that limit, which is easy to take backwards — I had it backwards myself before
reading the source. A **light proofread leaves the watermark almost nothing to hold on to**: nearly
all the words remain yours, and there are only a handful of corrections where the mark could land. It
is not "your text, proofread, comes back marked"; it is "the more Claude writes, the more room the
mark has". A **translation**, by contrast, is fully watermarked: every word in it is chosen by the
model.

The watermark is also **sparser on factual passages** — after "Principia…" the next word has only one
right answer — and on **code**, where exactness leaves no free choice. It can, however, land in code
**comments**.

A tool that displayed "Claude watermark detected" without those sentences would turn accurate
information into a false accusation. That is the failure mode this project has refused from the
start.

Finally, what exists on the public detection side means **sending the file to the vendor** —
Anthropic announce their own drop-a-file C2PA checker. That is exactly the property this tool refuses
to give up.

Consequently, a local tool — this one included — can neither confirm the presence of such a watermark
nor prove its absence after processing. Cirta does not claim to. Be wary of services that do: without
the key they have no way to verify what they announce, in either direction.

Cleaning the invisible characters out of a text **has no effect** on a statistical watermark.

### Three clarifications from Anthropic, which cut both ways

Anthropic's [documentation](https://support.claude.com/en/articles/16266773-how-claude-marks-ai-generated-content)
sets out three explicit limits, and none of them goes the way you would expect:

1. **A detected mark does not prove authorship.** It indicates the content *may have been processed*
   by the model — not that the model wrote it.
2. **The absence of a mark does not prove human origin.** This is exactly what Cirta's "statistical
   watermark" block exists to say: a silent report on a short text means almost nothing.
3. **Translation and summarising do stamp text of human origin; proofreading barely does.** The
   distinction is fine and I had it inverted before reading the source. A translation is fully
   watermarked — every word is chosen by the model. A **light proofread**, by contrast, leaves almost
   no purchase: nearly all the words remain yours. The rule is "the more the model writes, the more
   room the mark has", not "anything that passes through the model comes back marked".

### What the literature says about mitigation

Paraphrasing is the studied attack, and the research is precise about how well it actually works.
[Krishna et al. (NeurIPS 2023)](https://arxiv.org/abs/2303.13408) drop DetectGPT from 70.3% to 4.6%
detection at 1% false positives with a dedicated paraphraser.
[Sadasivan et al.](https://arxiv.org/abs/2303.11156) drop a watermark's true-positive rate from 99.8%
to 9.7% after five recursive paraphrases, on passages of around 300 tokens.

But the result that matters most for everyday use is the one neither paper states, and which the
follow-up by [Kirchenbauer et al. (ICLR 2024)](https://arxiv.org/abs/2306.04634) establishes:
**paraphrasing dilutes the signal, it does not erase it**. At a 1e-5 false-positive rate, sustained
human paraphrasing still left the watermark detectable after roughly **800 observed tokens**.
Reliability is a function of length: a short excerpt looks clean, a long document accumulates
residual n-grams.

That is why Cirta offers no rewriting layer. It could only produce an unverifiable claim, and the
literature indicates the claim would be false on long documents. For an email you read over and sign,
length is already on your side without any tooling.

Worth watching: [SemStamp](https://aclanthology.org/2024.naacl-long.226/) (NAACL 2024) and
[PostMark](https://aclanthology.org/2024.emnlp-main.506/) (EMNLP 2024) mark at the sentence and
meaning level rather than the token. They are not in production today; if they are, mitigation by
paraphrase becomes markedly harder.

### What can still be said about token bias

No local verdict is possible, and Cirta gives none. But it reports the variable that actually governs
whether such a mark is readable: **length**. Detection is a hypothesis test over token choices, and
its statistical power grows with the number of tokens observed. "We found nothing" therefore does not
mean the same thing at 80 tokens and at 8000 — and a report that does not say which invites the
reader to over-conclude.

```
Statistical watermark  no local verdict is possible
length      ~707-994 tokens (3180 characters, 480 words)
meaning     Long enough for a keyed detector to have some power, short enough
            that the outcome depends on the scheme and the threshold chosen.
```

Three bands, deliberately coarse since the exact cut-off depends on the scheme, the key and the
false-positive rate the verifier chooses:

| Band | What a silent report is worth |
|---|---|
| < 200 tokens | Even the vendor may not get a reliable result; finding nothing means almost nothing |
| 200–800 | A detector holding the key has some power; the outcome depends on the scheme and threshold |
| > 800 | Kirchenbauer et al. (ICLR 2024) observed signal surviving sustained human paraphrasing at 1e-5 false positives |

These are **calibration, not targeting**: they say what a silence is worth, not what length to aim
for. The thresholds are this tool's own choice, not a vendor's published figures — Anthropic give a
direction ("doesn't work well on small samples") but no number, and a "~100 tokens" figure that
circulates in the press coverage is not in their text. Token counts are estimated from character
density, not tokenized — no tokenizer ships with the package — so the count is given as a range.

## What the cleaning does

| Support | Removed | Deliberately kept |
|---|---|---|
| PDF | **Every** `/Info` key (custom included), the XMP `/Metadata` stream, C2PA manifests | Page content |
| PPTX / DOCX / XLSX | `core.xml`, `app.xml`, custom properties, thumbnail, `rsid`, comment author names (`w:author` attribute, `<author>` element, `displayName`), Exif in embedded pictures, C2PA manifests | Local links, hidden slides, speaker notes, defined names and links between workbooks — removing them would turn live cells into `#REF!` |
| ODT / ODS / ODP | `meta.xml`, user-defined properties, statistics, thumbnail, picture Exif, C2PA manifests | The content |
| SVG | The `<metadata>` block, editor attributes and namespaces, generator comments | `<title>` and `<desc>` — what a screen reader announces |
| HTML | `generator`/`author`/`creator`/`copyright`/`date` tags, generator comments | JSON-LD — what a search engine indexes |
| Markdown | Identifying front-matter keys; delimiters removed if nothing is left inside | The body, other keys, attribution lines |
| JPEG | Exif, XMP, IPTC/Photoshop, comments, C2PA JUMBF | JFIF and the ICC profile — removing them would change the rendering |
| PNG | `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME`, C2PA `caBX` | `IHDR`, `PLTE`, `IDAT`, `IEND` |
| Email | Header lines that name a tool: `X-Mailer`, `User-Agent`, `X-Generated-By`, and unknown `X-` headers — the whole line, not its value | `From`, `To`, `Subject`, `Date`, `Message-ID` — they are the message, and threading breaks without them |
| ZIP | **Nothing** — refused | Repacking would change compression, ordering and timestamps of every member |
| Text | Invisible characters, exotic spaces normalised, NFC | Emoji joiners and Persian/Indic non-joiners |
| Document bodies | Invisible characters and their numeric-reference equivalents, in visible text only | XML structure, tag names, attributes, **typographic spaces** |
| PDF bodies | Nothing — reported but not removable without rewriting the content stream | Page text |

### The cleaning is measured, not asserted

Detection and removal can drift apart — a field ends up recognised without being cleared — and that
is the worst defect available here: a report that lists something and then hands back a file still
carrying it. It happened once in this project, with custom `/Info` keys.

Cleaning therefore **re-inspects its own output** and names what survived, instead of trusting the
removal code:

```
Not removed: Anthropic API key. These sit in the document's own content rather
than in a metadata field, and rewriting page text would change what the
document says. Edit the source and regenerate — and if a credential is listed,
rotate it.
```

The corollary is sharp: **when no such warning appears, it is because the re-inspection found
nothing** — not because the code believes it did its job.

### The asymmetry of the two marks

Anthropic's article contrasts the two mechanisms explicitly, and the contrast is useful to anyone
deciding what to clean:

| | Text watermark | C2PA content credential |
|---|---|---|
| Where | In the choice of words | In the file's metadata — *"Nothing in the file changes"* |
| Survives copy-paste | **Yes** | No: copied text leaves the file behind |
| Survives a re-save | Yes | **No** — conversion, resizing, a screenshot strip it without a trace |
| Cirta can read it | No (key) | **Yes** |
| Cirta can remove it | No | **Yes** |

The consequence, which Cirta now states when it removes a manifest: **its absence from a file proves
nothing**. Any pass through an editor erased it, without intent. A check reading "no credential,
therefore not AI" would be wrong about most files in the world.

### On removing C2PA manifests

Removing a C2PA manifest does not make a file "clean" — it makes it **unknown**. A verifier
distinguishes three states: valid manifest (provenance proven), altered manifest (verification fails,
tampering visible), absent manifest (no conclusion). Where C2PA becomes common, absence becomes a
signal in itself. Cirta reports every manifest removal explicitly rather than doing it silently.

A second point, more rarely said: C2PA defines two binding modes. *Hard binding* is the signed
manifest in the container — that is the one Cirta removes, and the removal is verifiable. *Soft
binding* is an imperceptible mark in the content itself, letting a verifier fetch the manifest
remotely. **A removed manifest therefore does not mean no provenance remains.** Cirta says so in its
cleaning report.

## Web interface

Open the [published page](https://k3e9x.github.io/Cirta/), drop a file, read the report, download the
cleaned copy. Processing happens in the tab; nothing is uploaded.

The interface is **bilingual**. It follows the browser's language, a toggle in the header switches it,
and the choice is remembered. Drop several files and a summary bar appears — the same tally as the
CLI's `Summary` line — with a JSON export of the report. That export has exactly the shape
`cirta inspect --json` emits, so a report produced from the page and one produced on the command line
compare without translation. Analysis runs in a *worker*: a large PDF does not freeze the tab, and a
worker is another thread of the same page, not another machine.

The tabs follow ARIA practice: one stop in the tab order, arrow keys (and <kbd>Home</kbd>/<kbd>End</kbd>)
move between them.

To run it locally:

```bash
npm install
npm run dev:web
```

## Command line

Works on **Windows, Linux and macOS**, on Node 20 and 22. CI runs the test suite and an end-to-end
scenario of the binary on all three systems at every commit — portability is verified, not assumed.

```bash
npm install
npm run build
npm link          # makes the `cirta` command available
```

Output is **bilingual**: it follows `LC_ALL`/`LC_MESSAGES`/`LANG`, and `--lang fr|en` overrides. The
default is English, unlike the web page's — a terminal with no locale set is a server or a CI runner,
not somebody expressing a preference.

Platform notes: colour follows `NO_COLOR` and `FORCE_COLOR`; on legacy Windows consoles in a
non-UTF-8 code page, non-ASCII characters in the display are automatically replaced by ASCII
equivalents rather than producing mojibake.

```bash
# Report the metadata carried by files
cirta inspect report.pdf presentation.pptx

# Audit a whole folder before sending — recursive, with a verdict at the end
cirta inspect ./deliverables

# Dependency and build directories are skipped (node_modules, .git, dist, target,
# .venv…), otherwise an ordinary repository drowns the report: on this one,
# 118 of the 125 files found came from node_modules.
cirta inspect . --skip fixtures,vendor

# Text and source files go through the same path
cirta inspect src/

# Write a cleaned copy (report.clean.pdf by default)
cirta redact report.pdf
cirta redact report.pdf -o cleaned.pdf
cirta redact ./deliverables --in-place      # keeps a .bak

# Machine-readable output
cirta inspect report.pdf --json

# Text on standard input
cirta text < draft.txt
cirta text --clean < draft.txt > clean.txt
cirta text --lang fr < draft.txt

# The binary guard refuses a document; --force-text overrides it if you know
# what you are doing (it is deliberately coarse, therefore fallible)
cirta text --force-text < odd.bin

# Clipboard, depending on the system
pbpaste | cirta text --clean | pbcopy                    # macOS
xclip -o -sel clip | cirta text --clean | xclip -i -sel clip   # Linux
Get-Clipboard | cirta text --clean | Set-Clipboard        # Windows
```

## Processing detail

**PDF** — `/Info` dictionary keys are deleted rather than emptied, so no trace remains of which
fields existed; the `/Metadata` stream is removed from the catalog. The document is loaded with
`updateMetadata: false` so the library does not stamp its own modification date and producer name at
save time. Page content is never modified.

**OOXML** — text fields are emptied, date elements removed (an empty `dcterms:created` is not a valid
W3CDTF value). When a whole part is removed — custom properties, thumbnail, C2PA manifest — the
corresponding declaration in `[Content_Types].xml` and the relationship in `_rels/.rels` go too: that
is the usual way a naive cleaner corrupts an Office file. The container is rebuilt with
`[Content_Types].xml` as the first entry.

**Content left in place** — links to local paths, hidden slides, speaker notes, cross-workbook
references and lookalike letters are reported but **never removed**. They are content, not metadata:
removing them would change what the recipient reads. The cleaning report names them explicitly so
the decision stays yours.

**Embedded pictures** — Exif, XMP, IPTC and comments are removed from JPEGs, and the text, timestamp
and Exif chunks from PNGs. The JFIF segment and the ICC colour profile are kept: removing them would
change how the image renders.

**Text** — invisible characters are removed, except where they do legitimate typographic work: emoji
sequence joiners (`👩‍💻`), presentation selectors after a pictographic character, and non-joiners
between two letters, which Persian and Indic orthographies require. Exotic spaces are normalised to
`U+0020`, then the text goes to NFC.

Behind the named list, a net catches the whole Unicode `Cf` category — otherwise every format
character added to the standard would pass unnoticed. That net has its own exceptions, for the
opposite reason: Arabic number signs (`U+0600`–`U+0605`), end-of-ayah marks (`U+06DD`, `U+08E2`), the
Kaithi sign and musical ligature controls are invisible but part of what the document says. Removing
them would be data loss, not cleaning.

**Lookalike letters** — a Cyrillic `а` and a Latin `a` are two codepoints that render identically, so
`pаssword` reads as an ordinary English word and matches nothing. The signal is not the character —
Cyrillic is legitimately full of them — but the *mixture*: a word drawing on two scripts at once.
They are **reported and never replaced**: substituting the "wrong" script is a bet on which half of
the word was intended, and guessing the wrong way damages genuine Cyrillic or Greek text. The
decision stays yours.

### The channels that are not a strange character

A detector working from a blacklist of codepoints finds nothing in a text that contains none — and it
is entirely possible to mark a document without using a single one. Four families are covered for
that reason:

**Normalisation.** `é` is written as one codepoint (U+00E9) or two (`e` + U+0301). Both render
identically, neither is suspicious, and the choice between them is a free bit per accented letter. On
ordinary French text that is about a hundred bits.

The signal is not decomposition but the **mixture**. A fully decomposed file is a Mac: HFS+ stores in
NFD and several toolchains follow. A file containing both forms is a file where something chose,
letter by letter. Hence two distinct levels: `confirmed` for the mixture, `informational` for uniform
NFD.

**Hyphen lookalikes.** U+2010 and U+2011 are pixel-identical to the ASCII `-` in most fonts. En and
em dashes are deliberately absent from the list: they are visibly longer, they are correct
typography, and flagging them would drown the two that really hide.

**Spacing.** One or two spaces after a full stop passes for a typing habit; a trailing space is
invisible in any editor; mixed CRLF and LF line endings carry a bit per line. Again the signal is
irregularity: a document that doubles *all* its spaces follows a convention, a document that
alternates chose sentence by sentence. These channels are **reported and never rewritten** — spacing
belongs to the author.

The CRLF/LF channel only appears on a **file**. A `<textarea>` normalises line endings on read, so
text pasted into the page no longer carries it. The report says so.

**The invisibles the `Cf` category does not cover.** U+3164 HANGUL FILLER is classified as a *letter*
by Unicode and renders empty; U+2800 is a blank braille cell; U+034F is a combining mark. None is a
format character, all look like nothing. The braille cell is kept when surrounded by braille — it is
that script's space — and removed everywhere else.

### Refusing rather than damaging

Two guards exist because silent failure costs more than a refusal.

**A binary file does not enter the text tools.** Running a document through the text cleaner destroys
it: the bytes are decoded at a loss, removal applies to the wreckage, and the result is written back
over the top. Detection rests on a **format signature** (25 headers), then NUL bytes, then control-byte
density. The signature first, because it alone is reliable: a PDF whose streams are uncompressed
contains no NUL and decodes cleanly as UTF-8 — it passed both other tests. Signatures that are also
common words (`OTTO`, `RIFF`) additionally require a binary structure in the first bytes, so a
document beginning with that word is still treated as text.

**An archive is refused on the size it declares**, before any decompression. An 800 KB container can
declare 800 MB; caps applied afterwards bound what is *reported*, not what is *decompressed* — the
memory is already spent. The declared size is the archive's claim and a forged file can lie: this is
a guard, not a proof.

**A write cannot lose the original.** Every output goes through a temporary file in the same
directory then an atomic rename; a symbolic link at the destination is refused rather than followed;
and `--in-place` keeps a `.bak` created before any replacement.

## Development

```bash
npm run verify     # typecheck, tests, build, end-to-end CLI scenario, web build
```

`verify` is the single entry point, and it is exactly what CI runs. The steps are chained with `&&`,
so the first failure stops everything and the exit code propagates — a green terminal and a green
pipeline cannot disagree about what was checked.

The individual steps stay available:

```bash
npm run typecheck
npm test
npm run build      # library + CLI to dist/
npm run build:web  # static site to dist-web/
node scripts/smoke.mjs
```

### The logo

`assets/logo.svg` is the single source of the mark. The site displays it and uses it as a favicon,
the README shows it above, and `src/cli/logo.ts` is a transcription of it into character cells — a
terminal cannot display SVG:

```
  ╭───────╮   cirta
  │  ╭──  │   inspect and strip provenance metadata from documents
  │  ╰──  │
  ╰───────╯   everything runs locally; no network calls are made
```

Two transcriptions exist, because box-drawing characters are not safe everywhere: a legacy Windows
console in a non-UTF-8 code page renders them as mojibake, and a banner that arrives as garbage is
worse than a plain one. The fallback is pure ASCII and the text column stays aligned at the same
offset either way.

### Real files

Every unit fixture is built by hand: that is fast and precise, but a container built here shares the
assumptions of the parser that reads it back. The one genuinely signed image in the suite
(`test/fixtures/signed.jpg`, from c2pa-rs) is what caught the CBOR reader out, when it assumed a
manifest contains no indefinite-length items.

`scripts/real-files.mjs` goes further: LibreOffice produces a document, Cirta cleans it, LibreOffice
reopens the result. Corrupting a Word file is the worst failure available here, and nothing else in
the suite would notice. The first conversion acts as a control — if LibreOffice cannot even produce
the input, the script stops and says so rather than failing, because that proves nothing about the
cleaning. CI runs it on Linux, after `verify`.

```bash
node scripts/real-files.mjs
```

The site's base URL is `/Cirta/` for GitHub Pages; use `CIRTA_BASE=/ npm run build:web` for a custom
domain.

## References

Several ideas come from [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)
(MIT) and its author's article on the four layers of the problem: the classification by reporting
level, recursive folder auditing, refusing binary input in text tools, and the list of containers to
cover. This project does not take up its pixel-domain regeneration layer or its statistical rewriting
layer: both produce claims that cannot be verified locally, and neither applies to PDFs or Office
documents.

Work cited in this README:

1. Kirchenbauer, J., Geiping, J., Wen, Y., Katz, J., Miers, I., & Goldstein, T. (2023).
   [A Watermark for Large Language Models](https://arxiv.org/abs/2301.10226). ICML 2023.
2. Dathathri, S., See, A., Ghaisas, S., Huang, P.-S., et al. (2024).
   [Scalable watermarking for identifying large language model outputs](https://www.nature.com/articles/s41586-024-08025-4)
   (SynthID-Text). *Nature*, 634, 818-823.
3. Kirchenbauer, J., et al. (2024).
   [On the Reliability of Watermarks for Large Language Models](https://arxiv.org/abs/2306.04634). ICLR 2024.
4. Krishna, K., Song, Y., Karpinska, M., Wieting, J., & Iyyer, M. (2023).
   [Paraphrasing evades detectors of AI-generated text, but retrieval is an effective defense](https://arxiv.org/abs/2303.13408).
   NeurIPS 2023.
5. Sadasivan, V. S., Kumar, A., Balasubramanian, S., Wang, W., & Feizi, S. (2023).
   [Can AI-Generated Text be Reliably Detected?](https://arxiv.org/abs/2303.11156)
6. Hou, A. B., et al. (2024). [SemStamp](https://aclanthology.org/2024.naacl-long.226/). NAACL 2024.
7. Chang, Y., et al. (2024). [PostMark](https://aclanthology.org/2024.emnlp-main.506/). EMNLP 2024.
8. Boucher, N., & Anderson, R. (2023).
   [Trojan Source: Invisible Vulnerabilities](https://arxiv.org/abs/2111.00169). IEEE S&P; CVE-2021-42574.
9. Coalition for Content Provenance and Authenticity.
   [C2PA specifications](https://c2pa.org/specifications/).
10. Regulation (EU) 2024/1689 (AI Act),
    [Article 50](https://artificialintelligenceact.eu/article/50/).
11. Anthropic. [How Claude's text watermark works](https://www.anthropic.com/news/claude-text-watermark)
    and [How Claude marks AI-generated content](https://support.claude.com/en/articles/16266773-how-claude-marks-ai-generated-content).

## Licence

MIT.
