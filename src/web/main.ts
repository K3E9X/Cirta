/**
 * Browser front-end for Cirta.
 *
 * Every operation runs on the main thread against the local File object; there
 * is no fetch/XHR/WebSocket anywhere in this bundle, and no file ever leaves
 * the machine. The scope statement in the page is kept honest by the core:
 * statistical model watermarks are neither detected nor claimed to be.
 */

import type { WorkerRequest, WorkerResponse } from './worker.js';
// Imported from the individual modules rather than the barrel: pulling in
// core/index.js would drag pdf-lib and fflate into the main bundle, when the
// only code that needs them now runs in the worker.
import { scanText, cleanText } from '../core/text.js';
import { exposure, type Exposure } from '../core/exposure.js';
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

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  confirmed: 'confirmé',
  probable: 'probable',
  informational: 'informatif',
};

const KIND_LABEL: Record<Finding['kind'], string> = {
  identity: 'identité',
  provenance: 'provenance',
  timestamp: 'horodatage',
  environment: 'environnement',
  'invisible-character': 'invisible',
};

/**
 * The core reports field names in English so the library reads consistently;
 * this interface is French. Unicode character names are deliberately absent —
 * "ZERO WIDTH SPACE" is the standard's own identifier and stays untranslated.
 */
const FIELD_LABEL: Record<string, string> = {
  Author: 'Auteur',
  'Last modified by': 'Dernière modification par',
  Title: 'Titre',
  Subject: 'Objet',
  Description: 'Description',
  Keywords: 'Mots-clés',
  Category: 'Catégorie',
  'Content status': 'Statut du contenu',
  'Revision number': 'Numéro de révision',
  Created: 'Créé le',
  Modified: 'Modifié le',
  'Creating application': 'Application de création',
  'Producing application': 'Application productrice',
  'Application version': 'Version de l’application',
  Company: 'Société',
  Manager: 'Responsable',
  Template: 'Modèle',
  'Total editing time': 'Temps d’édition total',
  'Custom properties': 'Propriétés personnalisées',
  'Embedded thumbnail': 'Miniature intégrée',
  'Revision save IDs': 'Identifiants de révision',
  'Comment and revision authors': 'Auteurs des commentaires et révisions',
  'C2PA provenance manifest': 'Manifeste de provenance C2PA',
  'C2PA content credentials': 'Content Credentials C2PA',
  'Embedded file attachments': 'Pièces jointes intégrées',
  'XMP creator tool': 'Outil de création XMP',
  'XMP producer': 'Producteur XMP',
  'XMP author': 'Auteur XMP',
  'XMP title': 'Titre XMP',
  'XMP created': 'Création XMP',
  'XMP modified': 'Modification XMP',
  'XMP document ID': 'Identifiant de document XMP',
  'XMP instance ID': 'Identifiant d’instance XMP',
  'Last printed': 'Dernière impression',
  'Link to a local or network path': 'Lien vers un chemin local ou réseau',
  'Hidden slides': 'Diapositives masquées',
  'Speaker notes': 'Notes du présentateur',
  'Exif with GPS coordinates': 'Exif avec coordonnées GPS',
  'Exif camera data': 'Données Exif de l’appareil',
  'XMP metadata': 'Métadonnées XMP',
  'APP1 metadata': 'Métadonnées APP1',
  'IPTC/Photoshop metadata': 'Métadonnées IPTC/Photoshop',
  'Embedded comment': 'Commentaire intégré',
  'Application metadata': 'Métadonnées applicatives',
  'Document identifier (/ID)': 'Identifiant de document (/ID)',
  'Windows account': 'Compte Windows',
  'macOS account': 'Compte macOS',
  'Linux account': 'Compte Linux',
  'WSL mount': 'Montage WSL',
  'Windows temporary directory': 'Répertoire temporaire Windows',
  'macOS temporary directory': 'Répertoire temporaire macOS',
  'Temporary directory': 'Répertoire temporaire',
  'Session identifier': 'Identifiant de session',
  'Run or workspace identifier (UUID)': 'Identifiant d’exécution ou d’espace de travail (UUID)',
  'Assistant or agent named in metadata': 'Assistant ou agent nommé dans les métadonnées',
  'Document generated programmatically': 'Document généré par programme',
  'Text reordering controls': 'Contrôles de réordonnancement du texte',
  'SVG metadata block': 'Bloc de métadonnées SVG',
  'Editor namespace': 'Espace de noms de l’éditeur',
  'Generator comment': 'Commentaire de génération',
  'SVG title (accessibility)': 'Titre SVG (accessibilité)',
  'SVG description (accessibility)': 'Description SVG (accessibilité)',
  'Generator meta tag': 'Balise meta generator',
  'Author meta tag': 'Balise meta author',
  'Creator meta tag': 'Balise meta creator',
  'Copyright meta tag': 'Balise meta copyright',
  'Date meta tag': 'Balise meta date',
  'JSON-LD structured data': 'Données structurées JSON-LD',
  'Initial author': 'Auteur initial',
  'Printed by': 'Imprimé par',
  'Edit cycles': 'Cycles d’édition',
  'User-defined properties': 'Propriétés définies par l’utilisateur',
  Generator: 'Générateur',
  'Generated by': 'Généré par',
  'Created with': 'Créé avec',
  'AI-generated flag': 'Indicateur « généré par IA »',
  'AI flag': 'Indicateur IA',
  Model: 'Modèle',
  Tool: 'Outil',
  Session: 'Session',
  'Source path': 'Chemin source',
  Date: 'Date',
  Authors: 'Auteurs',
  'Model identifier': 'Identifiant de modèle',
  'Coding agent named in metadata': 'Agent de codage nommé dans les métadonnées',
  'LLM framework or runtime': 'Framework ou runtime LLM',
  'LLM provider endpoint': 'Point de terminaison de fournisseur LLM',
  'Anthropic message id': 'Identifiant de message Anthropic',
  'OpenAI completion id': 'Identifiant de complétion OpenAI',
  'OpenAI assistant object id': 'Identifiant d’objet Assistant OpenAI',
  'API request id': 'Identifiant de requête API',
  'Conversation id': 'Identifiant de conversation',
  'Absolute paths preserved in the archive': 'Chemins absolus conservés dans l’archive',
  'Hidden payload in document text': 'Charge cachée dans le texte du document',
  'Hidden payload in page text': 'Charge cachée dans le texte des pages',
  'Tool credited by the C2PA manifest': 'Outil crédité par le manifeste C2PA',
  'What the C2PA manifest asserts': 'Ce que le manifeste C2PA affirme',
};

