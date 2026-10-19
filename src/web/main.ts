/**
 * Browser front-end for Cirta.
 *
 * Every operation runs against the local File object — in a worker for
 * documents, on the main thread for pasted text. There is no fetch, XHR or
 * WebSocket anywhere in this bundle, and no file ever leaves the machine; a
 * worker is another thread in the same page, not another machine. The scope
 * statement in the page is kept honest by the core: statistical model
 * watermarks are neither detected nor claimed to be.
 */

import { parseRules } from '../core/rules.js';
import type { ScanChoices, CleanChoices, WorkerRequest, WorkerResponse } from './worker.js';
import type { XrayRegion } from '../core/xray.js';
// Imported from the individual modules rather than the barrel: pulling in
// core/index.js would drag pdf-lib and fflate into the main bundle, when the
// only code that needs them now runs in the worker.
import { inspectPlainText, cleanPlainText } from '../core/plaintext.js';
import { removeScaffolding } from '../core/residue.js';
import { inspectClipboardHtml } from '../core/clipboard.js';
import { translateLabel, translateValue, translateLocation, noteText, errorText } from '../shared/french.js';
import { lang, setLang, t } from './i18n.js';
import { provenance } from '../core/fingerprint.js';
import { exposure } from '../core/exposure.js';
import { stylometry } from '../core/stylometry.js';
import { AIMED_LABEL } from '../core/hidden-text.js';
import { CLEAN_KEYS, offered, plan, type CleanKey } from '../shared/clean-plan.js';
import { hunks, lineDiff, showInvisible } from '../shared/diff.js';
import { PROFILES, type ProfileName } from '../shared/profiles.js';
import { cleanBatch } from '../shared/batch.js';
import { reportHtml, reportMarkdown } from '../shared/report-export.js';
import { isSupportedFile, isWalkedDirectory } from '../shared/files.js';
import { matchHash } from '../shared/site.js';
import {
  preview,
  type Finding,
  type Format,
  type Note,
  type InspectResult,
  type RedactResult,
} from '../core/types.js';

/**
 * Analysis runs in a worker so a large PDF or archive cannot freeze the tab.
 *
 * It is warmed as soon as the page is idle, not on the first file. The page
 * tells people they can disconnect before starting and everything will work
 * the same; with the worker fetched on first use, that was false — load the
 * page, go offline, drop a file, and the worker script could not be fetched.
 * Warming it once the page is usable keeps the promise at the cost of a
 * download the visitor never waits on.
 */
let worker: Worker | undefined;
let nextRequestId = 0;
const pending = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data as never);
    else entry.reject(Object.assign(new Error(event.data.error), { code: event.data.code, detail: event.data.detail }));
  });
  worker.addEventListener('error', () => {
    // A worker that failed to load stays failed; forgetting it lets the next
    // file try again once the network is back, instead of failing forever.
    worker = undefined;
    for (const [, entry] of pending) entry.reject(new Error(t().workerUnavailable));
    pending.clear();
  });
  return worker;
}

/*
 * [F-2.3] Personal data and the organisation's rules: chosen once, kept in
 * this browser only. Storage can be refused (private browsing, blocked site
 * data); the choices then last for the visit, and nothing breaks.
 */
const STORE = { pii: 'cirta.pii', rules: 'cirta.rules', rulesName: 'cirta.rules.name' };
const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Kept for this visit only.
  }
};
const scanState = { pii: stored(STORE.pii) === '1', rules: stored(STORE.rules) ?? undefined, rulesName: stored(STORE.rulesName) ?? undefined };
const scanChoices = (): ScanChoices => ({ pii: scanState.pii, rules: scanState.rules });

/** [F-2.7] The advanced cleaning options: what each file's own choices start from. */
const CLEAN_STORE = 'cirta.clean';
const cleanState: CleanChoices = (() => {
  try {
    const parsed: unknown = JSON.parse(stored(CLEAN_STORE) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(CLEAN_KEYS.filter((key) => (parsed as Record<string, unknown>)[key] === true).map((key) => [key, true]));
  } catch {
    return {};
  }
})();

function warmWorker(): void {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(() => ensureWorker());
  else setTimeout(() => ensureWorker(), 200);
}

function ask<T>(op: WorkerRequest['op'], data: Uint8Array, hint?: string, clean: CleanChoices = {}): Promise<T> {
  const id = nextRequestId++;
  // A copy is transferred so the caller keeps its own bytes for a later redact.
  const buffer = data.slice().buffer;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: never) => void, reject });
    ensureWorker().postMessage({ id, op, data: buffer, hint, clean, scan: scanChoices() } as WorkerRequest, [buffer]);
  });
}

const inspectFile = (data: Uint8Array, hint?: string): Promise<{ result: InspectResult; hidden: XrayRegion[] }> =>
  ask<{ result: InspectResult; hidden: XrayRegion[] }>('inspect', data, hint);

const redactFile = async (data: Uint8Array, hint?: string, clean: CleanChoices = {}): Promise<RedactResult> => {
  const reply = await ask<{ result: Omit<RedactResult, 'data'>; data?: ArrayBuffer }>(
    'redact',
    data,
    hint,
    clean,
  );
  return { ...reply.result, ...(reply.data ? { data: new Uint8Array(reply.data) } : {}) };
};

function styleCard(text: string): HTMLElement | undefined {
  const report = stylometry(text);
  if (report.band === 'too-short') return undefined;

  const node = card(t().styleTitle, undefined, t().styleBadge);
  const scroll = el('div', 'table-scroll');
  const table = el('table');
  const body = el('tbody');
  const row = (label: string, value: string) => {
    const tr = el('tr');
    tr.append(el('td', 'kind', label));
    tr.append(el('td', 'value', value));
    body.append(tr);
  };

  row(t().styleRowShape, t().styleShape(report.sentences, report.meanSentence.toFixed(1)));
  row(t().styleRowVariation, t().styleVariation(report.burstiness.toFixed(2)));
  row(t().styleRowDashes, t().styleDashes(report.dashRate.toFixed(1)));
  if (report.boldLeadIns > 0) {
    row(t().styleRowLeadIns, t().styleLeadIns(Math.round(report.boldLeadIns * 100)));
  }
  if (report.indicators.length) {
    row(t().styleRowPhrases, report.indicators.map((i) => `${i.label} ×${i.count}`).join(' · '));
  }
  row(t().styleRowReading, t().styleBands[report.band]);

  table.append(body);
  scroll.append(table);
  node.append(scroll);
  node.append(el('p', 'note', t().styleNote));
  return node;
}

