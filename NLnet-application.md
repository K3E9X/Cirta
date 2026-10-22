# NLnet / NGI Zero — application draft for Ciirta

**Deadline: 3 November 2026, 12:00 CEST.** Grants run roughly €5,000–€50,000.

> **Before submitting, verify on nlnet.nl:** this environment could not resolve
> `nlnet.nl`, so the question list below is NGI Zero's historical form, not one
> read from the live page today. Check the exact fields, which of the three new
> programmes under *Open Internet Stack* fits best, and the current budget
> ceiling. Everything marked **[CHECK]** needs your input or confirmation.

---

## 1. Project name

Ciirta

## 2. Website / wiki

https://github.com/k3e9x/Cirta — https://k3e9x.github.io/Cirta/

## 3. Abstract: can you explain the whole project and its expected outcome(s)?

*(NGI Zero historically caps this around 1200 characters. This draft is close to
the limit — trim the last sentence first if the live form is shorter.)*

Documents carry far more about their author than the author intends: the account
name a file was written under, the working directory, the assistant or library
that produced it, invisible Unicode that survives copy-paste, and content the
application presents as deleted while the bytes remain — earlier revisions inside
a PDF, the uncropped original of a cropped photograph, the source rows cached by
a pivot table.

Ciirta inspects and removes these, entirely on the user's own machine. The web
interface makes no network request of any kind; nothing is uploaded. It handles
PDF, Office Open XML, OpenDocument, SVG, HTML, Markdown, email, archives and
images, and reports in English and French.

Its distinguishing property is that it refuses to overstate. Every finding
carries a confidence level, cleaning re-inspects its own output and names what
survived, and the tool says plainly that it cannot read a statistical model
watermark, because reading one requires the vendor's key.

This grant would harden it where it is weakest: the parsers, which consume
untrusted files, have no fuzzing; and C2PA provenance manifests are read
structurally but their signatures are never verified, so every such finding must
say "signature not verified".

## 4. Have you been involved with projects or organisations relevant to this
## project before? And if so, can you tell us a bit about your contributions?

**[CHECK — write this yourself; it must be true and it is the part only you can
write.]** Mention, with specifics:

- your professional role in cybersecurity (SOC / incident response / security
  architecture) and how long;
- any CVE, advisory, public talk, training, CERT/CSIRT involvement or
  contribution to another open-source project;
- that Ciirta is yours and the full development history is public in the
  repository.

NLnet weighs whether the applicant can actually deliver. Concrete evidence of
shipping security work matters more than length here.

## 5. Requested amount

**[CHECK]** Suggested: **€38,000**, itemised below. Adjust to the hours you can
genuinely commit alongside your job — NLnet would rather fund a smaller scope
delivered than a large one slipping.

## 6. Explain what the requested budget will be used for

The project is one developer's time, charged against defined deliverables.
Nothing here is hardware or hosting: the tool has two runtime dependencies and
makes no network calls.

| # | Deliverable | Why it matters | € |
|---|---|---|---|
| 1 | **Fuzzing harness and parser hardening — started.** A dependency-free mutation fuzzer is already in the repository (`scripts/fuzz.mjs`), runs as part of `npm run verify`, and has executed 107,779 inputs across the nine parsers. It found and fixed one crash (a PDF catalog that is not a dictionary, raising a TypeError) and motivated wrapping parse failures in a matchable error type. The grant funds the next stage: **coverage-guided fuzzing** with Jazzer.js, a long-running campaign with a persistent corpus, and fixing everything it surfaces. | The tool is pointed at files from people the user does not trust — the exact threat model in which a parser bug is a vulnerability. Mutation fuzzing has shown the approach pays; coverage guidance is what reaches the deep paths. | 9,000 |
| 2 | **Cryptographic verification of C2PA manifests.** Validate the signature and walk the certificate chain to the C2PA trust list, so a manifest can be reported as *verified* rather than merely *present*. | C2PA is the mechanism the EU AI Act's transparency obligations rest on, and the vendors now shipping it. A reader that cannot check the signature cannot distinguish a genuine credential from one anybody wrote. | 10,000 |
| 3 | **Formats people actually hold.** Legacy OLE2 Office (.doc/.xls/.ppt), HEIC/AVIF and WebP, and MP4/MOV container metadata. | HEIC is the iPhone default and carries GPS. Legacy Office is most of the installed base in public administrations. Neither is covered. | 8,000 |
| 4 | **Independent security review**, and fixing what it finds. | **[CHECK]** NLnet has historically offered grantees a security audit as a service rather than as cash — ask, and move this line if so. | 5,000 |
| 5 | **Accessibility and internationalisation.** WCAG 2.2 AA audit of the web interface, and extending beyond French and English to at least two further languages. | The people most exposed to document metadata are not all English speakers, and the interface is the only part most of them will ever use. | 4,000 |
| 6 | **Documentation and reproducible release.** Signed, reproducible builds; a threat model written down; packaging for Debian/Flathub. | An offline privacy tool that users cannot verify they received intact is asking for trust it has not earned. | 2,000 |
|   | **Total** | | **38,000** |

