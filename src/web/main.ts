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

import type { WorkerRequest, WorkerResponse } from './worker.js';
// Imported from the individual modules rather than the barrel: pulling in
// core/index.js would drag pdf-lib and fflate into the main bundle, when the
// only code that needs them now runs in the worker.
import { cleanText } from '../core/text.js';
import { inspectPlainText } from '../core/plaintext.js';
import { stripToolHeaders } from '../core/email.js';
import { translateLabel, translateValue, translateLocation, noteText } from '../shared/french.js';
import { lang, setLang, t } from './i18n.js';
import { provenance } from '../core/fingerprint.js';
import { exposure, type Exposure } from '../core/exposure.js';
import { stylometry } from '../core/stylometry.js';
import {
  preview,
  type Confidence,
  type Finding,
  type Format,
  type Note,
  type InspectResult,
  type RedactResult,
} from '../core/types.js';

/**
 * Analysis runs in a worker so a large PDF or archive cannot freeze the tab.
 * The worker is created on first use rather than at load, so a visitor who only
 * uses the text panel never pays for it.
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
    else entry.reject(new Error(event.data.error));
  });
  worker.addEventListener('error', (event) => {
    for (const [, entry] of pending) entry.reject(new Error(event.message || 'worker failed'));
    pending.clear();
  });
  return worker;
}

function ask<T>(op: WorkerRequest['op'], data: Uint8Array, hint?: string): Promise<T> {
  const id = nextRequestId++;
  // A copy is transferred so the caller keeps its own bytes for a later redact.
  const buffer = data.slice().buffer;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: never) => void, reject });
    ensureWorker().postMessage({ id, op, data: buffer, hint } satisfies WorkerRequest, [buffer]);
  });
}

const inspectFile = async (data: Uint8Array, hint?: string): Promise<InspectResult> =>
  (await ask<{ result: InspectResult }>('inspect', data, hint)).result;

const redactFile = async (data: Uint8Array, hint?: string): Promise<RedactResult> => {
  const reply = await ask<{ result: Omit<RedactResult, 'data'>; data?: ArrayBuffer }>(
    'redact',
    data,
    hint,
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
  zip: 'application/zip',
  text: 'text/plain',
};

/** Extensions whose bytes alone do not identify the format. */
function formatHint(name: string): string | undefined {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  return undefined;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
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

/* ------------------------------------------------------------- rendering -- */

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
  for (const finding of findings) {
    const row = el('tr');
    if (finding.affectsVerifiability) row.className = 'flagged';
    row.append(
      el('td', `confidence confidence-${finding.confidence}`, t().confidence[finding.confidence]),
    );
    row.append(el('td', 'kind', t().kinds[finding.kind]));
    row.append(el('td', undefined, translateLabel(finding.label, lang())));
    row.append(el('td', 'value', preview(translateValue(finding, lang()), 120)));
    row.append(el('td', 'location', translateLocation(finding.location, lang())));
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
  const { tools, attributed, declared, machineAssembled } = provenance(findings);
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
  node.append(el('strong', undefined, t().provNone));
  node.append(el('span', 'provenance-caveat', t().provNoneCaveat));
  return node;
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
const session: Array<{ file: string; result?: InspectResult; error?: string }> = [];

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
    const json = JSON.stringify(done, null, 2);
    download(new TextEncoder().encode(json), 'cirta-rapport.json', 'application/json');
  });

  node.append(text, button);
  if (existing) existing.replaceWith(node);
  else anchor.before(node);
}