function exposureCard(text: string): HTMLElement {
  const report = exposure(text);
  const node = card(t().exposureTitle, undefined, t().exposureBadge);

  const scroll = el('div', 'table-scroll');
  const table = el('table');
  const body = el('tbody');

  const row = (label: string, value: string) => {
    const tr = el('tr');
    tr.append(el('td', 'kind', label));
    tr.append(el('td', 'value', value));
    body.append(tr);
  };
  row(
    t().exposureRowLength,
    t().exposureLength(report.low, report.high, report.characters, report.words),
  );
  row(t().exposureRowReach, t().exposureBands[report.band]);
  // La longueur n'est pas seule à gouverner la détectabilité : la marque vit
  // dans les choix libres entre mots équivalents, et le code n'en offre guère.
  if (report.freeChoice.code) {
    const { commentLines, nonBlankLines } = report.freeChoice;
    const share = Math.round((commentLines / nonBlankLines) * 100);
    row(t().exposureRowRoom, t().exposureRoom(nonBlankLines, commentLines, share));
  }
  // Depuis août 2026 la question n'est plus théorique.
  row(t().exposureRowStatus, t().exposureStatus);
  // Le point le plus facile à confondre avec le sujet même de cet outil. La
  // presse a fusionné les deux sous le mot « invisible » ; Anthropic écrit le
  // contraire noir sur blanc.
  row(t().exposureRowNotThis, t().exposureNotThis);
  row(t().exposureRowCareful, t().exposureCareful);

  table.append(body);
  scroll.append(table);
  node.append(scroll);
  node.append(el('p', 'note', t().exposureNote));
  return node;
}

const MIME: Record<Format, string> = {
  eml: 'message/rfc822',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  svg: 'image/svg+xml',
  html: 'text/html',
  markdown: 'text/markdown',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  heic: 'image/heic',
  avif: 'image/avif',
  // [F-P3 2.2]
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  zip: 'application/zip',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  msg: 'application/vnd.ms-outlook',
  ipynb: 'application/x-ipynb+json',
  rtf: 'application/rtf',
  vsdx: 'application/vnd.ms-visio.drawing.main+xml',
  epub: 'application/epub+zip',
  latex: 'application/x-tex',
  ics: 'text/calendar',
  vcf: 'text/vcard',
  text: 'text/plain',
};

/** Extensions whose bytes alone do not identify the format. */
function formatHint(name: string): string | undefined {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.eml') return 'eml';
  return undefined;
}

/** [F-2.7] Each option's label, with the count of what it acts on. */
const OPTION_LABEL: Record<CleanKey, (n: number) => string> = {
  removeHidden: (n) => t().removeHiddenOption(n),
  acceptChanges: (n) => t().acceptChangesOption(n),
  removeComments: (n) => t().removeCommentsOption(n),
  removeNotes: (n) => t().removeNotesOption(n),
  removeHiddenSlides: (n) => t().removeHiddenSlidesOption(n),
  removeHiddenSheets: (n) => t().removeHiddenSheetsOption(n),
  stripActive: (n) => t().stripActiveOption(n),
  stripRemote: (n) => t().stripRemoteOption(n),
  stripTracking: (n) => t().stripTrackingOption(n),
  removeAttachments: (n) => t().removeAttachmentsOption(n),
  flattenAnnotations: () => t().flattenAnnotationsOption(),
  burnRedactions: (n) => t().burnRedactionsOption(n),
  clearOutputs: (n) => t().clearOutputsOption(n),
  reencodeImages: () => t().reencodeImagesOption,
};

/** Formats whose cleaned copy is text a person can read line by line. */
const TEXT_FORMATS = new Set(['text', 'markdown', 'html', 'svg', 'eml', 'ipynb']);
const MAX_DIFF = 1024 * 1024;

/**
 * [F-2.7] After a clean: what went, what is still there, and for a text the
 * lines that changed — invisible characters written out, since what a clean
 * removes is mostly what a reader cannot see.
 */
function beforeAfter(format: Format, before: Uint8Array, redacted: RedactResult): HTMLElement {
  const box = el('details', 'before-after');
  box.open = true;
  box.append(el('summary', undefined, t().beforeAfterTitle));
  const columns = el('div', 'before-after-columns');
  const list = (title: string, findings: Finding[], className: string) => {
    const column = el('div', `before-after-column ${className}`);
    column.append(el('p', 'before-after-head', title));
    const items = el('ul');
    for (const finding of findings) {
      const item = el('li');
      item.append(el('span', 'before-after-label', translateLabel(finding.label, lang())), document.createTextNode(` — ${preview(translateValue(finding, lang()), 80)}`));
      items.append(item);
    }
    column.append(items);
    return column;
  };
  columns.append(list(t().goneTitle(redacted.removed.length), redacted.removed, 'is-gone'), list(t().leftTitle(redacted.kept?.length ?? 0), redacted.kept ?? [], 'is-left'));
  box.append(columns);

  if (TEXT_FORMATS.has(format) && redacted.data && before.length <= MAX_DIFF && redacted.data.length <= MAX_DIFF) {
    const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    let original = decode(before);
    // A notebook comes back in Jupyter's layout; the original is laid out the same way first, so only content differs.
    if (format === 'ipynb') {
      try {
        original = `${JSON.stringify(JSON.parse(original), null, 1)}\n`;
      } catch {
        // Shown as it was.
      }
    }
    const shown = hunks(lineDiff(original, decode(redacted.data)), 2);
    box.append(el('p', 'before-after-head', t().diffTitle));
    if (!shown.some((line) => line.kind === 'removed' || line.kind === 'added')) box.append(el('p', 'note', t().diffSame));
    else {
      const pre = el('pre', 'diff');
      for (const line of shown) {
        if (line.kind === 'skip') pre.append(el('span', 'diff-line is-skip', t().diffSkip(line.count)));
        else pre.append(el('span', `diff-line is-${line.kind}`, `${line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ' '} ${showInvisible(line.text)}`));
      }
      box.append(pre);
    }
  }
  return box;
}

/** [F-2.2] Formats read and never rewritten. */
const LEGACY = new Set(['doc', 'xls', 'ppt', 'msg']);
/** [F-P2 2.2] Pictures read and never rewritten. */
const FIXED_PICTURES = new Set(['tiff', 'heic', 'avif']);
/** [F-P3 2.2] Archives read and never rewritten. */
const READ_ONLY_ARCHIVES = new Set(['tar', 'gz', '7z']);


function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  // [C11.5] A button's default type is submit; none of these submits anything.
  if (node instanceof HTMLButtonElement) node.type = 'button';
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

/* ---------------------------------------------------------------- tabs --- */

/**
 * A tablist is one stop in the tab order, not one per tab.
 *
 * That is the roving tabindex the ARIA authoring practices describe: only the
 * selected tab is reachable with Tab, and the arrow keys move between them.
 * Without it, someone navigating by keyboard has to step through every tab to
 * reach the panel, and the arrow keys — which is what they will reach for — do
 * nothing at all.
 */
