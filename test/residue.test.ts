import { describe, expect, it } from 'vitest';
import { findResidue, removeScaffolding, stripMarkdownResidue } from '../src/core/residue.js';
import { cleanPlainText, inspectPlainText } from '../src/core/plaintext.js';
import { provenance } from '../src/core/fingerprint.js';
import { translateLabel, translateLocation } from '../src/shared/french.js';

/*
 * What an assistant's answer leaves in an email pasted from it: lines it
 * addressed to whoever asked for the draft, placeholders the template expected
 * someone to fill, and Markdown only a chat window renders.
 */

const DRAFT = [
  "Bien sûr ! Voici une proposition d'e-mail pour relancer Marie :",
  '',
  '---',
  '',
  '**Objet : Relance facture n°2024-118**',
  '',
  'Bonjour Marie,',
  '',
  'La facture **n°2024-118** reste due. Le détail est sur [notre portail](https://portail.exemple.fr).',
  '',
  'Cordialement,',
  '[Votre nom]',
  '',
  '---',
  '',
  "N'hésitez pas à me dire si vous souhaitez que j'ajuste le ton ou que je le rende plus formel.",
  '',
].join('\n');

const labels = (text: string) => findResidue(text).map((f) => f.label);

describe('lines an assistant addressed to you', () => {
  it('finds the opener before the greeting and the offer after the signature', () => {
    const found = findResidue(DRAFT).filter((f) => f.label === 'Written to you, not to the recipient');
    expect(found.map((f) => f.location)).toEqual(['line 1', 'line 16']);
    expect(found.every((f) => f.confidence === 'confirmed')).toBe(true);
  });

  it('finds them in English too', () => {
    const text = "Sure! Here's a draft you can send:\n\nHi Tom,\n\nThe invoice is overdue.\n\nBest,\nAnna\n\nLet me know if you'd like me to make it more formal.";
    const found = findResidue(text).filter((f) => f.label === 'Written to you, not to the recipient');
    expect(found.map((f) => f.location)).toEqual(['line 1', 'line 10']);
  });

  /*
   * The controls decide whether this is usable. Each of these opens or closes
   * with the same words an assistant uses, in a position where a person uses
   * them too.
   */
  it.each([
    ['opens with "Voici" after the greeting', 'Bonjour Paul,\n\nVoici le rapport demandé.\n\nCordialement,\nLotfi'],
    ['answers "Bien sûr" inside the letter', 'Bonjour Paul,\n\nBien sûr, je serai présent jeudi.\n\nCordialement,\nLotfi'],
    ['closes with an ordinary offer to help', "Bonjour,\n\nLe dossier est joint.\nN'hésitez pas à me contacter si besoin.\n\nCordialement,\nLotfi"],
    ['opens with "Voici" and no greeting', 'Voici le compte rendu de la réunion.\nTrois décisions ont été prises.'],
    ['says "Let me know" to its reader', 'Hi team,\n\nHere is the agenda.\nLet me know if you can join.\n\nBest,\nAnna'],
  ])('says nothing about a real email that %s', (_name, text) => {
    expect(labels(text)).not.toContain('Written to you, not to the recipient');
  });
});

describe('placeholders and repeated subject lines', () => {
  it('finds an unfilled placeholder, which must never leave', () => {
    const found = findResidue(DRAFT).filter((f) => f.label === 'Template placeholder left unfilled');
    expect(found.map((f) => f.value)).toEqual(['[Votre nom]']);
  });

  it('does not take ordinary brackets or a link label for a placeholder', () => {
    expect(labels('Voir [1], [PDF] et [sic]. Le [lien](https://exemple.fr) aussi.')).not.toContain(
      'Template placeholder left unfilled',
    );
  });

  it('notices the subject line pasted into the body', () => {
    expect(labels(DRAFT)).toContain('Subject line repeated in the body');
  });
});