/** Descriptive values the core writes in prose rather than reporting verbatim data. */
const VALUE_TEXT: Record<string, string> = {
  'rendered preview of document content': 'aperçu visuel du contenu du document',
  'signed content credentials': 'manifeste de provenance signé',
  'signed provenance manifest': 'manifeste de provenance signé',
  'present — may carry provenance manifests or source data':
    'présentes — peuvent contenir des manifestes de provenance ou des données sources',
  present: 'présentes',
  'file was assembled in a scratch directory':
    'le fichier a été assemblé dans un répertoire de travail temporaire',
};

const NOTE_TEXT: Record<Note['code'], (detail?: string) => string> = {
  'scope:pdf-metadata-only': () =>
    "Métadonnées, plus un scan des flux décompressés (secrets, identifiants de fournisseur, caractères invisibles). Les opérandes de chaîne PDF contiennent des codes de glyphes et non de l'Unicode : une détection dans le texte des pages est fiable, mais une absence ne prouve rien — contrairement à un DOCX, où le contrôle du corps est exact. Un filigrane statistique n'apparaîtrait dans aucun des deux cas.",
  'scope:ooxml-metadata-only': () =>
    "Propriétés du document, plus un scan des parties à la recherche de secrets et d'identifiants de fournisseur. Si le corps contient du texte issu d'un modèle filigranant, ce signal réside dans la formulation et n'est pas affecté par le nettoyage.",
  'scope:invisible-characters-only': () =>
    "Caractères invisibles uniquement. Un filigrane statistique éventuellement présent dans ce texte n'est pas affecté et reste indétectable localement.",
  'scope:markup-metadata-only': () =>
    "Métadonnées du balisage uniquement. Le texte du corps n'est pas analysé : un filigrane statistique qui s'y trouverait n'apparaîtrait pas ici.",
  'scope:image-metadata-only': () =>
    "Métadonnées du conteneur uniquement. Les pixels ne sont pas analysés : un filigrane invisible encodé dans l'image elle-même n'apparaîtrait pas ici et n'est pas retiré.",
  'removed:c2pa': (detail) =>
    `Manifeste C2PA retiré${detail ? ` (${detail})` : ''}. Le fichier ne porte plus de provenance vérifiable — un tiers ne peut plus confirmer son origine, dans un sens comme dans l'autre. À noter : le C2PA prévoit aussi le « soft binding », où une marque dans le contenu lui-même permet à l'éditeur de rattacher le manifeste à distance. Un manifeste retiré ne signifie donc pas qu'il ne reste aucune provenance.`,
  'scope:archive': () =>
    "Rapport d'archive. Chaque membre est passé par la détection normale ; ceux qu'aucun analyseur ne revendique ont été scannés uniquement à la recherche de secrets et d'identifiants de fournisseur.",
  'limit:archive-truncated': (detail) =>
    `Le parcours de l'archive s'est arrêté à une limite interne (${detail ?? 'plafond de membres'}). Certains membres n'ont pas été examinés.`,
  'kept:in-content': (detail) =>
    `Non retiré : ${detail ?? 'traces dans le contenu'}. Ces éléments sont dans le contenu même du document, pas dans un champ de métadonnées, et réécrire le texte des pages changerait ce que dit le document. Corrigez la source et régénérez — et si un secret figure dans la liste, révoquez-le.`,
  'kept:content': (detail) =>
    `Laissé en place : ${detail ?? 'contenu du document'}. Il s'agit de contenu et non de métadonnées — le retirer changerait ce que lit le destinataire, à vous de trancher.`,
};