function setupTabs(): void {
  const tabs = [
    { button: must<HTMLButtonElement>('#tab-files'), panel: must<HTMLElement>('#panel-files') },
    { button: must<HTMLButtonElement>('#tab-text'), panel: must<HTMLElement>('#panel-text') },
  ];

  const select = (index: number, focus = false): void => {
    tabs.forEach((tab, at) => {
      const selected = at === index;
      tab.button.setAttribute('aria-selected', String(selected));
      tab.button.tabIndex = selected ? 0 : -1;
      tab.panel.hidden = !selected;
    });
    if (focus) tabs[index]?.button.focus();
  };

  tabs.forEach(({ button }, index) => {
    button.addEventListener('click', () => select(index));
    button.addEventListener('keydown', (event) => {
      const last = tabs.length - 1;
      const target =
        event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
        : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0
        : event.key === 'End' ? last
        : undefined;
      if (target === undefined) return;
      event.preventDefault();
      select(target, true);
    });
  });

  select(tabs.findIndex((tab) => tab.button.getAttribute('aria-selected') === 'true') || 0);
}

/* ------------------------------------------------------------------ motion -- */

const SVG = 'http://www.w3.org/2000/svg';

/** A check mark drawn by its own stroke. `delay` waits for whatever it confirms. */
function check(delay = 0): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'check');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.setProperty('--draw-after', `${delay}ms`);
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M3 8.5l3.2 3.2L13 4.8');
  svg.append(path);
  return svg;
}

/** What a finding is about, the same identity the core uses to check a clean. */
const findingKey = (finding: Finding): string => `${finding.label}\u0000${finding.location}`;

