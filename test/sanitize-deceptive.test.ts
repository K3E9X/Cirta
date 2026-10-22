import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeForLlm } from '../src/core/sanitize.js';
import { runCli } from './helpers/cli.js';

/*
 * [R7] sanitize-for-llm handed a model « https://paypal.com/login » from a
 * link that goes to a lookalike domain, and said nothing: the model reads it
 * as the destination. The text now carries the real target, the JSON lists
 * the links, stderr says so, and --fail-on-deceptive-links stops a pipeline.
 */

const enc = (text: string) => new TextEncoder().encode(text);
const PAGE = '<p>Connectez-vous : <a href="https://раураl.com/login">https://paypal.com/login</a></p><p>Aide : <a href="https://exemple.fr/aide">https://exemple.fr/aide</a></p>';

describe('[R7] deceptive links in the text for a model', () => {
  it('HTML: the shown address is followed by where the link goes', async () => {
    const result = await sanitizeForLlm(enc(PAGE), 'page.html');
    expect(result.text).toContain('https://paypal.com/login [→ https://xn--l-7sba6dbr.com/login]');
    expect(result.text).toContain('https://exemple.fr/aide');
    expect(result.text).not.toContain('exemple.fr/aide [→');
    expect(result.deceptiveLinks).toEqual([{ shown: 'https://paypal.com/login', target: 'https://xn--l-7sba6dbr.com/login' }]);
  });

  it('plain text: an address in lookalike letters is followed by its punycode', async () => {
    const result = await sanitizeForLlm(enc('Payez sur https://pаypal.com/login avant vendredi.'), 'note.txt');
    expect(result.text).toBe('Payez sur https://pаypal.com/login [→ https://xn--pypal-4ve.com/login] avant vendredi.');
  });

  it('Markdown and a mail’s HTML part', async () => {
    const md = await sanitizeForLlm(enc('[https://paypal.com/login](https://evil.example/login)\n'), 'notes.md');
    expect(md.deceptiveLinks).toEqual([{ shown: 'https://paypal.com/login', target: 'https://evil.example/login' }]);
    const mail =
      'From: a@exemple.fr\r\nSubject: Compte\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n' + PAGE + '\r\n';
    const eml = await sanitizeForLlm(enc(mail), 'compte.eml');
    expect(eml.text).toContain('https://paypal.com/login [→ https://xn--l-7sba6dbr.com/login]');
  });

  it('nothing to mark in an honest page', async () => {
    const result = await sanitizeForLlm(enc('<a href="https://exemple.fr/">https://exemple.fr/</a>'), 'page.html');
    expect(result.deceptiveLinks).toEqual([]);
  });
});

describe('[R7] from the command line', () => {
  const file = () => {
    const d = mkdtempSync(join(tmpdir(), 'cirta-r7-'));
    writeFileSync(join(d, 'page.html'), PAGE);
    return join(d, 'page.html');
  };

  it('stdout carries the target, stderr warns, in text and in JSON; --fail-on-deceptive-links exits 1', () => {
    const page = file();
    const text = runCli(['sanitize-for-llm', '--lang', 'fr', page]);
    expect(text.status).toBe(0);
    expect(text.stdout.toString()).toContain('https://paypal.com/login [→ https://xn--l-7sba6dbr.com/login]');
    expect(text.stderr.toString()).toContain('lien trompeur — affiche https://paypal.com/login, mène à https://xn--l-7sba6dbr.com/login');
    const json = runCli(['sanitize-for-llm', '--json', page]);
    expect(JSON.parse(json.stdout.toString())[0].deceptiveLinks).toEqual([{ shown: 'https://paypal.com/login', target: 'https://xn--l-7sba6dbr.com/login' }]);
    expect(json.stderr.toString()).toContain('deceptive link');
    expect(runCli(['sanitize-for-llm', '--fail-on-deceptive-links', page]).status).toBe(1);
  });
});