/**
 * State what a silent report is worth at this length.
 *
 * Deliberately not a verdict: reading a keyed watermark requires the vendor's
 * key. What can be reported is how much power a detector holding that key would
 * have on a passage this size, so that "nothing found" is not read as "clean".
 */
const EXPOSURE_TEXT: Record<Exposure['band'], string> = {
  'too-short':
    "À cette longueur, même l'éditeur du modèle peut ne pas obtenir de résultat fiable. Ne rien trouver ici ne signifierait presque rien.",
  uncertain:
    "Assez long pour qu'un détecteur détenant la clé ait une certaine puissance, assez court pour que l'issue dépende du schéma et du seuil retenu.",
  ample:
    'Assez long pour que la littérature (Kirchenbauer et al., ICLR 2024) ait observé un signal survivant à une reformulation humaine soutenue, à 1e-5 de faux positifs.',
};

function exposureCard(text: string): HTMLElement {
  const report = exposure(text);
  const node = card('Filigrane statistique', undefined, 'aucun verdict local possible');

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
    'longueur',
    `~${report.low}–${report.high} tokens (${report.characters} caractères, ${report.words} mots)`,
  );
  row('portée', EXPOSURE_TEXT[report.band]);

  table.append(body);
  scroll.append(table);
  node.append(scroll);
  node.append(
    el(
      'p',
      'note',
      "Cirta ne sait pas lire cette classe de marquage, et aucun outil local ne le peut : il faut la clé secrète de l'éditeur. Le nombre de tokens est estimé, pas tokenisé.",
    ),
  );
  return node;
}