## 7. Compare your own project with existing or historical efforts

**Commercial metadata cleaners** (Litera, BigHand, Metadact, Draftable Clean)
target corporate email at the gateway, are closed-source, quote-priced, and
largely Windows-and-Outlook shaped. Several process documents server-side.

**ExifTool** is the reference for image and container metadata and is far broader
there, but it is a field-level reader: it does not read the body of an Office
document, decode page text through a PDF font's ToUnicode table, detect invisible
Unicode, or report that a cropped picture still contains what was cropped out.

**mat2** (Metadata Anonymisation Toolkit) is the closest free-software
equivalent and a genuine influence. It removes metadata well. It does not
attempt detection the user can reason about: there are no confidence levels, no
re-inspection of the output, and no account of what was deliberately left alone.

**AI-detection services** claim what no local tool can support. OpenAI withdrew
its own text classifier at 26% true positives; Liang et al. (2023) found
detectors flagging 61% of TOEFL essays by non-native writers as machine-written.
Ciirta deliberately produces no authorship verdict and documents why.

What is new here is the combination: local-only, honest about its limits by
construction, and willing to look at the places a document keeps what it claims
to have removed.

## 8. What are significant technical challenges you expect to solve?

- **Fuzzing a pure-TypeScript parser surface.** Coverage-guided fuzzers target
  native code; driving them through a JS harness with useful coverage feedback,
  fast enough to be worth running continuously, is the real work.
- **C2PA trust-list validation offline.** Walking a certificate chain to the C2PA
  trust list without a network call means shipping and ageing the trust list
  responsibly, and saying clearly what an expired or unknown anchor means.
- **OLE2 compound files.** A second container model entirely, with its own
  allocation tables — and the property streams that matter are
  `SummaryInformation` and `DocumentSummaryInformation`.
- **Knowing when not to answer.** The hardest decisions in this codebase have
  been refusals: no AI-authorship score, no brand list for homograph detection,
  no ASCII lookalike substitutions. Each would have produced a confident number
  that could not be defended.

## 9. Describe the ecosystem of the project, and how you will engage with
## relevant actors and promote the outcomes

**[CHECK — adapt to commitments you will actually keep.]**

- Everything stays MIT, developed in the open, with the history already public.
- Upstream contact with the **C2PA / Content Authenticity Initiative** on the
  verification work, and with **mat2** maintainers, whose work overlaps and
  whose users would benefit from the detection side.
- Distribution to the people who need it: journalists and their security
  trainers, DPOs, CERT/CSIRT teams. **[CHECK — name the ones you can really
  reach.]**
- Packaging for Debian and Flathub so installation is not a Node toolchain.
- Write-ups of each finding class, since the most useful outcome is that other
  tools adopt the checks — earlier PDF revisions and cropped-image retention
  are not Ciirta-specific problems.

---

## What to do before 3 November

1. Read the live form on nlnet.nl and the scope of the three new programmes.
2. Write §4 yourself. It is the only section nobody can draft for you.
3. Decide the amount against hours you will really have, and cut scope rather
   than stretch the timeline.
4. Confirm whether the security audit is cash or a service, and move line 4.
5. Trim §3 to the live character limit.
