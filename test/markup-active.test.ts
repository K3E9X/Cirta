import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';
import { translateLabel } from '../src/shared/french.js';
import { activeMarkupFindings, stripActiveMarkup } from '../src/core/markup-active.js';
import { runCli } from './helpers/cli.js';

/*
 * [R3] What runs when a page, a picture or a mail's HTML is opened. These
 * formats reported a `javascript:` link and nothing else, and --strip-active,
 * offered by the report, did nothing to them.
 */

const enc = (text: string) => new TextEncoder().encode(text);
const page = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body>${body}<p>Bonjour</p></body></html>`;
const labels = (findings: Finding[]) => findings.filter((f) => f.kind === 'active-content').map((f) => `${f.label}: ${f.value}`);
const decode = (data?: Uint8Array) => new TextDecoder().decode(data);

const VECTORS: Array<[string, string, string, RegExp]> = [
  ['inline script', page('<script>document.cookie</script>'), 'Script in the page: document.cookie', /<script/i],
  ['script from a file', page('<script src="https://cdn.example/a.js"></script>'), 'Script loaded from a file: https://cdn.example/a.js', /<script/i],
  ['an event handler', page('<img src="a.png" onerror="alert(1)">'), 'Event handler attribute: <img onerror> alert(1)', /onerror/i],
  ['a handler in capitals, unquoted', page('<body ONLOAD=go()>'), 'Event handler attribute: <body onload> go()', /onload/i],
  ['javascript: in a src', page('<iframe src="javascript:alert(1)"></iframe>'), 'Address that runs a script or opens a page: <iframe src> javascript:alert(1)', /javascript:/i],
  ['vbscript: in a src', page('<img src="vbscript:msgbox(1)">'), 'Address that runs a script or opens a page: <img src> vbscript:msgbox(1)', /vbscript:/i],
  ['a page in a data: address', page('<iframe src="data:text/html,<b>x</b>"></iframe>'), 'Address that runs a script or opens a page: <iframe src> data:text/html,<b>x</b>', /data:text\/html/i],
  ['an encoded scheme', page('<iframe src="java&#x09;script&colon;alert(1)"></iframe>'), 'Address that runs a script or opens a page: <iframe src> javascript:alert(1)', /script&colon;/i],
  ['meta refresh', page('', '<meta http-equiv="refresh" content="0;url=https://e.example/">'), 'Automatic redirect: refresh 0;url=https://e.example/', /refresh/i],
  ['an object', page('<object data="x.swf"><param name="a" value="b"></object>'), 'Embedded object: <object> x.swf', /<object|<param/i],
  ['an embed', page('<embed src="x.swf">'), 'Embedded object: <embed> x.swf', /<embed/i],
  ['a form to another site', page('<form action="https://collect.example/login"><input name="pw"></form>'), 'Form sending to an address: https://collect.example/login', /collect\.example/],
];

describe('[R3] active content in HTML, found and taken out', () => {
  it.each(VECTORS)('%s', async (_, html, expected, gone) => {
    const found = labels((await inspectFile(enc(html), 'page.html')).findings);
    expect(found).toContain(expected);
    const kept = await redactFile(enc(html), 'page.html');
    expect(decode(kept.data)).toMatch(gone);
    const cleaned = await redactFile(enc(html), 'page.html', { stripActive: true });
    expect(decode(cleaned.data)).not.toMatch(gone);
    expect(decode(cleaned.data)).toContain('<p>Bonjour</p>');
    expect(labels((await inspectFile(cleaned.data!, 'page.html')).findings)).toEqual([]);
    expect(cleaned.notes.map((n) => n.code)).toContain('removed:active-content');
  });

  it('a javascript: link keeps its text and loses its address', async () => {
    const html = page('<a href="javascript:steal()">Ouvrir le dossier</a>');
    expect(labels((await inspectFile(enc(html), 'page.html')).findings)).toEqual(['Link that runs a script: javascript:steal()']);
    const cleaned = decode((await redactFile(enc(html), 'page.html', { stripActive: true })).data);
    expect(cleaned).toContain('<a>Ouvrir le dossier</a>');
  });

  it('JSON-LD and a plain link are not active content', async () => {
    const html = page('<script type="application/ld+json">{"@type":"Person"}</script><a href="https://exemple.fr/">Site</a>');
    expect(labels((await inspectFile(enc(html), 'page.html')).findings)).toEqual([]);
    expect(decode((await redactFile(enc(html), 'page.html', { stripActive: true })).data)).toContain('application/ld+json');
  });

  it('text that only looks like markup is left alone', async () => {
    const text = page('<p>if a < b and onload=x then</p><p>"<script>" est un mot</p>');
    const found = labels((await inspectFile(enc(text), 'page.html')).findings);
    expect(found.filter((f) => f.startsWith('Event handler'))).toEqual([]);
  });

  it('a stray « < » or a closed quote does not hide the script after it', async () => {
    const html = page('<p>a < b, 3<4</p><a title="x>y">t</a><p <>u</p><script>evil()</script>');
    expect(labels((await inspectFile(enc(html), 'page.html')).findings).some((f) => f.startsWith('Script in the page'))).toBe(true);
  });
});

describe('[R3] read in linear time', () => {
  it.each([
    ['openings never closed', '<object>'.repeat(100_000)],
    ['openings before one close', `${'<object><script>'.repeat(50_000)}</object></script>`],
    ['handlers', '<a onclick=x href=javascript:y>'.repeat(50_000)],
    ['a quote never closed', `<a title="${'<b '.repeat(200_000)}`],
    ['comments never closed', '<!--<a onclick=x>'.repeat(100_000)],
  ])('%s', (_, body) => {
    // The scanner alone: the rest of the HTML pass has its own budget (test/redos.test.ts).
    const start = performance.now();
    activeMarkupFindings(page(body), false);
    stripActiveMarkup(page(body), false);
    activeMarkupFindings(page(body), true);
    expect(performance.now() - start).toBeLessThan(1_500);
  });
});