async function handleFile(file: File, container: HTMLElement): Promise<void> {
  const node = card(file.name, undefined, t().analysing);
  node.classList.add('is-busy');
  container.prepend(node);

  // Claimed synchronously so the export keeps the order files were dropped in,
  // not the order the worker happened to finish them.
  const entry: { file: string; result?: InspectResult; error?: string } = { file: file.name };
  session.push(entry);
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
    const result = await inspectFile(data, formatHint(file.name));
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
    if (result.format !== 'zip') node.append(provenanceBanner(result.findings));

    if (result.findings.length === 0) {
      node.append(el('p', 'empty', t().nothingIdentifying));
    } else {
      node.append(findingsTable(result.findings));

      // A plain archive is reported, never rewritten — redaction throws on it.
      // Offering the button and failing on the click is a promise the page
      // cannot keep, so it says so up front instead.
      if (result.format === 'zip') {
        node.append(
          el(
            'p',
            'note',
            t().archiveNote,
          ),
        );
      } else {
        const foot = el('div', 'card-foot');
        const button = el('button', 'button button-primary', t().download);
        button.addEventListener('click', async () => {
          button.disabled = true;
          button.textContent = 'Nettoyage…';
          try {
            const redacted = await redactFile(data, formatHint(file.name));
            download(redacted.data!, cleanName(file.name), MIME[redacted.format]);
            button.textContent = t().downloaded;
            // Redaction surfaces caveats inspection cannot: a dropped C2PA
            // manifest, and — more importantly — what was found and left in
            // place. Dropping those on the floor would make the browser claim
            // more than the CLI does for the same file.
            const fresh = redacted.notes.filter(
              (n) => n.code === 'removed:c2pa' || n.code.startsWith('kept:'),
            );
            if (fresh.length) appendNotes(node, fresh);
          } catch (error) {
            button.textContent = t().cleanFailed;
            node.append(el('p', 'error', error instanceof Error ? error.message : String(error)));
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
    const message = error instanceof Error ? error.message : String(error);
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

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
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
    accept(event.dataTransfer?.files ?? null);
  });
}

/* ------------------------------------------------------------------ text -- */

function setupText(): void {
  const input = must<HTMLTextAreaElement>('#text-input');
  const results = must<HTMLElement>('#text-results');
  const scanButton = must<HTMLButtonElement>('#text-scan');
  const cleanButton = must<HTMLButtonElement>('#text-clean');

  const render = (node: HTMLElement) => {
    results.replaceChildren(node);
  };

  const scopeNote: Note[] = [{ code: 'scope:invisible-characters-only' }];

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
    const result = cleanText(input.value);
    // Les en-têtes de courrier qui nomment un outil partent aussi : sur un
    // brouillon généré, X-Mailer est la marque la plus explicite du fichier.
    // Les en-têtes du message lui-même — From, Subject, Message-ID — restent :
    // c'est du contenu, et ils sont signalés comme laissés en place.
    const stripped = stripToolHeaders(result.text);
    input.value = stripped.text;

    const node = card(
      t().cleanTitle,
      undefined,
      result.removed.length
        ? t().removedCount(result.removed.length)
        : t().nothingToRemove,
    );
    if (result.removed.length === 0) {
      node.append(el('p', 'empty', t().textNoInvisible));
    } else {
      node.append(findingsTable(result.removed));
    }
    for (const payload of result.decoded) {
      node.append(el('p', 'decoded', t().payloadRemoved(payload)));
    }

    // Les lettres sosies font partie d'un mot : le nettoyage ne les touche pas.
    // Sans cette mention, le décompte ci-dessus se lirait comme « c'est propre ».
    if (stripped.removed.length) {
      node.append(
        el(
          'p',
          'note',
          t().headersRemoved(stripped.removed.join(', ')),
        ),
      );
    }

    if (result.kept.length) {
      node.append(el('p', 'note note-warn', t().keptWarning));
      node.append(findingsTable(result.kept));
    }

    const foot = el('div', 'card-foot');
    const copy = el('button', 'button', t().copyCleaned);
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(stripped.text);
        copy.textContent = t().copied;
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
  };

  setLang(lang());
  apply();

  button.addEventListener('click', () => {
    setLang(lang() === 'fr' ? 'en' : 'fr');
    apply();
    for (const id of ['#file-results', '#text-results']) {
      document.querySelector(id)?.replaceChildren();
    }
    document.querySelector('#file-summary')?.remove();
    session.length = 0;
  });
}

setupLanguage();
setupTabs();
setupFiles();
setupText();