/** Restart a CSS animation tied to a class, which re-adding the class alone will not do. */
function replay(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

/*
 * Mark the rows of a cleaned report, from what the core found by inspecting
 * the output — never on the cleaner's word alone.
 *
 * Struck: gone from the output. Amber edge: still there, and judged worth
 * saying so by the same rule the core's own note uses. Untouched: survivors
 * that rule sets aside, such as a structural trait the cleaner's rewrite now
 * carries itself. Judging that here, from the confidence a row had before the
 * clean, put "2 left in place" above a note that named one.
 */
function markCleaned(
  node: HTMLElement,
  removed: Finding[],
  kept: Finding[] = [],
): { removed: number; kept: number; last: number } {
  const gone = new Set(removed.map(findingKey));
  const remaining = new Set(kept.map(findingKey));
  let struck = 0;
  let flagged = 0;
  for (const row of node.querySelectorAll<HTMLTableRowElement>('tbody tr[data-key]')) {
    const key = row.dataset.key ?? '';
    if (gone.has(key)) {
      row.style.setProperty('--r', String(Math.min(struck, 10)));
      row.classList.add('is-removed');
      struck++;
    } else if (remaining.has(key)) {
      row.classList.add('is-kept');
      flagged++;
    }
  }
  // When the last stroke lands: base, the last row's offset, four cell offsets, one stroke.
  const last = 120 + Math.min(Math.max(struck - 1, 0), 10) * 70 + 4 * 60 + 240;
  return { removed: struck, kept: flagged, last };
}

/*
 * The hero's reading line. Each chip appears as the line reaches it, which
 * depends on where the chip sits at this width, so the delays are measured
 * rather than guessed. The line's visible edge is at `left + trail`, and
 * `left` runs linearly from -trail to the row's width, so the edge reaches x
 * at x / (width + trail) of the way through the sweep.
 */
const REVEAL_START_MS = 300;
const REVEAL_SWEEP_MS = 1600;
const TRAIL_PX = 120;

function playReveal(): void {
  if (!document.documentElement.classList.contains('motion')) return;
  const row = document.querySelector<HTMLElement>('.reveal-row.is-revealed');
  const line = [...(row?.querySelectorAll<HTMLElement>('.reveal-text') ?? [])].find(
    (candidate) => candidate.offsetParent !== null,
  );
  if (!row || !line) return;

  /*
   * Measured with every chip at its final width. The chips start collapsed,
   * and each one is revealed only after the ones to its left have opened, so
   * at the moment the line reaches a chip, that chip is already where it ends
   * up. One synchronous block: the measuring class is never painted.
   */
  row.classList.add('is-measuring');
  const box = row.getBoundingClientRect();
  for (const mark of line.querySelectorAll<HTMLElement>('.cp, .glyph')) {
    const rect = mark.getBoundingClientRect();
    const x = rect.left - box.left;
    const at = REVEAL_START_MS + (Math.max(x, 0) / (box.width + TRAIL_PX)) * REVEAL_SWEEP_MS;
    mark.style.setProperty('--at', `${Math.round(at)}ms`);
    if (mark.classList.contains('cp')) mark.style.setProperty('--w', `${Math.ceil(rect.width)}px`);
  }
  row.classList.remove('is-measuring');
  row.style.setProperty('--reveal-ms', `${REVEAL_SWEEP_MS}ms`);
  replay(row, 'is-scanning');
}

/* ------------------------------------------------------------- rendering -- */

/*
 * The text sits in an inline span rather than directly in the cell, so that a
 * strike can be drawn through the words themselves. An inline box's background
 * follows its line breaks, so the stroke crosses a three-line value line by
 * line, in reading order — where a line drawn across the cell ran through
 * empty space too and read as one more table rule.
 */
function cell(className: string | undefined, text: string): HTMLTableCellElement {
  const td = el('td', className);
  td.append(el('span', 'cell-text', text));
  return td;
}

function findingsTable(findings: Finding[]): HTMLElement {
  const scroll = el('div', 'table-scroll');
  const table = el('table');

  const head = el('thead');
  const headRow = el('tr');
  for (const label of t().columns) {
    headRow.append(el('th', undefined, label));
  }
  head.append(headRow);

  const body = el('tbody');
  for (const [index, finding] of findings.entries()) {
    const row = el('tr');
    if (finding.affectsVerifiability) row.className = 'flagged';
    row.dataset.key = findingKey(finding);
    // Capped, so a long report finishes arriving in a third of a second.
    row.style.setProperty('--i', String(Math.min(index, 12)));
    row.append(
      cell(`confidence confidence-${finding.confidence}`, t().confidence[finding.confidence]),
      cell('kind', t().kinds[finding.kind]),
      cell('label', translateLabel(finding.label, lang())),
      cell('value', preview(translateValue(finding, lang()), 120)),
      cell('location', translateLocation(finding.location, lang())),
    );
    body.append(row);
  }

  table.append(head, body);
  scroll.append(table);
  return scroll;
}

/**
 * « Ce fichier a-t-il été produit par une IA, et laquelle ? »
 *
 * Les lignes du tableau le disent déjà, réparties sur jusqu'à cinq d'entre
 * elles. Ce qu'elles ne savent pas faire, c'est répondre quand il n'y a rien :
 * un rapport silencieux se lit comme « pas d'IA », alors que la réponse
 * honnête est plus étroite que ça.
 */
function provenanceBanner(findings: Finding[]): HTMLElement {
  const { tools, attributed, declared, machineAssembled, assistantVoice } = provenance(findings);
  const node = el('div', attributed ? 'provenance is-attributed' : 'provenance');

  if (declared) {
    // Une déclaration prime sur une déduction : le fichier l'affirme lui-même,
    // dans le vocabulaire IPTC sur lequel les règles de transparence reposent.
    node.classList.add('is-declared');
    node.append(el('strong', undefined, t().provDeclared));
    node.append(
      el(
        'span',
        'provenance-caveat',
        tools.length ? t().provDeclaredTools(tools.join(' · ')) : t().provDeclaredBare,
      ),
    );
    return node;
  }
  if (attributed) {
    node.append(el('strong', undefined, t().provBy(tools.join(' · '))));
    node.append(el('span', 'provenance-caveat', t().provAttributedCaveat));
    return node;
  }
  if (tools.length) {
    node.append(el('strong', undefined, t().provBy(tools.join(' · '))));
    node.append(
      el(
        'span',
        'provenance-caveat',
        t().provToolCaveat + (machineAssembled ? t().provToolShapeAgrees : ''),
      ),
    );
    return node;
  }
  if (machineAssembled) {
    node.classList.add('is-attributed');
    node.append(el('strong', undefined, t().provMachine));
    node.append(el('span', 'provenance-caveat', t().provMachineCaveat));
    return node;
  }
  if (assistantVoice) {
    node.classList.add('is-attributed');
    node.append(el('strong', undefined, t().provVoice));
    node.append(el('span', 'provenance-caveat', t().provVoiceCaveat));
    return node;
  }
  node.append(el('strong', undefined, t().provNone));
  node.append(el('span', 'provenance-caveat', t().provNoneCaveat));
  return node;
}

/* ------------------------------------------------------------------ x-ray -- */

/**
 * Ahead of everything else in the card. Hidden text is often innocent; hidden
 * text that gives an assistant orders is the attack itself, and a reader who
 * forwards the file to one should know before anything else.
 */
function aimedBanner(count: number): HTMLElement {
  const node = el('div', 'aimed');
  node.setAttribute('role', 'alert');
  node.append(el('strong', undefined, t().aimedTitle(count)), el('span', undefined, t().aimedBody(count)));
  return node;
}

/*
 * What the page shows a reader, then what a model reads in the same place.
 *
 * Each picture is the page as rendered — a black bar, a stretch of blank
 * paper — with the hidden line boxed where it sits. The reading line then
 * crosses the box and leaves the extracted text written over it. A finding in
 * a table says the text is there; this shows that it is not visible, which is
 * the part a reader would otherwise have to take on trust.
 */
function xrayPanel(regions: XrayRegion[]): HTMLElement {
  const panel = el('section', 'xray');
  const head = el('div', 'xray-head');
  head.append(el('p', 'xray-title', t().xrayTitle), el('p', 'xray-sub', t().xraySub));

  const toggle = el('div', 'xray-toggle');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', t().xrayTitle);
  const reader = el('button', 'xray-mode', t().xrayReader);
  const model = el('button', 'xray-mode', t().xrayModel);
  const show = (revealed: boolean) => {
    panel.classList.toggle('is-revealed', revealed);
    reader.setAttribute('aria-pressed', String(!revealed));
    model.setAttribute('aria-pressed', String(revealed));
  };
  reader.addEventListener('click', () => show(false));
  model.addEventListener('click', () => show(true));
  toggle.append(reader, model);
  head.append(toggle);
  panel.append(head);

  for (const region of regions) panel.append(xrayShot(region));

  show(false);
  // Shown first as a reader sees it, then read: the order is the argument.
  setTimeout(() => show(true), 700);
  return panel;
}

function xrayShot(region: XrayRegion): HTMLElement {
  const figure = el('figure', 'xray-shot');
  const frame = el('div', 'xray-frame');
  const { width, height, rgba } = region.crop;
  frame.style.aspectRatio = `${width} / ${height}`;
  // Rendered at up to twice the page's size: shown a little smaller than
  // drawn, it stays sharp on a dense screen and is never blown up.
  frame.style.width = `min(100%, ${Math.round(width * 0.75)}px)`;

  const canvas = el('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t().xrayPicture(region.page));
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

  const box = el('div', 'xray-box');
  box.style.left = `${(region.box.x / width) * 100}%`;
  box.style.top = `${(region.box.y / height) * 100}%`;
  box.style.width = `${(region.box.width / width) * 100}%`;
  box.style.height = `${(region.box.height / height) * 100}%`;
  // Sized to the line it replaces: its height, as a share of the frame's width.
  box.style.setProperty('--line', String(region.box.height / width));
  const text = el('span', 'xray-text', region.text);
  box.append(text);
  frame.append(canvas, box);

  const caption = el('figcaption');
  caption.append(
    el('span', 'xray-where', `p. ${region.page} · ${translateLabel(region.label, lang())}`),
    el('q', 'xray-quote', region.text),
  );
  figure.append(frame, caption);

  // A proportional face rarely matches the document's to the pixel. Once laid
  // out, a line that runs long is narrowed to its box rather than cut.
  requestAnimationFrame(() => {
    const room = box.clientWidth;
    const need = text.scrollWidth;
    if (room > 0 && need > room) text.style.setProperty('--fit', String(room / need));
  });
  return figure;
}

function card(title: string, badge?: string, count?: string): HTMLElement {
  const node = el('article', 'card');
  const head = el('div', 'card-head');
  head.append(el('h3', 'card-title', title));
  if (badge) head.append(el('span', 'badge', badge));
  if (count) head.append(el('span', 'count', count));
  node.append(head);
  return node;
}

function appendNotes(node: HTMLElement, notes: Note[]): void {
  for (const note of notes) {
    const warn = note.code === 'removed:c2pa';
    node.append(el('p', warn ? 'note note-warn' : 'note', noteText(note, lang())));
  }
}

function download(data: Uint8Array, filename: string, mime: string): void {
  // Copy into a fresh ArrayBuffer so the Blob never aliases a detached buffer.
  const blob = new Blob([new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function cleanName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? `${name}.clean` : `${name.slice(0, dot)}.clean${name.slice(dot)}`;
}

/* ----------------------------------------------------------------- files -- */

/**
 * Every file analysed this session, in the order they were dropped.
 *
 * Kept in the same shape the CLI's `--json` emits, so a report exported from
 * the page and one produced by `cirta inspect --json` can be compared or fed to
 * the same script without a translation step.
 */
interface SessionEntry {
  file: string;
  /** [F-P2 2.7] Its path inside a dropped folder; the name alone otherwise. */
  path: string;
  result?: InspectResult;
  error?: string;
}
const session: SessionEntry[] = [];
/** The bytes behind each entry, for cleaning them all at once; kept out of the exported report. */
const sources = new WeakMap<SessionEntry, File>();
/** What the last batch clean said, shown again when the summary is redrawn. */
let batchStatus: { text: string; error?: boolean } | undefined;

/** Tally and export, refreshed after each file resolves. */
function renderSummary(anchor: HTMLElement): void {
  const done = session.filter((entry) => entry.result || entry.error);
  const existing = document.querySelector('#file-summary');
  if (done.length === 0) {
    existing?.remove();
    return;
  }

  const node = el('div', 'summary');
  node.id = 'file-summary';

  const flagged = done.filter((entry) =>
    entry.result?.findings.some((f) => f.confidence === 'confirmed'),
  ).length;
  const failures = done.filter((entry) => entry.error).length;

  const parts = [t().fileCount(done.length)];
  parts.push(flagged ? t().flaggedCount(flagged) : t().noneFlagged);
  if (failures) parts.push(t().failureCount(failures));

  const text = el('p', flagged || failures ? 'summary-text is-flagged' : 'summary-text', parts.join(' · '));
  const button = el('button', 'button button-small', t().exportReport);
  button.addEventListener('click', () => {
    const json = JSON.stringify(done.map(({ file, path, result, error }) => ({ file: path === file ? file : path, result, error })), null, 2);
    download(new TextEncoder().encode(json), 'cirta-rapport.json', 'application/json');
  });

  // [F-P2 2.7] The same report as a page or as Markdown, in the page's language.
  const reportEntries = () => done.map((entry) => ({ file: entry.path, result: entry.result, error: entry.error }));
  const html = el('button', 'button button-small', t().exportHtml);
  html.title = t().exportTitle;
  html.addEventListener('click', () => download(new TextEncoder().encode(reportHtml(reportEntries(), lang(), { version: __CIRTA_VERSION__ })), 'cirta-rapport.html', 'text/html'));
  const markdown = el('button', 'button button-small', t().exportMarkdown);
  markdown.title = t().exportTitle;
  markdown.addEventListener('click', () => download(new TextEncoder().encode(reportMarkdown(reportEntries(), lang(), { version: __CIRTA_VERSION__ })), 'cirta-rapport.md', 'text/markdown'));

  node.append(text, button, html, markdown);
  // [F-P2 2.7] Every file of the session through one clean, into one ZIP with its manifest.
  const cleanable = done.filter((entry) => entry.result && sources.has(entry));
  if (cleanable.length >= 2) {
    const all = el('button', 'button button-small button-primary', t().cleanAll(cleanable.length));
    all.title = t().cleanAllOptions;
    all.addEventListener('click', () => void cleanSession(cleanable, all, anchor));
    node.append(all);
  }
  if (batchStatus) node.append(el('p', batchStatus.error ? 'error' : 'note', batchStatus.text));
  if (existing) existing.replaceWith(node);
  else anchor.before(node);
}

/** [F-P2 2.7] Clean every file of the session with the advanced options, and hand back one ZIP. */
async function cleanSession(entries: SessionEntry[], button: HTMLButtonElement, anchor: HTMLElement): Promise<void> {
  button.disabled = true;
  let done = 0;
  button.textContent = t().cleaningAll(done, entries.length);
  try {
    const files = await Promise.all(entries.map(async (entry) => ({ path: entry.path, data: new Uint8Array(await sources.get(entry)!.arrayBuffer()) })));
    const choices = { ...cleanState };
    const outcome = await cleanBatch(
      files,
      {
        inspect: async (data, hint) => (await inspectFile(data, formatHint(hint ?? '') ?? hint)).result,
        redact: async (data, hint) => {
          const result = await redactFile(data, formatHint(hint ?? '') ?? hint, choices);
          button.textContent = t().cleaningAll(++done, entries.length);
          return result;
        },
      },
      { version: __CIRTA_VERSION__, options: choices },
    );
    download(outcome.zip, 'cirta-nettoye.zip', 'application/zip');
    const refusals = outcome.refused.map((r) => `${r.file} — ${errorText(r.error, lang())}`);
    batchStatus = { text: [t().cleanedAll(outcome.manifest.files.length, outcome.refused.length), ...refusals].join('\n') };
  } catch (error) {
    batchStatus = { text: errorText(error, lang()), error: true };
  }
  renderSummary(anchor);
}

async function handleFile(file: File, container: HTMLElement, path = file.name): Promise<void> {
  const node = card(path, undefined, t().analysing);
  node.classList.add('is-busy');
  container.prepend(node);

  // Claimed synchronously so the export keeps the order files were dropped in,
  // not the order the worker happened to finish them.
  const entry: SessionEntry = { file: file.name, path };
  session.push(entry);
  sources.set(entry, file);
  const record = (patch: Partial<typeof entry>) => {
    Object.assign(entry, patch);
    renderSummary(container);
  };

  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    node.append(el('p', 'error', t().unreadable));
    record({ error: t().unreadable });
    return;
  }

  try {
    const { result, hidden } = await inspectFile(data, formatHint(file.name));
    record({ result });
    node.classList.remove('is-busy');
    const count = node.querySelector('.count');
    const badge = el('span', 'badge', result.format);
    node.querySelector('.card-head')?.insertBefore(badge, count);
    if (count) {
      count.textContent = result.findings.length
        ? t().itemCount(result.findings.length)
        : t().noMetadata;
    }

    // Les images et les archives n'ont pas de champ producteur à interroger.
    const aimed = result.findings.filter((f) => f.label === AIMED_LABEL).length;
    if (aimed) node.append(aimedBanner(aimed));
    if (result.format !== 'zip') node.append(provenanceBanner(result.findings));
    if (hidden.length) node.append(xrayPanel(hidden));

    if (result.findings.length === 0) {
      node.append(el('p', 'empty', t().nothingIdentifying));
    } else {
      node.append(findingsTable(result.findings));

      if (LEGACY.has(result.format)) {
        // [F-2.2] Inspected, never rewritten: the reason and what to do, before any click.
        node.append(el('p', 'note', errorText({ code: 'legacy-not-rewritable', detail: result.format }, lang())));
      } else if (FIXED_PICTURES.has(result.format)) {
        node.append(el('p', 'note', errorText({ code: 'image-not-rewritable', detail: result.format }, lang())));
      } else if (READ_ONLY_ARCHIVES.has(result.format)) {
        node.append(el('p', 'note', errorText({ code: 'archive-inspect-only', detail: result.format }, lang())));
      } else {
        const foot = el('div', 'card-foot');
        // [F-2.7] The options this file is offered — its format takes them and
        // it holds what they change — ticked as the advanced options say, and
        // what the download will do, stated before it happens.
        const boxes = new Map<CleanKey, HTMLInputElement>();
        for (const offer of offered(result.format, result.findings)) {
          const box = el('input');
          box.type = 'checkbox';
          box.checked = cleanState[offer.key] === true;
          const label = el('label', 'foot-option');
          label.append(box, document.createTextNode(OPTION_LABEL[offer.key](offer.count)));
          foot.append(label);
          boxes.set(offer.key, box);
        }
        // [F-P2 2.4] An archive's members are cleaned one by one, each with the advanced options.
        const choices = (): CleanChoices =>
          result.format === 'zip' ? { ...cleanState } : Object.fromEntries([...boxes].map(([key, box]) => [key, box.checked]));
        const summary = el('div', 'clean-plan');
        summary.setAttribute('aria-live', 'polite');
        const showPlan = () => {
          const list = el('ul');
          list.append(el('li', undefined, t().planMetadata));
          if (result.format === 'zip') list.append(el('li', undefined, t().planArchive));
          for (const step of plan(result.format, result.findings, choices())) list.append(el('li', undefined, OPTION_LABEL[step.key](step.count)));
          summary.replaceChildren(el('p', 'clean-plan-title', t().planTitle), list);
          if (boxes.size && ![...boxes.values()].some((box) => box.checked)) summary.append(el('p', 'note', t().planContentKept));
        };
        for (const box of boxes.values()) box.addEventListener('change', showPlan);
        showPlan();
        foot.append(summary);

        const button = el('button', 'button button-primary', t().download);
        button.addEventListener('click', async () => {
          button.disabled = true;
          button.textContent = t().cleaning;
          node.classList.add('is-cleaning');
          try {
            const redacted = await redactFile(data, formatHint(file.name), choices());
            for (const box of boxes.values()) box.disabled = true;
            download(redacted.data!, cleanName(file.name), MIME[redacted.format]);
            node.classList.remove('is-cleaning');
            button.replaceChildren(check(), document.createTextNode(t().downloaded));
            button.classList.add('is-done');

            const marked = markCleaned(node, redacted.removed, redacted.kept);
            const status = el('span', 'foot-status');
            status.style.setProperty('--draw-after', `${marked.last}ms`);
            status.append(check(marked.last), document.createTextNode(t().reinspected(marked.removed, marked.kept)));
            foot.append(status);
            // Redaction surfaces caveats inspection cannot: a dropped C2PA
            // manifest, and — more importantly — what was found and left in
            // place. Dropping those on the floor would make the browser claim
            // more than the CLI does for the same file.
            // Every note the clean adds — removed, kept, but also pages rasterised,
            // annotations flattened, text recomposed, a picture rebuilt — not
            // only the first two; scope notes are already on the card.
            const fresh = redacted.notes.filter((n) => !n.code.startsWith('scope:') && !n.code.startsWith('limit:'));
            if (fresh.length) appendNotes(node, fresh);
            node.append(beforeAfter(result.format, data, redacted));
          } catch (error) {
            node.classList.remove('is-cleaning');
            button.textContent = t().cleanFailed;
            node.append(el('p', 'error', errorText(error, lang())));
          }
        });
        foot.append(button);
        node.append(foot);
      }
    }

    appendNotes(node, result.notes);
  } catch (error) {
    node.classList.remove('is-busy');
    node.querySelector('.count')?.remove();
    const message = errorText(error, lang());
    node.append(el('p', 'error', message));
    record({ error: message });
  }
}

function setupFiles(): void {
  const dropzone = must<HTMLElement>('#dropzone');
  const input = must<HTMLInputElement>('#file-input');
  const results = must<HTMLElement>('#file-results');

  const accept = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) void handleFile(file, results);
  };
  // [F-P2 2.7] A folder: the files the command line would take from it, under their paths.
  const acceptFolder = (found: Array<{ file: File; path: string }>) => {
    const kept = found.filter(({ path }) => {
      const parts = path.split('/');
      return isSupportedFile(parts.at(-1) ?? '') && parts.slice(1, -1).every((dir) => isWalkedDirectory(dir));
    });
    const skipped = found.length - kept.length;
    document.querySelector('#folder-skipped')?.remove();
    if (skipped) {
      const note = el('p', 'note', t().folderSkipped(skipped));
      note.id = 'folder-skipped';
      results.before(note);
    }
    for (const { file, path } of kept.sort((a, b) => a.path.localeCompare(b.path))) void handleFile(file, results, path);
  };
  const folder = must<HTMLInputElement>('#folder-input');
  must<HTMLButtonElement>('#folder-pick').addEventListener('click', (event) => {
    // The drop zone opens the file picker on a click; this one opens the folder picker.
    event.stopPropagation();
    folder.click();
  });
  folder.addEventListener('change', () => {
    acceptFolder(Array.from(folder.files ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name })));
    folder.value = '';
  });

  // [F-P3 2.7] The zone opens the picker on a click, for the mouse; the keyboard has #file-pick.
  dropzone.addEventListener('click', () => input.click());
  must<HTMLButtonElement>('#file-pick').addEventListener('click', (event) => {
    event.stopPropagation();
    input.click();
  });
  input.addEventListener('change', () => {
    accept(input.files);
    input.value = '';
  });

  for (const type of ['dragenter', 'dragover'] as const) {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-active');
    });
  }
  for (const type of ['dragleave', 'drop'] as const) {
    dropzone.addEventListener(type, () => dropzone.classList.remove('is-active'));
  }
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    const entries = Array.from(event.dataTransfer?.items ?? [])
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => Boolean(entry));
    if (!entries.some((entry) => entry.isDirectory)) {
      accept(event.dataTransfer?.files ?? null);
      return;
    }
    void readEntries(entries).then(acceptFolder);
  });
}

