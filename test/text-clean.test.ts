import { describe, expect, it } from 'vitest';
import { cleanPlainText } from '../src/core/index.js';
import { runCli as run } from './helpers/cli.js';

const runCli = (args: string[], { input }: { input: string }) => {
  const result = run(args, new TextEncoder().encode(input));
  return { status: result.status, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
};

/*
 * [C8] `ciirta text --clean` and the page's "Clean" button turned every
 * no-break space into an ordinary one — "14 h :" lost the spaces French
 * typography puts there, though they were only ever reported as
 * informational. Content changes went unannounced, and nothing was said of
 * what the clean left behind. Now: only what is confirmed or probable is
 * removed, every transformation is counted, and what survives is named.
 */

const NBSP = ' ';
const NNBSP = ' ';

// Typography, scripts and emoji that are all legitimate: nothing here is more
// than informational, so nothing here may change.
const FRENCH =
  `Bonjour${NNBSP}! Le rendez-vous est à 14${NBSP}h${NBSP}: merci de confirmer${NNBSP}?\n` +
  `«${NBSP}Citation française${NBSP}» — avec des guillemets.\n` +
  'Famille : 👨‍👩‍👧 et cœur ❤️ et drapeau 🇫🇷\n' +
  'Arabe : مرحبا بك — hébreu : שלום\n' +
  'Nom russe : Петров Иван\n';

describe('[C8] cleaning keeps what is only informational', () => {
  it('leaves typographed French text identical, byte for byte', () => {
    expect(cleanPlainText(FRENCH).text).toBe(FRENCH);
  });

  it('leaves it identical from the command line too', () => {
    const run = runCli(['text', '--clean'], { input: FRENCH });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(FRENCH);
  });

  it('says the no-break spaces were kept, and how to replace them', () => {
    const result = cleanPlainText(FRENCH);
    expect(result.spacesKept).toBe(6);
    const run = runCli(['text', '--clean', '--lang', 'en'], { input: FRENCH });
    expect(run.stderr).toContain('--normalize-spaces');
  });

  it('replaces them only when asked, and counts them', () => {
    const result = cleanPlainText(FRENCH, { normalizeSpaces: true });
    expect(result.text).not.toMatch(/[  ]/);
    expect(result.spacesReplaced).toBe(6);
    const run = runCli(['text', '--clean', '--normalize-spaces', '--lang', 'en'], { input: FRENCH });
    expect(run.stdout).not.toMatch(/[  ]/);
    expect(run.stderr).toMatch(/6 .*spaces? replaced/);
  });

  it('leaves uniformly decomposed text decomposed', () => {
    const nfd = 'Accent de\u0301compose\u0301 : cafe\u0301 et the\u0301\n';
    expect(cleanPlainText(nfd).text).toBe(nfd);
  });

  it('still removes what is confirmed', () => {
    expect(cleanPlainText(`Bon​jour${NBSP}!`).text).toBe(`Bonjour${NBSP}!`);
  });
});

describe('[C8] every transformation is announced, with a count', () => {
  it('counts the letters recomposed when forms were mixed', () => {
    const mixed = 'café, cafe\u0301, the\u0301, thé, réseau, re\u0301seau, ide\u0301e\n';
    const result = cleanPlainText(mixed);
    expect(result.text).toBe(mixed.normalize('NFC'));
    expect(result.recomposed).toBe(4);
    const run = runCli(['text', '--clean', '--lang', 'en'], { input: mixed });
    expect(run.stderr).toMatch(/4 .*recomposed/);
  });

  it('announces Markdown taken out, by symbol and count, even when stderr is not a terminal', () => {
    const run = runCli(['text', '--clean', '--lang', 'en'], { input: 'Bonjour,\n\n**Objet** : la réunion de demain.\n' });
    expect(run.stdout).toContain('Objet : la réunion');
    expect(run.stderr).toMatch(/Markdown removed — \*\*…\*\* ×1/);
  });
});

describe('[C8] what survives the clean is named', () => {
  const TRAPPED =
    'Bonjour,\n\nConnectez-vous sur https://аррӏе.com pour valider.\n' +
    'Clé : sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n\n' +
    'Souhaitez-vous que j’ajuste le ton ?\n';

  it('lists the lookalike domain, the secret and the assistant’s line', () => {
    const labels = cleanPlainText(TRAPPED).survivors.map((f) => f.label);
    expect(labels).toContain('Written to you, not to the recipient');
    expect(labels.some((label) => label.includes('Anthropic API key'))).toBe(true);
    expect(labels.some((label) => /lookalike|alphabet/i.test(label))).toBe(true);
  });

  it('prints them under one heading from the command line', () => {
    const run = runCli(['text', '--clean', '--lang', 'fr'], { input: TRAPPED });
    expect(run.stderr).toMatch(/toujours dans le texte nettoyé/i);
    expect(run.stderr).toContain('sk-ant');
  });
});

describe('[C8] cleaning a text file', () => {
  it('leaves typographed French identical and says the spaces were kept', async () => {
    const { redactFile } = await import('../src/core/index.js');
    const result = await redactFile(new TextEncoder().encode(FRENCH), 'lettre.txt');
    expect(new TextDecoder().decode(result.data)).toBe(FRENCH);
    expect(result.notes).toContainEqual({ code: 'kept:typographic-spaces', detail: '6' });
  });

  it('announces letters recomposed when forms were mixed', async () => {
    const { redactFile } = await import('../src/core/index.js');
    const mixed = 'café, café, thé, thé, réseau, réseau, idée\n';
    const result = await redactFile(new TextEncoder().encode(mixed), 'note.txt');
    expect(result.notes).toContainEqual({ code: 'changed:nfc', detail: '4' });
  });
});
