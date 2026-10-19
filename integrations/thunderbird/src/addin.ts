/**
 * [F-P3 2.6] Cirta in Thunderbird: the attachments of a message, read before
 * it leaves.
 *
 *   - On Send, each attachment is inspected. If one carries a confirmed
 *     finding — an author, an account, a path on the sender's disk — sending
 *     is held back, the compose button shows « ! » and its panel opens.
 *   - The panel lists every attachment with what it carries, in Thunderbird's
 *     language. « Clean » replaces the attachment in the message with a copy
 *     Cirta wrote and read back; « Send as is » lets this message go with its
 *     attachments as they are, until they change.
 *   - A format Cirta reads but does not rewrite is never offered for
 *     cleaning, and one it does not read is said to be unread — never passed
 *     off as clean.
 *
 * The library runs inside the add-in. Nothing is sent anywhere: the add-in's
 * policy forbids every connection. The PDF page renderer is not bundled, so
 * the check that renders pages says it did not run, as in the VS Code
 * extension.
 *
 * The Thunderbird API comes in as a parameter, which is what lets the tests
 * drive it (test/thunderbird.test.ts).
 */

import { inspectFile, redactFile } from '../../../src/core/index.js';
import type { Confidence, Finding, InspectResult, Note, RedactResult } from '../../../src/core/types.js';
import { errorText, noteText, translateLabel, translateValue, type Lang } from '../../../src/shared/french.js';
import { isReadOnly } from '../../../src/shared/read-only.js';
import { strings } from './strings.js';

/** The part of Thunderbird's MailExtension API the add-in uses (Thunderbird 128). */
export interface Messenger {
  compose: {
    onBeforeSend: { addListener(listener: (tab: { id?: number; windowId?: number }) => Promise<{ cancel?: boolean }>): void };
    // Thunderbird types both name and size as optional.
    listAttachments(tabId: number): Promise<Array<{ id: number; name?: string; size?: number }>>;
    getAttachmentFile(attachmentId: number): Promise<File>;
    updateAttachment(tabId: number, attachmentId: number, attachment: { file?: File; name?: string }): Promise<unknown>;
  };
  composeAction: {
    setBadgeText(details: { text: string | null; tabId?: number }): Promise<void>;
    openPopup?(options?: { windowId?: number }): Promise<boolean>;
  };
  windows: { create(data: { type: 'popup'; url: string; width?: number; height?: number }): Promise<unknown> };
  runtime: { onMessage: { addListener(listener: (message: unknown, sender: unknown) => Promise<unknown> | undefined): void } };
  i18n: { getUILanguage(): string };
}

export interface Engine {
  inspectFile(data: Uint8Array, name: string): Promise<InspectResult>;
  redactFile(data: Uint8Array, name: string): Promise<RedactResult>;
}

export interface ViewLine {
  level: Confidence;
  levelText: string;
  label: string;
  value: string;
}

export interface ViewItem {
  id: number;
  name: string;
  /** flagged: a confirmed finding; findings: only lesser ones; unread: not inspected. */
  status: 'flagged' | 'findings' | 'clean' | 'unread';
  lines: ViewLine[];
  /** The clean button's label, when cleaning is offered. */
  clean?: string;
  /** Items removed by the last clean of this attachment. */
  cleaned?: number;
  note?: string;
}

export interface View {
  lang: Lang;
  title: string;
  /** Would Send be held back now. */
  held: boolean;
  explanation: string;
  sendAsIs?: string;
  /** What Cirta reads, and what it does not claim to: once, under the list. */
  scope: string;
  items: ViewItem[];
}

type Read = { result?: InspectResult; error?: unknown; tooLarge?: boolean };
type Attachment = { id: number; name: string; size: number };

const MB = 1024 * 1024;