/** [F-P2 2.7] Every file under dropped entries, a folder read to the end (readEntries gives a hundred at a time). */
async function readEntries(entries: FileSystemEntry[]): Promise<Array<{ file: File; path: string }>> {
  const out: Array<{ file: File; path: string }> = [];
  const visit = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, path: entry.fullPath.replace(/^\//, '') });
      return;
    }
    if (!entry.isDirectory) return;
    if (entry.fullPath.split('/').length > 2 && !isWalkedDirectory(entry.name)) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await visit(child);
    }
  };
  for (const entry of entries) await visit(entry);
  return out;
}

/** [F-2.7] The advanced cleaning options, remembered in this browser; each new card starts from them. */
function setupCleanOptions(): void {
  const boxes = [...document.querySelectorAll<HTMLInputElement>('#clean-options input[data-clean]')];
  // [F-P2 2.3] A profile ticks its options and unticks the others, as the command line's --profile sets them.
  for (const button of document.querySelectorAll<HTMLButtonElement>('#clean-options button[data-profile]')) {
    button.addEventListener('click', () => {
      const chosen = PROFILES[button.dataset.profile as ProfileName];
      for (const box of boxes) {
        box.checked = chosen.options[box.dataset.clean as CleanKey] === true;
        box.dispatchEvent(new Event('change'));
      }
    });
  }
  for (const box of boxes) {
    const key = box.dataset.clean as CleanKey;
    box.checked = cleanState[key] === true;
    box.addEventListener('change', () => {
      if (box.checked) cleanState[key] = true;
      else delete cleanState[key];
      store(CLEAN_STORE, Object.keys(cleanState).length ? JSON.stringify(cleanState) : null);
    });
  }
}

