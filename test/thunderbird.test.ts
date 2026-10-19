import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createAddin, type Messenger, type View } from '../integrations/thunderbird/src/addin.js';
import { inspectFile } from '../src/core/index.js';
import { makeDocx } from './fixtures.js';

/*
 * [F-P3 2.6] The Thunderbird add-in. Thunderbird itself cannot be run here, so
 * the add-in is driven through a stand-in for the part of its MailExtension
 * API it uses, written from the reference documentation for Thunderbird 128:
 * compose.onBeforeSend, listAttachments, getAttachmentFile, updateAttachment,
 * composeAction, windows.create, runtime.onMessage, i18n.getUILanguage.
 */

type Listener = (...args: never[]) => unknown;

class FakeThunderbird {
  attachments = new Map<number, File>();
  next = 1;
  badges = new Map<number, string>();
  popups = 0;
  updates: Array<{ tabId: number; id: number; name: string }> = [];
  beforeSend?: Listener;
  bare = false;
  onMessage?: Listener;

  constructor(public language = 'fr-FR') {}

  attach(name: string, bytes: Uint8Array | string): number {
    const id = this.next++;
    this.attachments.set(id, new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name));
    return id;
  }

  messenger(): Messenger {
    return {
      compose: {
        onBeforeSend: { addListener: (listener) => void (this.beforeSend = listener as Listener) },
        // Thunderbird types name and size as optional; a bare entry carries the id alone.
        listAttachments: async () => [...this.attachments].map(([id, file]) => (this.bare ? { id } : { id, name: file.name, size: file.size })),
        getAttachmentFile: async (id) => this.attachments.get(id)!,
        updateAttachment: async (tabId, id, { file, name }) => {
          this.updates.push({ tabId, id, name: name ?? file!.name });
          this.attachments.set(id, file!);
          return { id, name: file!.name, size: file!.size };
        },
      },
      composeAction: {
        setBadgeText: async ({ text, tabId }) => void this.badges.set(tabId!, text ?? ''),
        openPopup: async () => {
          this.popups++;
          return true;
        },
      },
      windows: { create: async () => ({}) },
      runtime: { onMessage: { addListener: (listener) => void (this.onMessage = listener as Listener) } },
      i18n: { getUILanguage: () => this.language },
    };
  }

  send(tabId = 7): Promise<{ cancel?: boolean } | undefined> {
    return (this.beforeSend as unknown as (tab: { id: number; windowId: number }) => Promise<{ cancel?: boolean } | undefined>)({ id: tabId, windowId: 1 });
  }

  ask<T>(message: unknown): Promise<T> {
    return (this.onMessage as unknown as (message: unknown, sender: unknown) => Promise<T>)(message, {});
  }
}

const TAB = 7;
const item = (view: View, name: string) => view.items.find((entry) => entry.name === name)!;

