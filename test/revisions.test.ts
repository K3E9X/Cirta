import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { inspectPdf, revisionLeaks } from '../src/core/pdf.js';
import { translateLabel, translateLocation, translateValue } from '../src/shared/french.js';
import { incrementalPdf } from './helpers/incremental-pdf.js';

/*
 * `priorRevisions` could already say that earlier versions of a document were
 * still in the file. It could not say what was in them, and a warning a reader
 * cannot act on is one they learn to skip. These cover the part that reads
 * them — and, at least as importantly, the cases where it must stay silent.
 */

const leaks = async (bytes: Uint8Array) =>
  (await inspectPdf(bytes)).findings.filter(
    (finding) => finding.label === 'Text an earlier revision still holds',
  );

describe('text an earlier revision still holds', () => {
  it('[C3] recovers text whose page was pointed at a new stream, leaving the old one orphaned', async () => {
    // The usual shape of an incremental save: the earlier content stream is
    // still defined in the file and referenced by nothing. Read as part of the
    // current document, it made the earlier text look current, and nothing
    // was ever reported lost.
    const pdf = incrementalPdf('Version 1 : salaire propose 85 000 EUR', 'Version 2 : salaire a discuter', {
      newContentsObject: true,
    });
    const found = await leaks(pdf);
    expect(found).toHaveLength(1);
    expect(found[0]?.value).toContain('85 000');
    expect(found[0]?.confidence).toBe('confirmed');
  });

  it('[C3] reports nothing when the orphaned stream says what the current one says', async () => {
    const same = 'Rapport annuel du service juridique';
    expect(await leaks(incrementalPdf(same, same, { newContentsObject: true }))).toEqual([]);
  });

  it('recovers a sentence deleted in a later revision', async () => {
    const secret = 'Salaire de Lotfi Zakaria : 58000 EUR par an';
    const found = await leaks(incrementalPdf(secret, 'Rapport de synthese annuel du service'));
    expect(found).toHaveLength(1);
    expect(found[0]?.confidence).toBe('confirmed');
    expect(found[0]?.value).toContain(secret);
  });

  it('recovers one changed figure, which is the case that matters most', async () => {
    // The first attempt discarded runs under three words to suppress re-flow
    // noise, and so discarded exactly this: one amount, changed and saved.
    const found = await leaks(
      incrementalPdf(
        'Le total du service comptable est de 12 euros pour ce mois',
        'Le total du service comptable est de 99 euros pour ce mois',
      ),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.value).toContain('"12"');
  });

  it('grades one word lower than a phrase, because it is as likely a page number', async () => {
    const [single] = await leaks(
      incrementalPdf(
        'Le total du service comptable est de 12 euros pour ce mois',
        'Le total du service comptable est de 99 euros pour ce mois',
      ),
    );
    expect(single?.confidence).toBe('probable');
  });

  it('shows the surviving words either side, so a reader can judge', async () => {
    const [single] = await leaks(
      incrementalPdf(
        'Le total du service comptable est de 12 euros pour ce mois',
        'Le total du service comptable est de 99 euros pour ce mois',
      ),
    );
    expect(single?.value).toContain('in context:');
    expect(single?.value).toContain('comptable est de 12 euros');
  });

  it('names the revision it came from', async () => {
    const [found] = await leaks(incrementalPdf('Numero de compte FR76 1234 5678', 'Facture acquittee'));
    expect(found?.location).toBe('revision 1');
  });

  /*
   * The controls. A document saved twice with the same words on the page is
   * the common case by far, and a check that fires on it is a check people
   * turn off.
   */
  it('says nothing when the two revisions show the same words', async () => {
    const text = 'Rapport de synthese annuel du service comptable';
    expect(await leaks(incrementalPdf(text, text))).toEqual([]);
  });

  it('says nothing about a file with a single revision', async () => {
    const one = incrementalPdf('Salaire de Lotfi Zakaria : 58000 EUR par an');
    // Same words as the leaking case above, in a file that was never updated.
    expect(new TextDecoder('latin1').decode(one).match(/%%EOF/g)).toHaveLength(1);
    expect(await leaks(one)).toEqual([]);
  });

  it('leaves the text of the current revision alone', async () => {
    // Text still on the page is the current document's business, and every
    // other check already covers it. Only what disappeared belongs here.
    const kept = 'Rapport de synthese annuel du service comptable pour la direction';
    const found = await leaks(incrementalPdf(`${kept} et une ligne supprimee`, kept));
    expect(found).toHaveLength(1);
    expect(found[0]?.value).not.toContain('direction"');
    expect(found[0]?.value).toContain('supprimee');
  });

  it('costs little on a small file', async () => {
    const started = Date.now();
    await leaks(incrementalPdf('Un texte', 'Un autre texte'));
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reads in French, label, location and value alike', async () => {
    // A finding that reports English prose inside a French report is a bug, and
    // this project has shipped that bug twice already.
    const [found] = await leaks(
      incrementalPdf(
        'Le total du service comptable est de 12 euros pour ce mois',
        'Le total du service comptable est de 99 euros pour ce mois',
      ),
    );
    expect(found).toBeDefined();
    expect(translateLabel(found!.label, 'fr')).toBe('Du texte qu\u2019une r\u00e9vision ant\u00e9rieure contient encore');
    expect(translateLocation(found!.location, 'fr')).toBe('r\u00e9vision 1');
    const value = translateValue(found!, 'fr');
    expect(value).toContain('r\u00e9vision ant\u00e9rieure');
    expect(value).not.toMatch(/in an earlier revision|in context/);
  });
});