/** [F-2.3] Personal data and the organisation's rules, remembered in this browser. */
function setupScanOptions(): void {
  const pii = must<HTMLInputElement>('#scan-pii');
  const pick = must<HTMLButtonElement>('#rules-pick');
  const input = must<HTMLInputElement>('#rules-input');
  const status = must<HTMLElement>('#rules-status');
  const forget = must<HTMLButtonElement>('#rules-forget');

  const show = () => {
    if (scanState.rules) {
      try {
        status.textContent = t().rulesLoaded(scanState.rulesName ?? '', parseRules(scanState.rules).length);
        status.classList.remove('is-error');
      } catch (error) {
        status.textContent = errorText(error, lang());
        status.classList.add('is-error');
      }
    } else status.textContent = '';
    forget.hidden = !scanState.rules;
  };

  pii.checked = scanState.pii;
  pii.addEventListener('change', () => {
    scanState.pii = pii.checked;
    store(STORE.pii, pii.checked ? '1' : null);
  });
  pick.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    try {
      parseRules(text);
    } catch (error) {
      // A file that does not read is not kept: the rules in use stay as they were.
      status.textContent = errorText(error, lang());
      status.classList.add('is-error');
      return;
    }
    scanState.rules = text;
    scanState.rulesName = file.name;
    store(STORE.rules, text);
    store(STORE.rulesName, file.name);
    show();
  });
  forget.addEventListener('click', () => {
    scanState.rules = undefined;
    scanState.rulesName = undefined;
    store(STORE.rules, null);
    store(STORE.rulesName, null);
    show();
  });
  show();
  document.addEventListener('cirta:language', show);
}