describe('Markdown only a chat window renders', () => {
  it('removes bold, headings, links, code and fences, and keeps their text', () => {
    const { text, removed } = stripMarkdownResidue(
      '## Point\n\nLa **facture** est sur [le portail](https://ex.fr). Lancez `npm test`.\n```\ncode\n```\n',
    );
    expect(text).toBe('Point\n\nLa facture est sur le portail (https://ex.fr). Lancez npm test.\ncode\n');
    expect(removed).toContain('**…**');
  });

  it.each([
    ['snake_case names', 'Le fichier config_prod_v2.yaml est joint.'],
    ['arithmetic', 'Le calcul 2*3*4 donne 24.'],
    ['an asterisk bullet', '* premier point\n* second point'],
  ])('leaves %s alone', (_name, text) => {
    expect(stripMarkdownResidue(text).text).toBe(text);
  });

  it('leaves a real Markdown document alone, and says so', () => {
    const readme = '# Titre\n\n## Installation\n\n```\nnpm i\n```\n\n## Usage\n\n**Important** : lire.\n';
    const result = stripMarkdownResidue(readme);
    expect(result.keptAsDocument).toBe(true);
    expect(result.text).toBe(readme);
  });
});

describe('removing the lines on request', () => {
  it('takes out the lines and the separators that framed the draft, and nothing else', () => {
    const { text, removed } = removeScaffolding(stripMarkdownResidue(DRAFT).text);
    expect(removed).toHaveLength(2);
    expect(text.startsWith('Objet : Relance facture')).toBe(true);
    expect(text.trimEnd().endsWith('[Votre nom]')).toBe(true);
    expect(text).not.toContain('---');
    expect(text).toContain('La facture n°2024-118 reste due.');
  });

  it('leaves a real email untouched', () => {
    const real = 'Bonjour Paul,\n\nVoici le rapport demandé.\n\nCordialement,\nLotfi\n';
    expect(removeScaffolding(real)).toEqual({ text: real, removed: [] });
  });
});

describe('one clean for every surface', () => {
  it('removes Markdown and tool headers, and leaves words for you to review', () => {
    const result = cleanPlainText(DRAFT);
    expect(result.text).not.toContain('**');
    expect(result.markdownRemoved).not.toBe('');
    expect(result.toReview.map((f) => f.label)).toEqual([
      'Written to you, not to the recipient',
      'Written to you, not to the recipient',
      'Template placeholder left unfilled',
    ]);
    // Words are never taken out by the clean itself.
    expect(result.text).toContain('Voici une proposition');
  });

  it('is what inspection reports, and the summary stops calling the wording silent', () => {
    const found = inspectPlainText(DRAFT);
    expect(found.some((f) => f.label === 'Written to you, not to the recipient')).toBe(true);
    expect(provenance(found).assistantVoice).toBe(true);
    expect(provenance(inspectPlainText('Bonjour Paul,\n\nVoici le rapport.\n\nCordialement')).assistantVoice).toBe(false);
  });

  it('reads in French', () => {
    expect(translateLabel('Written to you, not to the recipient', 'fr')).toBe('Adressé à vous, pas au destinataire');
    expect(translateLocation('line 12', 'fr')).toBe('ligne 12');
    expect(translateLocation('text formatting', 'fr')).toBe('mise en forme du texte');
  });
});

/*
 * This runs on text pasted by a stranger as much as on your own drafts, and a
 * pattern that backtracks is a way to hang the page. Nothing here may be
 * worse than linear.
 */
describe('cost on hostile input', () => {
  const cost = (text: string): number => {
    const started = Date.now();
    findResidue(text);
    stripMarkdownResidue(text);
    removeScaffolding(text);
    return Date.now() - started;
  };

  it.each([
    ['a long run of asterisks', '*'.repeat(50_000)],
    ['unclosed bold markers', '**a '.repeat(20_000)],
    ['an unclosed bracket', '[' + 'x'.repeat(50_000)],
    ['backticks', '`'.repeat(50_000)],
    ['a document-sized draft', DRAFT.repeat(400)],
  ])('stays fast on %s', (_name, text) => {
    expect(cost(text)).toBeLessThan(500);
  });
});

describe('[F-2.8] Markdown links in linear time', () => {
  it('reads a line of a hundred thousand brackets in well under a second, and still finds a link', () => {
    const line = `${'['.repeat(100_000)}${']'.repeat(100_000)} [docs](https://exemple.fr/a)`;
    const started = Date.now();
    inspectPlainText(line);
    const stripped = stripMarkdownResidue(`Voir [docs](https://exemple.fr/a) et [[x]](https://exemple.fr/b).`);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(stripped.text).toContain('docs (https://exemple.fr/a)');
  });
});
