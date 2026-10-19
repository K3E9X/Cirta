import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const PAPER = String.raw`\documentclass{article}
\usepackage{hyperref,comment}
\hypersetup{pdfauthor={Jeanne Dupont}, pdfcreator={LaTeX with hyperref}}
% TODO relire avec Marc avant envoi au comité
\title{Rapport\thanks{Financé par le contrat ANR-24-1234, jeanne.dupont@labo.fr}}
\author{Jeanne Dupont \and Marc Leroy}
\begin{document}
\maketitle
Le taux est de 12\,\% cette année.% chiffre provisoire, ne pas citer
\input{/home/jdupont/these/chapitres/intro}
\includegraphics{C:/Users/jdupont/Pictures/figure1.png}
\url{https://exemple.fr/a%20b}
\verb|50% verbatim|
\begin{verbatim}
% pas un commentaire
\end{verbatim}
\begin{comment}
Version précédente : budget de 1,2 M€ refusé.
\end{comment}
Bon\u200bjour.
\end{document}
`.replace('\\u200b', '\u200b');

describe('[F-P2 2.2] LaTeX', () => {
  it('is told by its preamble or its extension', () => {
    expect(detectFormat(enc(PAPER))).toBe('latex');
    expect(detectFormat(enc('Bonjour % pas un commentaire ici ?\n\\section{A}\n'), 'chapitre.tex')).toBe('latex');
  });

  it('reports comments, the author and thanks, PDF metadata set from the source, and local paths', async () => {
    const result = await inspectFile(enc(PAPER), 'rapport.tex');
    expect(result.format).toBe('latex');
    const f = result.findings;
    const values = (label: string) => f.filter((x) => x.label === label).map((x) => x.value);
    expect(values('LaTeX comment')).toEqual(['TODO relire avec Marc avant envoi au comité', 'chiffre provisoire, ne pas citer']);
    expect(values('Text in a comment environment')).toEqual(['Version précédente : budget de 1,2 M€ refusé.']);
    expect(values('Author')).toEqual(['Jeanne Dupont \\and Marc Leroy']);
    expect(values('PDF author set by the source')).toEqual(['Jeanne Dupont']);
    expect(values('Acknowledgement note (\\thanks)')).toEqual(['Financé par le contrat ANR-24-1234, jeanne.dupont@labo.fr']);
    expect(values('Local path in the source')).toEqual(['/home/jdupont/these/chapitres/intro', 'C:/Users/jdupont/Pictures/figure1.png']);
    expect(values('Linux account')).toEqual(['jdupont']);
    expect(f.some((x) => x.kind === 'invisible-character')).toBe(true);
  });

  it('cleans comments without changing what LaTeX typesets, and names what is the document’s own', async () => {
    const result = await redactFile(enc(PAPER), 'rapport.tex');
    const text = dec(result.data!);
    expect(text).not.toMatch(/TODO|provisoire|budget/);
    // The % stays: at a line end it swallows the newline, and taking it out would add a space.
    expect(text).toContain('Le taux est de 12\\,\\% cette année.%\n');
    expect(text).toContain('\\url{https://exemple.fr/a%20b}');
    expect(text).toContain('\\verb|50% verbatim|');
    expect(text).toContain('% pas un commentaire');
    expect(text).toContain('\\begin{comment}\n\\end{comment}');
    expect(text).toContain('Bonjour.');
    expect((result.kept ?? []).map((x) => x.label)).toEqual(expect.arrayContaining(['Author', 'Local path in the source']));
  });
});