/** Some labels carry the field name, so the prefix is translated rather than the whole. */
const LABEL_PREFIX: Array<[RegExp, string]> = [
  [/^Custom property: /, 'Propriété personnalisée : '],
  [/^User-defined property: /, 'Propriété utilisateur : '],
  [/^Custom info key: /, 'Clé /Info personnalisée : '],
  [/^Credential left in file: /, 'Secret laissé dans le fichier : '],
];

function translateLabel(label: string): string {
  const mapped = FIELD_LABEL[label];
  if (mapped) return mapped;
  for (const [pattern, prefix] of LABEL_PREFIX) {
    if (pattern.test(label)) return label.replace(pattern, prefix);
  }
  return label;
}

/** The core marks derived findings with an English prefix naming their source. */
const translateLocation = (location: string) =>
  location.replace(/^derived from /, 'dérivé de ');

/** Values the core builds by interpolating a count, matched by shape. */
const VALUE_PATTERNS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [
    /^(\d+) values? \(correlate documents edited in the same session\)$/,
    (m) => `${m[1]} valeur(s) — corrèlent les documents édités dans la même session`,
  ],
  [
    /^(\d+) hidden slides? still present in the file$/,
    (m) => `${m[1]} diapositive(s) masquée(s), toujours présentes dans le fichier`,
  ],
  [/^(\d+) slides? with presenter notes$/, (m) => `${m[1]} diapositive(s) avec des notes`],
  [/^(\d+) bytes$/, (m) => `${m[1]} octets`],
  [/^(.+) — from "(.+)"$/, (m) => `${m[1]} — d'après « ${m[2]} »`],
  [
    /^(.+) — asserted by the manifest, signature not verified$/,
    (m) => `${m[1]} — déclaré par le manifeste, signature non vérifiée`,
  ],
  [/^(.+) \(drive ([A-Za-z]):\)$/, (m) => `${m[1]} (lecteur ${m[2]} :)`],
];

