import { describe, expect, it } from 'vitest';
import { inspectFile, redactFile, type Finding } from '../src/core/index.js';

/*
 * [F-2.1] A picture fetched from a server when a page or a mail is opened
 * tells that server who opened it, when and from where: a read receipt. A
 * one-pixel one exists for nothing else. Listed, and removable on request.
 */

const enc = (text: string) => new TextEncoder().encode(text);
const get = (findings: Finding[], label: string) => findings.filter((f) => f.label === label);

const PAGE =
  '<html><head><link rel="stylesheet" href="https://cdn.exemple/style.css"><script src="https://stats.exemple/t.js"></script></head>' +
  '<body style="background:url(https://img.exemple/fond.png)"><p>Bonjour</p><img src="logo.png" alt="Logo">' +
  '<img src="https://pixel.exemple/o.gif?id=marie" width="1" height="1"><img src="https://img.exemple/photo.jpg" alt="Photo"></body></html>';

describe('[F-2.1] remote resources and tracking pixels', () => {
  it('lists what an HTML page fetches when opened, and calls a one-pixel image a tracking pixel', async () => {
    const { findings } = await inspectFile(enc(PAGE), 'html');
    expect(get(findings, 'Tracking pixel')[0]).toMatchObject({ kind: 'active-content', confidence: 'confirmed', value: 'https://pixel.exemple/o.gif?id=marie' });
    expect(get(findings, 'Remote resource loaded on opening').map((f) => f.value).sort()).toEqual([
      'css: https://img.exemple/fond.png',
      'img: https://img.exemple/photo.jpg',
      'link: https://cdn.exemple/style.css',
      'script: https://stats.exemple/t.js',
    ]);
  });

  it('ignores local pictures', async () => {
    const { findings } = await inspectFile(enc('<html><body><img src="logo.png"><img src="data:image/png;base64,AAAA"></body></html>'), 'html');
    expect(findings.filter((f) => f.kind === 'active-content')).toEqual([]);
  });

  it('reads Markdown images and the HTML in a mail', async () => {
    const md = await inspectFile(enc('# Notes\n\n![schéma](https://img.exemple/schema.png)\n'), 'markdown');
    expect(get(md.findings, 'Remote resource loaded on opening')[0]?.value).toBe('img: https://img.exemple/schema.png');
    const mail =
      'From: a@exemple.fr\r\nTo: b@exemple.fr\r\nSubject: Point\r\nDate: Mon, 12 Oct 2026 09:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n' +
      '<p>Bonjour</p><img src="https://pixel.exemple/m.gif" width="1" height="1" style="display:block">';
    expect(get((await inspectFile(enc(mail), 'eml')).findings, 'Tracking pixel')[0]?.value).toBe('https://pixel.exemple/m.gif');
  });

  it('removes them from HTML and Markdown with stripRemote, keeping local ones and the text', async () => {
    const page = await redactFile(enc(PAGE), 'html', { stripRemote: true });
    const html = new TextDecoder().decode(page.data);
    expect(html).not.toMatch(/https:\/\//);
    expect(html).toContain('logo.png');
    expect(html).toContain('Bonjour');
    expect(page.notes).toContainEqual({ code: 'removed:remote-resources', detail: '5' });
    const md = await redactFile(enc('# Notes\n\nTexte ![schéma](https://img.exemple/schema.png) suite.\n'), 'markdown', { stripRemote: true });
    expect(new TextDecoder().decode(md.data)).toBe('# Notes\n\nTexte schéma suite.\n');
  });
});