/* ------------------------------------------------------------------ text -- */

function setupText(): void {
  const input = must<HTMLTextAreaElement>('#text-input');
  const results = must<HTMLElement>('#text-results');
  const scanButton = must<HTMLButtonElement>('#text-scan');
  const cleanButton = must<HTMLButtonElement>('#text-clean');
  const normalizeSpaces = must<HTMLInputElement>('#text-normalize-spaces');

  const render = (node: HTMLElement) => {
    results.replaceChildren(node);
  };

  const scopeNote: Note[] = [{ code: 'scope:invisible-characters-only' }];

  /*
   * The paste itself. A text field keeps only the text; the HTML version the
   * clipboard also offered is read here, once, and what it carried is shown in
   * its own slot so that Analyse and Clean, which redraw the results below, do
   * not wipe it. Nothing is prevented: the text still lands in the field as it
   * always did. A paste with no HTML at all — from a plain editor — clears the
   * slot and shows nothing, which is the right amount to say about it.
   */
  const clipboardSlot = must<HTMLElement>('#clipboard-results');
  input.addEventListener('paste', (event) => {
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (!html.trim()) {
      clipboardSlot.replaceChildren();
      return;
    }
    const findings = inspectClipboardHtml(html);
    const node = card(t().clipboardTitle, undefined, findings.length ? t().itemCount(findings.length) : undefined);
    if (findings.length) {
      node.append(findingsTable(findings));
      node.append(el('p', 'note', t().clipboardNote));
    } else {
      node.append(el('p', 'empty', t().clipboardClean));
    }
    clipboardSlot.replaceChildren(node);
  });

  scanButton.addEventListener('click', () => {
    // La même lecture qu'un fichier reçoit. Le collage restait plus pauvre que
    // l'onglet Fichiers sur des octets identiques : un brouillon d'e-mail
    // enregistré nommait l'assistant, collé ici il ne montrait que ses
    // caractères bizarres.
    const findings = inspectPlainText(input.value);
    const node = card(
      t().scanTitle,
      undefined,
      findings.length ? t().itemCount(findings.length) : t().textFound,
    );
    node.append(provenanceBanner(findings));
    if (findings.length === 0) {
      node.append(el('p', 'empty', t().textNothing));
    } else {
      node.append(findingsTable(findings));
    }
    appendNotes(node, scopeNote);
    const style = styleCard(input.value);
    results.replaceChildren(node, exposureCard(input.value), ...(style ? [style] : []));
  });

  cleanButton.addEventListener('click', async () => {
    // The same clean the CLI runs: invisible characters, then mail headers that
    // name a tool, then Markdown a mail client would show as symbols.
    const result = cleanPlainText(input.value, { normalizeSpaces: normalizeSpaces.checked });
    input.value = result.text;
    // Only when something actually changed: a field that flashes "cleaned"
    // over identical text would be the page claiming work it did not do.
    const changed =
      result.removed.length || result.headersRemoved.length || result.markdownRemoved || result.spacesReplaced || result.recomposed;
    if (changed) replay(input, 'is-cleaned');

    // The count covers everything the clean took out, not only characters: a
    // header reading "nothing to remove" above "Markdown removed" contradicted
    // the card it sat on.
    const node = card(
      t().cleanTitle,
      undefined,
      result.removed.length
        ? t().removedCount(result.removed.length)
        : result.markdownRemoved || result.headersRemoved.length || result.spacesReplaced || result.recomposed
          ? t().formattingRemoved
          : t().nothingToRemove,
    );
    if (result.removed.length === 0) {
      node.append(el('p', 'empty', t().textNoInvisible));
    } else {
      const table = findingsTable(result.removed);
      // These rows arrive already removed, so the stroke waits for them to land.
      node.style.setProperty('--strike-base', '420ms');
      table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row, index) => {
        row.style.setProperty('--r', String(Math.min(index, 10)));
        row.classList.add('is-removed');
      });
      node.append(table);
    }
    for (const payload of result.decoded) {
      node.append(el('p', 'decoded', t().payloadRemoved(payload)));
    }

    if (result.headersRemoved.length) {
      node.append(el('p', 'note', t().headersRemoved(result.headersRemoved.join(', '))));
    }
    if (result.markdownRemoved) node.append(el('p', 'note', t().markdownRemoved(result.markdownRemoved)));
    if (result.markdownKept) node.append(el('p', 'note', t().markdownKept));

    // [C8] Every change to the words is announced, with its count.
    if (result.recomposed) node.append(el('p', 'note', t().recomposed(result.recomposed)));
    if (result.spacesReplaced) node.append(el('p', 'note', t().spacesReplaced(result.spacesReplaced)));
    if (result.spacesKept) node.append(el('p', 'note', t().spacesKept(result.spacesKept)));

    // Ce que le nettoyage laisse — lettres sosies, secret, symboles stylisés —,
    // mesuré en relisant le texte nettoyé. Sans cette mention, le décompte
    // ci-dessus se lirait comme « c'est propre ». Les phrases à revoir ont leur
    // propre tableau juste en dessous.
    const reviewed = new Set(result.toReview.map((f) => `${f.label}\u0000${f.location}`));
    const survivors = result.survivors.filter((f) => !reviewed.has(`${f.label}\u0000${f.location}`));
    if (survivors.length) {
      node.append(el('p', 'note note-warn', t().keptWarning));
      node.append(findingsTable(survivors));
    }

    // Lines an assistant addressed to you, and placeholders still to fill.
    // Words, so they are shown and left; the lines can go on request.
    const voice = result.toReview.filter((f) => f.label === 'Written to you, not to the recipient');
    if (result.toReview.length) {
      node.append(el('p', 'note note-warn', t().toReviewNote));
      node.append(findingsTable(result.toReview));
    }

    const foot = el('div', 'card-foot');
    if (voice.length) {
      const drop = el('button', 'button button-primary', t().dropAssistantLines(voice.length));
      drop.addEventListener('click', () => {
        const removed = removeScaffolding(input.value);
        if (removed.removed.length === 0) return;
        input.value = removed.text;
        replay(input, 'is-cleaned');
        // The same stroke as every other removal, drawn through these rows only.
        node.style.setProperty('--strike-base', '40ms');
        markCleaned(node, voice);
        drop.disabled = true;
        drop.replaceChildren(check(), document.createTextNode(t().assistantLinesDropped(removed.removed.length)));
        drop.classList.add('is-done');
      });
      foot.append(drop);
    }
    const copy = el('button', 'button', t().copyCleaned);
    copy.addEventListener('click', async () => {
      // What is in the field when the button is pressed, which may be shorter
      // than what the clean produced if the lines above were taken out since.
      try {
        await navigator.clipboard.writeText(input.value);
        copy.replaceChildren(check(), document.createTextNode(t().copied));
      } catch {
        input.select();
        copy.textContent = t().selected;
      }
    });
    foot.append(copy);
    node.append(foot);

    appendNotes(node, scopeNote);
    render(node);
  });
}