export function createAddin(messenger: Messenger, { engine = { inspectFile, redactFile } as Engine, maxBytes = 50 * MB } = {}) {
  const lang = (): Lang => (messenger.i18n.getUILanguage().toLowerCase().startsWith('fr') ? 'fr' : 'en');
  /** An attachment's reading, by id and size: a replaced or edited attachment is read again. */
  const readings = new Map<string, Read>();
  /** Per compose tab: the attachments its sender chose to send as they are. */
  const allowed = new Map<number, string>();
  /** Per compose tab and attachment: what the last clean removed, or why it did not. */
  const outcomes = new Map<string, { cleaned?: number; note?: string }>();

  const key = (a: { id: number; size: number }) => `${a.id}:${a.size}`;
  const signature = (list: Array<{ id: number; size: number }>) => list.map(key).sort().join(',');

  /** The message's attachments, each with a name and a size: taken from the file where the list leaves them out. */
  async function attachments(tabId: number): Promise<Attachment[]> {
    const list = await messenger.compose.listAttachments(tabId);
    return Promise.all(
      list.map(async ({ id, name, size }) => {
        if (name !== undefined && size !== undefined) return { id, name, size };
        const file = await messenger.compose.getAttachmentFile(id);
        return { id, name: name ?? file.name, size: size ?? file.size };
      }),
    );
  }

  async function read(attachment: Attachment): Promise<Read> {
    const cached = readings.get(key(attachment));
    if (cached) return cached;
    let reading: Read;
    if (attachment.size > maxBytes) reading = { tooLarge: true };
    else {
      try {
        const file = await messenger.compose.getAttachmentFile(attachment.id);
        reading = { result: await engine.inspectFile(new Uint8Array(await file.arrayBuffer()), attachment.name) };
      } catch (error) {
        reading = { error };
      }
    }
    readings.set(key(attachment), reading);
    return reading;
  }

  const flagged = (reading: Read) => reading.result?.findings.some((f) => f.confidence === 'confirmed') ?? false;

  async function report(tabId: number): Promise<View> {
    const text = strings(lang());
    const list = await attachments(tabId);
    const items: ViewItem[] = [];
    let held = false;
    for (const attachment of list) {
      const reading = await read(attachment);
      const outcome = outcomes.get(`${tabId}:${attachment.id}`);
      const item: ViewItem = { id: attachment.id, name: attachment.name, status: 'unread', lines: [], ...outcome };
      if (reading.tooLarge) item.note = text.tooLarge(Math.round(maxBytes / MB));
      else if (reading.error !== undefined) {
        // An unknown format in full would list every format Cirta reads, under each such attachment.
        const unknown = (reading.error as { code?: unknown } | null)?.code === 'unsupported';
        item.note = `${unknown ? text.unknownFormat : errorText(reading.error, lang())} ${text.unreadable}`;
      }
      else {
        const { findings, notes, format } = reading.result!;
        item.lines = findings.map((finding: Finding) => ({
          level: finding.confidence,
          levelText: text.level[finding.confidence],
          label: translateLabel(finding.label, lang()),
          value: translateValue(finding, lang()),
        }));
        item.status = flagged(reading) ? 'flagged' : findings.length ? 'findings' : 'clean';
        if (findings.length && !isReadOnly(format)) item.clean = text.clean;
        if (isReadOnly(format)) item.note ??= text.readOnly;
        // What limited the reading of this file; what Cirta reads at all is said once, under the list.
        const limits = notes.filter((note: Note) => note.code.startsWith('limit:'));
        if (!item.note && limits.length) item.note = limits.map((note: Note) => noteText(note, lang())).join(' ');
        if (item.status === 'clean') item.note ??= text.nothing;
        if (item.status === 'flagged') held = true;
      }
      items.push(item);
    }
    const allowedNow = held && allowed.get(tabId) === signature(list);
    return {
      lang: lang(),
      title: text.title,
      held: held && !allowedNow,
      explanation: !list.length ? text.none : allowedNow ? text.allowed : held ? text.held : text.clear,
      ...(held && !allowedNow ? { sendAsIs: text.sendAsIs } : {}),
      scope: text.scope,
      items,
    };
  }

  async function clean(tabId: number, attachmentId: number): Promise<View> {
    const attachment = (await attachments(tabId)).find((a) => a.id === attachmentId);
    if (attachment) {
      try {
        const file = await messenger.compose.getAttachmentFile(attachmentId);
        const result = await engine.redactFile(new Uint8Array(await file.arrayBuffer()), attachment.name);
        // The copy replaces the original only once the library has read it back (redactFile does).
        const copy = new File([result.data! as Uint8Array<ArrayBuffer>], attachment.name, { type: file.type });
        await messenger.compose.updateAttachment(tabId, attachmentId, { file: copy, name: attachment.name });
        outcomes.set(`${tabId}:${attachmentId}`, { cleaned: result.removed.length, note: strings(lang()).cleaned(result.removed.length) });
      } catch (error) {
        outcomes.set(`${tabId}:${attachmentId}`, { note: errorText(error, lang()) });
      }
    }
    const view = await report(tabId);
    await badge(tabId, view);
    return view;
  }

  async function allow(tabId: number): Promise<View> {
    allowed.set(tabId, signature(await attachments(tabId)));
    const view = await report(tabId);
    await badge(tabId, view);
    return view;
  }

  const badge = (tabId: number, view: View) => messenger.composeAction.setBadgeText({ text: view.held ? '!' : '', tabId });

  async function beforeSend(tab: { id?: number; windowId?: number }): Promise<{ cancel?: boolean }> {
    if (tab.id === undefined) return {};
    const view = await report(tab.id);
    await badge(tab.id, view);
    if (!view.held) return {};
    // The panel, where the sender decides. A window when the button's panel cannot be opened.
    const opened = await messenger.composeAction.openPopup?.({ windowId: tab.windowId }).catch(() => false);
    if (!opened) await messenger.windows.create({ type: 'popup', url: `popup.html?tab=${tab.id}`, width: 520, height: 600 });
    return { cancel: true };
  }

  messenger.compose.onBeforeSend.addListener(beforeSend);
  messenger.runtime.onMessage.addListener((message) => {
    const m = message as { type?: string; tabId?: number; attachmentId?: number };
    if (typeof m.tabId !== 'number') return undefined;
    if (m.type === 'report') return report(m.tabId);
    if (m.type === 'clean' && typeof m.attachmentId === 'number') return clean(m.tabId, m.attachmentId);
    if (m.type === 'allow') return allow(m.tabId);
    return undefined;
  });

  return { report, clean, allow, beforeSend };
}
