import { describe, expect, it } from 'vitest';
import { inspectPdf } from '../src/core/pdf.js';
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

  it('ignores a file that is mostly filler rather than parsing it six times', async () => {
    const base = dec.decode(incrementalPdf('Secret', 'Public'));
    const hostile = enc.encode(`${base}${'x'.repeat(256 * 1024)}\n${'%%EOF\n'.repeat(6)}`);
    /*
     * 256 KB of filler costs pdf-lib around two seconds by itself, so opening
     * the six prefixes as well would land near sixteen. The ceiling sits
     * between the two: high enough that a slow machine does not fail it,
     * low enough that it cannot pass if the prefixes are being read.
     */
    expect(await cost(hostile)).toBeLessThan(8_000);
  }, 40_000);

  it('is not fooled into work by a file that is only end markers', async () => {
    expect(await cost(enc.encode(`%PDF-1.7\n${'%%EOF\n'.repeat(20_000)}`))).toBeLessThan(2_000);
  });

  it('bounds a file with far more revisions than it will read', async () => {
    const stacked = enc.encode(dec.decode(incrementalPdf('Secret', 'Public')).repeat(200));
    expect(await cost(stacked)).toBeLessThan(5_000);
  }, 30_000);
});