function translateValue(finding: Finding): string {
  // Occurrence counts read identically in both languages.
  const mapped = VALUE_TEXT[finding.value];
  if (mapped) return mapped;
  for (const [pattern, render] of VALUE_PATTERNS) {
    const match = pattern.exec(finding.value);
    if (match) return render(match);
  }
  return finding.value;
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
  if (ext === '.md' || ext === '.markdown') return 'markdown';
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

function setupTabs(): void {
  const tabs = [
    { button: must<HTMLButtonElement>('#tab-files'), panel: must<HTMLElement>('#panel-files') },
    { button: must<HTMLButtonElement>('#tab-text'), panel: must<HTMLElement>('#panel-text') },
  ];
  for (const { button } of tabs) {
    button.addEventListener('click', () => {
      for (const tab of tabs) {
        const selected = tab.button === button;
        tab.button.setAttribute('aria-selected', String(selected));
        tab.panel.hidden = !selected;
      }
    });
  }
}

/* ------------------------------------------------------------- rendering -- */

function findingsTable(findings: Finding[]): HTMLElement {
  const scroll = el('div', 'table-scroll');
  const table = el('table');

  const head = el('thead');
  const headRow = el('tr');
  for (const label of ['Niveau', 'Type', 'Champ', 'Valeur', 'Emplacement']) {
    headRow.append(el('th', undefined, label));
  }
  head.append(headRow);

  const body = el('tbody');
  for (const finding of findings) {
    const row = el('tr');
    if (finding.affectsVerifiability) row.className = 'flagged';
    row.append(
      el('td', `confidence confidence-${finding.confidence}`, CONFIDENCE_LABEL[finding.confidence]),
    );
    row.append(el('td', 'kind', KIND_LABEL[finding.kind]));
    row.append(el('td', undefined, translateLabel(finding.label)));
    row.append(el('td', 'value', preview(translateValue(finding), 120)));
    row.append(el('td', 'location', translateLocation(finding.location)));
    body.append(row);
  }

  table.append(head, body);
  scroll.append(table);
  return scroll;
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
    node.append(el('p', warn ? 'note note-warn' : 'note', NOTE_TEXT[note.code](note.detail)));
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

async function handleFile(file: File, container: HTMLElement): Promise<void> {
  const node = card(file.name, undefined, 'analyse…');
  node.classList.add('is-busy');
  container.prepend(node);

  let data: Uint8Array;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    node.append(el('p', 'error', 'Lecture du fichier impossible.'));
    return;
  }

  try {
    const result = await inspectFile(data, formatHint(file.name));
    node.classList.remove('is-busy');
    const count = node.querySelector('.count');
    const badge = el('span', 'badge', result.format);
    node.querySelector('.card-head')?.insertBefore(badge, count);
    if (count) {
      count.textContent = result.findings.length
        ? `${result.findings.length} élément${result.findings.length > 1 ? 's' : ''}`
        : 'aucune métadonnée';
    }

    if (result.findings.length === 0) {
      node.append(el('p', 'empty', 'Aucune métadonnée identifiante trouvée.'));
    } else {
      node.append(findingsTable(result.findings));

      const foot = el('div', 'card-foot');
      const button = el('button', 'button button-primary', 'Télécharger la version nettoyée');
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Nettoyage…';
        try {
          const redacted = await redactFile(data, formatHint(file.name));
          download(redacted.data!, cleanName(file.name), MIME[redacted.format]);
          button.textContent = 'Téléchargé';
          // Redaction can surface caveats that inspection could not, notably
          // that a C2PA manifest was dropped.
          const fresh = redacted.notes.filter((n) => n.code === 'removed:c2pa');
          if (fresh.length) appendNotes(node, fresh);
        } catch (error) {
          button.textContent = 'Échec du nettoyage';
          node.append(
            el('p', 'error', error instanceof Error ? error.message : String(error)),
          );
        }
      });
      foot.append(button);
      node.append(foot);
    }

    appendNotes(node, result.notes);
  } catch (error) {
    node.classList.remove('is-busy');
    node.querySelector('.count')?.remove();
    node.append(el('p', 'error', error instanceof Error ? error.message : String(error)));
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
    const scan = scanText(input.value);
    const node = card(
      'Analyse',
      undefined,
      scan.findings.length ? `${scan.findings.length} type${scan.findings.length > 1 ? 's' : ''}` : 'rien trouvé',
    );
    if (scan.findings.length === 0) {
      node.append(el('p', 'empty', 'Aucun caractère invisible trouvé.'));
    } else {
      node.append(findingsTable(scan.findings));
    }
    for (const payload of scan.decoded) {
      node.append(el('p', 'decoded', `Charge décodée — ${payload}`));
    }
    appendNotes(node, scopeNote);
    results.replaceChildren(node, exposureCard(input.value));
  });

  cleanButton.addEventListener('click', async () => {
    const result = cleanText(input.value);
    input.value = result.text;

    const node = card(
      'Nettoyage',
      undefined,
      result.removed.length
        ? `${result.removed.length} type${result.removed.length > 1 ? 's' : ''} retiré${result.removed.length > 1 ? 's' : ''}`
        : 'rien à retirer',
    );
    if (result.removed.length === 0) {
      node.append(el('p', 'empty', 'Le texte ne contenait aucun caractère invisible.'));
    } else {
      node.append(findingsTable(result.removed));
    }
    for (const payload of result.decoded) {
      node.append(el('p', 'decoded', `Charge retirée — ${payload}`));
    }

    const foot = el('div', 'card-foot');
    const copy = el('button', 'button', 'Copier le texte nettoyé');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(result.text);
        copy.textContent = 'Copié';
      } catch {
        input.select();
        copy.textContent = 'Sélectionné — Ctrl+C';
      }
    });
    foot.append(copy);
    node.append(foot);

    appendNotes(node, scopeNote);
    render(node);
  });
}

setupTabs();
setupFiles();
setupText();
