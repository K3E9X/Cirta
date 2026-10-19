import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectFile, type Finding } from '../src/core/index.js';

/*
 * [C10.5] Speaker notes and hidden slides were counted — "1 slide with
 * presenter notes" — but what they say was not shown, though it is what the
 * recipient of the file can read and the presenter never meant to send.
 * Quoted now, the way an earlier PDF revision's text is.
 */

const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const para = (...texts: string[]) => `<a:p>${texts.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join('')}</a:p>`;
const shape = (ph: string, ...paragraphs: string[]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="S"/><p:cNvSpPr/><p:nvPr><p:ph type="${ph}"/></p:nvPr></p:nvSpPr><p:txBody>${paragraphs.join('')}</p:txBody></p:sp>`;

const deck = zipSync({
  '[Content_Types].xml': strToU8('<Types/>'),
  'ppt/presentation.xml': strToU8(`<p:presentation ${A}/>`),
  'ppt/slides/slide1.xml': strToU8(`<p:sld ${A}><p:cSld><p:spTree>${shape('title', para('Résultats'))}</p:spTree></p:cSld></p:sld>`),
  'ppt/slides/slide2.xml': strToU8(
    `<p:sld ${A} show="0"><p:cSld><p:spTree>${shape('title', para('Marge réelle'))}${shape('body', para('Prix plancher : ', '42 k€'))}</p:spTree></p:cSld></p:sld>`,
  ),
  'ppt/notesSlides/notesSlide1.xml': strToU8(
    `<p:notes ${A}><p:cSld><p:spTree>${shape('body', para('Ne pas montrer au client.'), para('Le concurrent est à 38 k€.'))}${shape('sldNum', para('1'))}</p:spTree></p:cSld></p:notes>`,
  ),
});

const all = (findings: Finding[], label: string) => findings.filter((f) => f.label === label);

describe('[C10.5] what notes and hidden slides say', () => {
  it('quotes each hidden slide', async () => {
    const { findings } = await inspectFile(deck, 'deck.pptx');
    expect(all(findings, 'Text of a hidden slide')).toEqual([
      expect.objectContaining({ location: 'ppt/slides/slide2.xml', value: 'Marge réelle / Prix plancher : 42 k€', confidence: 'probable' }),
    ]);
  });

  it('quotes each slide’s notes, without the slide number', async () => {
    const { findings } = await inspectFile(deck, 'deck.pptx');
    expect(all(findings, 'Speaker notes text')).toEqual([
      expect.objectContaining({ location: 'ppt/notesSlides/notesSlide1.xml', value: 'Ne pas montrer au client. / Le concurrent est à 38 k€.' }),
    ]);
  });

  it('keeps the counts', async () => {
    const { findings } = await inspectFile(deck, 'deck.pptx');
    expect(all(findings, 'Hidden slides')).toHaveLength(1);
    expect(all(findings, 'Speaker notes')).toHaveLength(1);
  });
});