describe('[F-P3 2.6] Thunderbird: before a message is sent', () => {
  it('holds back a message whose attachment names its author, and says why', async () => {
    const thunderbird = new FakeThunderbird();
    createAddin(thunderbird.messenger());
    thunderbird.attach('rapport.docx', makeDocx());
    thunderbird.attach('notes.txt', 'Rien à signaler.');

    expect(await thunderbird.send(TAB)).toEqual({ cancel: true });
    expect(thunderbird.badges.get(TAB)).toBe('!');
    expect(thunderbird.popups).toBe(1);

    const view = await thunderbird.ask<View>({ type: 'report', tabId: TAB });
    expect(view.held).toBe(true);
    const docx = item(view, 'rapport.docx');
    expect(docx.status).toBe('flagged');
    // In the reader's language: the field's French name, the value as the document has it.
    expect(docx.lines.some((line) => line.label === 'Auteur' && line.value.includes('Lotfi Zakaria') && line.level === 'confirmed')).toBe(true);
    expect(docx.clean).toBeTruthy();
    expect(item(view, 'notes.txt').status).toBe('clean');
    expect(view.explanation).toMatch(/Envoyer/);
  });

  it('cleans an attachment in place in the message: same name, read back without the author, and the message goes', async () => {
    const thunderbird = new FakeThunderbird();
    createAddin(thunderbird.messenger());
    const id = thunderbird.attach('rapport.docx', makeDocx());
    await thunderbird.send(TAB);

    const view = await thunderbird.ask<View>({ type: 'clean', tabId: TAB, attachmentId: id });
    expect(thunderbird.updates).toEqual([{ tabId: TAB, id, name: 'rapport.docx' }]);
    const cleaned = new Uint8Array(await thunderbird.attachments.get(id)!.arrayBuffer());
    expect((await inspectFile(cleaned, 'rapport.docx')).findings.some((f) => f.label === 'Author')).toBe(false);
    expect(item(view, 'rapport.docx').status).not.toBe('flagged');
    expect(item(view, 'rapport.docx').cleaned).toBeGreaterThan(0);
    expect(await thunderbird.send(TAB)).toEqual({});
    expect(thunderbird.badges.get(TAB)).toBe('');
  });

  it('sends as it is when asked, until the attachments change', async () => {
    const thunderbird = new FakeThunderbird();
    createAddin(thunderbird.messenger());
    thunderbird.attach('rapport.docx', makeDocx());
    expect(await thunderbird.send(TAB)).toEqual({ cancel: true });
    await thunderbird.ask({ type: 'allow', tabId: TAB });
    expect(await thunderbird.send(TAB)).toEqual({});
    // Another file attached after the choice: asked again.
    thunderbird.attach('budget.docx', makeDocx());
    expect(await thunderbird.send(TAB)).toEqual({ cancel: true });
    // The choice belongs to one message.
    thunderbird.attachments.delete(2);
    await thunderbird.ask({ type: 'allow', tabId: TAB });
    expect(await thunderbird.send(TAB + 1)).toEqual({ cancel: true });
  });

  it('lets through a message with nothing confirmed attached, or nothing attached, without a word', async () => {
    const thunderbird = new FakeThunderbird();
    createAddin(thunderbird.messenger());
    expect(await thunderbird.send(TAB)).toEqual({});
    thunderbird.attach('notes.txt', 'Rien à signaler.');
    thunderbird.attach('setup.exe', new Uint8Array([0x4d, 0x5a, 0, 0]));
    expect(await thunderbird.send(TAB)).toEqual({});
    expect(thunderbird.popups).toBe(0);
    const view = await thunderbird.ask<View>({ type: 'report', tabId: TAB });
    expect(view.held).toBe(false);
    // A format Cirta does not read is said to be unread, not passed as clean.
    expect(item(view, 'setup.exe').status).toBe('unread');
    expect(item(view, 'setup.exe').note).toMatch(/ne lit pas/);
    // What Cirta reads, and the watermark it does not claim to see: said once, not under every file.
    expect(view.scope).toMatch(/filigrane statistique/);
    expect(view.items.some((entry) => entry.note?.includes('filigrane'))).toBe(false);
  });

  it('a format it inspects only is held back if it must be, but never rewritten: the reason is given instead', async () => {
    const thunderbird = new FakeThunderbird();
    createAddin(thunderbird.messenger());
    const id = thunderbird.attach('rapport.docx.gz', gzipSync(makeDocx()));
    expect(await thunderbird.send(TAB)).toEqual({ cancel: true });
    const report = await thunderbird.ask<View>({ type: 'report', tabId: TAB });
    expect(item(report, 'rapport.docx.gz').clean).toBeUndefined();
    const view = await thunderbird.ask<View>({ type: 'clean', tabId: TAB, attachmentId: id });
    expect(thunderbird.updates).toEqual([]);
    expect(item(view, 'rapport.docx.gz').note).toMatch(/gzip/i);
  });

  it('does not read an attachment past the size limit, and says so', async () => {
    const thunderbird = new FakeThunderbird();
    createAddin(thunderbird.messenger(), { maxBytes: 100 });
    thunderbird.attach('rapport.docx', makeDocx());
    expect(await thunderbird.send(TAB)).toEqual({});
    const view = await thunderbird.ask<View>({ type: 'report', tabId: TAB });
    expect(item(view, 'rapport.docx').status).toBe('unread');
    expect(item(view, 'rapport.docx').note).toMatch(/Mo/);
  });

  it('reads an attachment Thunderbird lists without its name or size by the file itself', async () => {
    const thunderbird = new FakeThunderbird();
    createAddin(thunderbird.messenger());
    thunderbird.bare = true;
    const id = thunderbird.attach('rapport.docx', makeDocx());
    expect(await thunderbird.send(TAB)).toEqual({ cancel: true });
    const view = await thunderbird.ask<View>({ type: 'report', tabId: TAB });
    expect(item(view, 'rapport.docx').status).toBe('flagged');
    await thunderbird.ask({ type: 'clean', tabId: TAB, attachmentId: id });
    expect(thunderbird.updates).toEqual([{ tabId: TAB, id, name: 'rapport.docx' }]);
    expect(await thunderbird.send(TAB)).toEqual({});
  });

  it('speaks English to an English Thunderbird', async () => {
    const thunderbird = new FakeThunderbird('en-US');
    createAddin(thunderbird.messenger());
    thunderbird.attach('report.docx', makeDocx());
    await thunderbird.send(TAB);
    const view = await thunderbird.ask<View>({ type: 'report', tabId: TAB });
    expect(view.lang).toBe('en');
    expect(item(view, 'report.docx').lines.some((line) => line.label === 'Author')).toBe(true);
    expect(view.explanation).toMatch(/Send/);
  });
});