describe('[R3] in SVG, Markdown and mail', () => {
  it('SVG: script, handler, javascript: link and an animation that sets one', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><script>alert(1)</script>' +
      '<rect width="10" height="10" onclick="go()"/><a xlink:href="javascript:alert(2)"><text>x</text></a>' +
      '<a><animate attributeName="href" values="javascript:alert(3)"/><text>y</text></a></svg>';
    const found = labels((await inspectFile(enc(svg), 'image.svg')).findings);
    expect(found).toEqual(
      expect.arrayContaining([
        'Script in the page: alert(1)',
        'Event handler attribute: <rect onclick> go()',
        'Address that runs a script or opens a page: <a xlink:href> javascript:alert(2)',
        'Address that runs a script or opens a page: <animate values> javascript:alert(3)',
      ]),
    );
    const cleaned = await redactFile(enc(svg), 'image.svg', { stripActive: true });
    expect(decode(cleaned.data)).not.toMatch(/alert|onclick/);
    expect(decode(cleaned.data)).toContain('<rect width="10" height="10"/>');
  });

  it('Markdown: inline HTML and a javascript: link', async () => {
    const md = '# Notes\n\n<img src="a.png" onerror="alert(1)">\n\n[Ouvrir](javascript:alert`2`)\n';
    const found = labels((await inspectFile(enc(md), 'notes.md')).findings);
    expect(found).toEqual(expect.arrayContaining(['Event handler attribute: <img onerror> alert(1)', 'Link that runs a script: javascript:alert`2`']));
    const cleaned = decode((await redactFile(enc(md), 'notes.md', { stripActive: true })).data);
    expect(cleaned).not.toMatch(/alert/);
    expect(cleaned).toContain('Ouvrir');
  });

  const mail = (encoding: string, body: string) =>
    'From: a@exemple.fr\r\nSubject: Facture\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="b"\r\n\r\n' +
    '--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBonjour\r\n' +
    `--b\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${body}\r\n--b--\r\n`;
  const HTML = '<p>Réglez la facture</p><img src="x" onerror="fetch(1)"><script>steal()</script>';

  it.each([
    ['8bit', HTML],
    ['quoted-printable', HTML.replace(/[=]/g, '=3D').replace(/é/g, '=C3=A9')],
    ['base64', Buffer.from(HTML).toString('base64')],
  ])('mail: an HTML part in %s, found and rewritten as it was encoded', async (encoding, body) => {
    const eml = enc(mail(encoding, body));
    const found = labels((await inspectFile(eml, 'facture.eml')).findings);
    expect(found).toEqual(expect.arrayContaining(['Event handler attribute: <img onerror> fetch(1)', 'Script in the page: steal()']));
    const cleaned = await redactFile(eml, 'facture.eml', { stripActive: true });
    expect(labels((await inspectFile(cleaned.data!, 'facture.eml')).findings)).toEqual([]);
    const text = decode(cleaned.data);
    expect(text).toContain(`Content-Transfer-Encoding: ${encoding}`);
    expect(text).toContain('Bonjour');
    // The words are still there, through the part's own encoding.
    const again = (await inspectFile(cleaned.data!, 'facture.eml')).findings;
    expect(again.some((f) => f.label === 'Script in the page')).toBe(false);
  });
});

describe('[R3] every label in French', () => {
  it.each(['Script in the page', 'Script loaded from a file', 'Event handler attribute', 'Address that runs a script or opens a page', 'Automatic redirect', 'Embedded object', 'Form sending to an address'])('%s', (label) => {
    expect(translateLabel(label, 'fr')).not.toBe(label);
  });
});

describe('[R3] « Run again with --strip-active » only where it would act', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'cirta-r3-'));

  it('offered for a page with a script, and the second run takes it out', () => {
    const d = dir();
    writeFileSync(join(d, 'page.html'), page('<script>x()</script>'));
    const first = runCli(['redact', '--lang', 'fr', '-o', join(d, 'a.html'), join(d, 'page.html')]).stdout.toString();
    expect(first).toContain('Relancez avec --strip-active');
    const second = runCli(['redact', '--lang', 'fr', '--strip-active', '-o', join(d, 'b.html'), join(d, 'page.html')]).stdout.toString();
    expect(second).not.toContain('Relancez avec --strip-active');
    expect(readFileSync(join(d, 'b.html'), 'utf8')).not.toContain('<script>');
  });

  it('not offered for a remote picture, which --strip-remote-resources is for', () => {
    const d = dir();
    writeFileSync(join(d, 'page.html'), page('<img src="https://img.exemple/photo.jpg">'));
    const out = runCli(['redact', '--lang', 'fr', '-o', join(d, 'a.html'), join(d, 'page.html')]).stdout.toString();
    expect(out).not.toContain('--strip-active');
    expect(out).toContain('--strip-remote-resources');
  });
});