/**
 * The language switch.
 *
 * Static copy is already in the page twice and CSS picks a half, so switching
 * is one attribute. What script has to redo is everything it built itself:
 * every card in the results is French or English prose generated at the time it
 * was rendered, and there is no way to relabel it in place. Clearing the
 * results is the honest option — the alternative is a page in two languages at
 * once. The files stay in `session`, so the summary and its JSON export
 * survive; only the rendered cards go.
 */
function setupLanguage(): void {
  const button = must<HTMLButtonElement>('#lang-toggle');
  const input = must<HTMLTextAreaElement>('#text-input');

  const apply = () => {
    button.textContent = t().langLabel;
    button.title = t().langTitle;
    input.placeholder = t().placeholder;
    // The tab title and the description a search engine or a link preview
    // quotes are part of the page, and stayed French when everything visible
    // had switched.
    document.title = t().docTitle;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', t().docDescription);
  };

  setLang(lang());
  apply();

  button.addEventListener('click', () => {
    setLang(lang() === 'fr' ? 'en' : 'fr');
    apply();
    // The other language's sentence was hidden, so its chips were never read.
    requestAnimationFrame(playReveal);
    for (const id of ['#file-results', '#text-results', '#clipboard-results']) {
      document.querySelector(id)?.replaceChildren();
    }
    document.querySelector('#file-summary')?.remove();
    session.length = 0;
    // Text written by a handler rather than the markup follows the language too.
    document.dispatchEvent(new Event('cirta:language'));
  });
}

setupLanguage();
setupTabs();
setupFiles();
setupScanOptions();
setupCleanOptions();
setupText();
// Two frames, so layout has settled and the chips' positions are final.
requestAnimationFrame(() => requestAnimationFrame(playReveal));
if (document.readyState === 'complete') warmWorker();
else addEventListener('load', warmWorker, { once: true });

/**
 * [F-P2 2.7] The « verify » box: the build's version and commit, and a file's
 * SHA-256 computed here and looked up in the list the build wrote into the page.
 */
function setupVerify(): void {
  // Not in the browser extension, whose build leaves the box out (scripts/build-browser-extension.mjs).
  if (!document.querySelector('#verify-site')) return;
  must<HTMLElement>('#site-version').textContent = __CIRTA_VERSION__;
  const link = must<HTMLAnchorElement>('#site-commit');
  link.href = `https://github.com/K3E9X/Cirta/commit/${encodeURIComponent(__CIRTA_COMMIT__)}`;
  link.querySelector('code')!.textContent = __CIRTA_COMMIT__.slice(0, 12);
  const hashes = [...document.querySelectorAll<HTMLTableRowElement>('#site-hashes tr')].map((row): [string, string] => [row.cells[0]?.textContent ?? '', row.cells[1]?.textContent ?? '']);
  const result = must<HTMLElement>('#verify-result');
  // Written again when the language changes.
  let say = (): string => (hashes.length ? '' : t().verifyDevBuild);
  const show = () => (result.textContent = say());
  show();
  document.addEventListener('cirta:language', show);
  const input = must<HTMLInputElement>('#verify-input');
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    const hash = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    const found = matchHash(hashes, hash);
    say = () => (found ? t().verifyMatch(found, hash) : t().verifyNoMatch(hash));
    show();
    result.classList.toggle('is-match', Boolean(found));
    input.value = '';
  });
}
setupVerify();

/**
 * [F-P2 2.7] Offline: the service worker keeps this site's files (see src/shared/site.ts).
 * Built pages only — the development server has none to keep.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      for (const [id, text] of [['#offline-status-fr', 'Disponible hors ligne dans ce navigateur.'], ['#offline-status-en', 'Available offline in this browser.']] as const) {
        const node = document.querySelector(id);
        if (node) node.textContent = text;
      }
    })
    .catch(() => undefined);
}
