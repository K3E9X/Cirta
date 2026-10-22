import { describe, expect, it } from 'vitest';
import { runCli } from './helpers/cli.js';

/*
 * [R8.1] The Scope paragraph of --help said the tool handled metadata and
 * invisible Unicode — true of version 0.1. It now says what the tool reads,
 * and what it cannot, in five lines at most, in both languages.
 */

const scope = (args: string[], title: string) => {
  const help = runCli(args).stdout.toString();
  const lines = help.split('\n');
  const at = lines.indexOf(title);
  expect(at).toBeGreaterThan(0);
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith('  ')) break;
    body.push(line);
  }
  return body;
};

describe('[R8.1] the Scope paragraph of --help', () => {
  it('in English, five lines at most, naming hidden text, active content and the watermark it cannot see', () => {
    const body = scope(['--lang', 'en', '--help'], 'Scope');
    expect(body.length).toBeLessThanOrEqual(5);
    const text = body.join(' ');
    expect(text).toMatch(/hidden text/);
    expect(text).toMatch(/active\s+content/);
    expect(text).toMatch(/watermark/);
    expect(text).not.toMatch(/Office docProps\)/);
  });

  it('in French with --lang fr, the same', () => {
    const body = scope(['--lang', 'fr', '--help'], 'Portée');
    expect(body.length).toBeLessThanOrEqual(5);
    const text = body.join(' ');
    expect(text).toMatch(/texte caché/);
    expect(text).toMatch(/filigrane statistique/);
    expect(text).not.toMatch(/\b(?:the|reads|hidden)\b/);
  });
});