/*
 * Reading a revision means parsing a prefix of a file a stranger sent, once per
 * revision. pdf-lib costs roughly nine seconds per megabyte on a file whose
 * bytes sit outside any object — that is its own behaviour and predates this
 * code, a single load of such a file already taking over a minute — but opening
 * six more of them would turn a slow read into an unusable one.
 */
describe('cost of reading revisions', () => {
  const cost = async (bytes: Uint8Array): Promise<number> => {
    const started = Date.now();
    await inspectPdf(bytes).catch(() => undefined);
    return Date.now() - started;
  };

  const enc = new TextEncoder();
  const dec = new TextDecoder('latin1');

  /*
   * The bound itself, tested as a decision rather than as a duration. A first
   * version of this test timed a file of filler against a ceiling of eight
   * seconds; it passed here at 4.7 and failed on the Windows runner at 9.6 with
   * the code unchanged, because pdf-lib's speed differs fourfold between
   * machines. It then turned out not to discriminate at all: with the guard it
   * meant to protect switched off, it still passed. Telling the function how
   * long a parse takes makes the outcome the same on every machine.
   */
  it('never opens a revision it predicts would run past the deadline', async () => {
    const bytes = incrementalPdf('Salaire de Lotfi Zakaria : 58000 EUR par an', 'Rapport annuel');
    const doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    });
    // Told the file takes ten seconds to parse, it must not start on a prefix.
    expect(await revisionLeaks(bytes, doc, 10_000)).toEqual([]);
    // Told it is cheap, it reads the prefix and finds the deleted sentence —
    // which is what proves the refusal above was the prediction at work.
    const read = await revisionLeaks(bytes, doc, 1);
    expect(read).toHaveLength(1);
    expect(read[0]?.value).toContain('58000 EUR');
  });

  it('is not fooled into work by a file that is only end markers', async () => {
    expect(await cost(enc.encode(`%PDF-1.7\n${'%%EOF\n'.repeat(20_000)}`))).toBeLessThan(2_000);
  });

  it('bounds a file with far more revisions than it will read', async () => {
    const stacked = enc.encode(dec.decode(incrementalPdf('Secret', 'Public')).repeat(200));
    expect(await cost(stacked)).toBeLessThan(5_000);
  }, 30_000);
});
