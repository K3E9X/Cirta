import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { inspectFile } from '../src/core/index.js';
import { parseRules, ruleFindings, RulesError } from '../src/core/rules.js';

/*
 * [F-2.3] An organisation's own vocabulary: internal project names, its
 * private domains, its identifier prefixes. Written once in a rules file —
 * YAML or JSON — each with a label and a level.
 */

const YAML = `
# Règles de l'équipe
rules:
  - id: projets
    label: Nom de projet interne
    level: confirmed
    words: [Orion, "Pégase"]
  - id: domaine
    label: Domaine interne
    level: probable
    pattern: '[a-z0-9-]+\\.corp\\.exemple'
    flags: i
  - id: dossier
    label: Référence de dossier
    pattern: "DOS-\\d{6}"
`;

describe('[F-2.3] organisation rules', () => {
  it('reads a YAML rules file', () => {
    const rules = parseRules(YAML);
    expect(rules.map((r) => [r.id, r.label, r.level])).toEqual([
      ['projets', 'Nom de projet interne', 'confirmed'],
      ['domaine', 'Domaine interne', 'probable'],
      ['dossier', 'Référence de dossier', 'probable'],
    ]);
  });

  it('reads the same rules as JSON', () => {
    const json = JSON.stringify({ rules: [{ id: 'p', label: 'Projet', level: 'confirmed', words: ['Orion'] }] });
    expect(parseRules(json)[0]).toMatchObject({ id: 'p', words: ['Orion'] });
  });

  it('refuses a file it cannot read, saying where', () => {
    expect(() => parseRules('rules:\n  - id: x\n    level: urgent\n    words: [a]\n')).toThrow(RulesError);
    expect(() => parseRules('rules:\n  - id: x\n    label: X\n    pattern: "(unclosed"\n')).toThrow(/rule x/);
    expect(() => parseRules('rules:\n  - id: x\n    label: X\n')).toThrow(/words or a pattern/);
  });

  it('matches whole words, any case, and patterns, with their label and level', () => {
    const found = ruleFindings('Le projet orion part sur srv-01.corp.exemple (DOS-123456). Orionide ne compte pas.', parseRules(YAML), 'document body');
    expect(found.map((f) => [f.label, f.value, f.confidence])).toEqual([
      ['Nom de projet interne', 'orion', 'confirmed'],
      ['Domaine interne', 'srv-01.corp.exemple', 'probable'],
      ['Référence de dossier', 'DOS-123456', 'probable'],
    ]);
  });

  it('reads the body and the metadata of a document', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'docProps/core.xml': strToU8('<cp:coreProperties xmlns:cp="c" xmlns:dc="d"><dc:title>Lancement Pégase</dc:title></cp:coreProperties>'),
      'word/document.xml': strToU8(`<w:document ${W}><w:body><w:p><w:r><w:t>Dossier DOS-654321</w:t></w:r></w:p></w:body></w:document>`),
    });
    const { findings } = await inspectFile(docx, 'note.docx', { rules: parseRules(YAML) });
    expect(findings.find((f) => f.label === 'Nom de projet interne')).toMatchObject({ value: 'Pégase', location: 'docProps/core.xml:dc:title' });
    expect(findings.find((f) => f.label === 'Référence de dossier')).toMatchObject({ value: 'DOS-654321', location: 'document body' });
  });
});