describe('[F-P3 2.6] Thunderbird: the package', () => {
  const root = new URL('../integrations/thunderbird/', import.meta.url);
  const en = JSON.parse(readFileSync(new URL('_locales/en/messages.json', root), 'utf8'));
  const fr = JSON.parse(readFileSync(new URL('_locales/fr/messages.json', root), 'utf8'));

  it('names itself in both languages, with the same keys', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) expect(fr[key].message).not.toBe('');
  });

  it('asks for the compose permission alone, and forbids every connection', async () => {
    const { thunderbirdManifest } = await import('../scripts/build-thunderbird.mjs');
    const manifest = thunderbirdManifest('1.2.3');
    expect(manifest.permissions).toEqual(['compose']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_security_policy).toMatch(/connect-src 'none'/);
    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe('128.0');
    expect(manifest.compose_action.default_popup).toBe('popup.html');
    for (const value of [manifest.name, manifest.description, manifest.compose_action.default_title]) {
      const key = /^__MSG_(\w+)__$/.exec(value)?.[1];
      expect(key && en[key]).toBeTruthy();
    }
  });

  it('is built, checked against Thunderbird’s API and linted in CI, and shipped with a release', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    for (const step of ['node scripts/build-thunderbird.mjs', 'npx tsc -p integrations/thunderbird/tsconfig.json', 'lint --source-dir build/thunderbird']) expect(ci).toContain(step);
    const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
    expect(release).toContain('node scripts/build-thunderbird.mjs');
    expect(release).toMatch(/cp [^\n]*build\/cirta-thunderbird-\*\.xpi build\/extensions\//);
  });

  it('builds into a package whose background script holds a message back, in Thunderbird’s place', async () => {
    const { buildThunderbird } = await import('../scripts/build-thunderbird.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'cirta-thunderbird-'));
    try {
      const { out, names } = await buildThunderbird(join(dir, 'thunderbird'));
      expect(names).toEqual(expect.arrayContaining(['manifest.json', 'background.js', 'popup.js', 'popup.html', 'popup.css', '_locales/en/messages.json', '_locales/fr/messages.json', 'icons/16.png', 'icons/128.png']));
      expect(names.some((name) => name.startsWith('src/'))).toBe(false);
      const background = readFileSync(join(out, 'background.js'), 'utf8');
      // No way out of the add-in in what it runs; its policy forbids connections besides.
      // A call to the global fetch, not the PDF reader's own method of that name, which serves bundled bytes.
      expect(background).not.toMatch(/(?<![\w.]|async )fetch\(|globalThis\.fetch|XMLHttpRequest|WebSocket|sendBeacon/);
      expect(readFileSync(join(out, 'popup.html'), 'utf8')).not.toMatch(/<script>|\son\w+=/);

      const thunderbird = new FakeThunderbird('fr');
      runInNewContext(background, { messenger: thunderbird.messenger(), File, TextDecoder, TextEncoder, crypto, structuredClone, console, setTimeout, clearTimeout, URL });
      thunderbird.attach('rapport.docx', makeDocx());
      expect(await thunderbird.send(TAB)).toEqual({ cancel: true });
      const view = await thunderbird.ask<View>({ type: 'report', tabId: TAB });
      expect(item(view, 'rapport.docx').lines.some((line) => line.label === 'Auteur')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
