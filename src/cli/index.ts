#!/usr/bin/env node
/**
 * Cirta command line interface.
 *
 * Everything runs locally; the process makes no network requests.
 */

import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { banner } from './logo.js';
import { lang, setLang, detectLang, t } from './i18n.js';
import { translateLabel, errorText, translateValue, translateLocation, noteText } from '../shared/french.js';
import { safeWrite, backup } from './write.js';
import {
  inspectFile,
  redactFile,
  inspectPlainText,
  cleanPlainText,
  toSarif,
  meetsThreshold,
  type SarifInput,
  UnsupportedFormatError,
  decodeTextInput,
  BinaryInputError,
  exposure,
  type Exposure,
  type Confidence,
  type Finding,
  type InspectResult,
  type Note,
  preview,
  provenance,
  stylometry,
  type Stylometry,
} from '../core/index.js';
import { nodeXrayEngine } from './xray-engine.js';
import { terminalJson, terminalSafe } from './terminal.js';
import { TRACKED_LABELS } from '../core/tracked-changes.js';
import { AIMED_LABEL, removableFinding } from '../core/hidden-text.js';
import { sanitizeForLlm, type SanitizedText } from '../core/sanitize.js';
import { parseRules, type Rule } from '../core/rules.js';
import { runMcp } from './mcp.js';
import { formatHint } from './hint.js';
import { version } from './version.js';
import { isProfile, PROFILES } from '../shared/profiles.js';
import { REPORT_SCHEMA } from '../core/report-schema.js';
import { nodeImageCodec } from './image-codec.js';
import { manifest, manifestEntry } from '../core/manifest.js';
import { isSupportedFile, isWalkedDirectory, SKIP_DIRECTORIES } from '../shared/files.js';
import { reportHtml, reportMarkdown } from '../shared/report-export.js';
import { changedFiles, ChangedFilesError } from './changed.js';
import { serve } from './serve.js';
import { watchFolder } from './watch.js';
import { writeFile } from 'node:fs/promises';

/**
 * Terminal capabilities differ enough between platforms that both colour and
 * non-ASCII output have to be opt-out. Windows Terminal and PowerShell 7 handle
 * both; the legacy conhost on a non-UTF-8 code page renders an arrow as
 * mojibake, so arrows and dashes degrade to ASCII rather than produce garbage.
 */
const useColor =
  process.env['FORCE_COLOR'] !== undefined
    ? process.env['FORCE_COLOR'] !== '0'
    : Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];

const useUnicode =
  process.platform !== 'win32' ||
  process.env['WT_SESSION'] !== undefined ||
  /UTF-?8/i.test(process.env['LANG'] ?? process.env['LC_ALL'] ?? '');

const SYMBOL = {
  arrow: useUnicode ? '\u2192' : '->',
};

const paint = (code: string, text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (t: string) => paint('1', t);
const dim = (t: string) => paint('2', t);
const yellow = (t: string) => paint('33', t);
const red = (t: string) => paint('31', t);
const green = (t: string) => paint('32', t);
// 173 is the 256-colour cell nearest the #9a4b1f of assets/logo.svg.
const accent = (t: string) => paint('38;5;173', t);

const help = () =>
  `
${banner({
  unicode: useUnicode,
  paint: accent,
  lines: [bold('cirta'), t().tagline, '', dim(t().taglineLocal)],
})}

${bold(t().usage)}
  cirta inspect <path...>            ${t().usageInspect}
  cirta redact  <path...> [options]  ${t().usageRedact}
  cirta text [--clean]               ${t().usageText}
  cirta verify  <path...> [--fail-on <level>]  ${t().usageVerify}
  cirta sanitize-for-llm <path...> [--json] [--fail-on-instructions]  ${t().usageSanitize}
  cirta mcp                          ${t().usageMcp}
  cirta serve [--http <port>] [--icap <port>] [--block-on <level>]  ${t().usageServe}
  cirta watch <folder> [--clean -o <folder>] [--json]  ${t().usageWatch}

${t().paths}

${bold(t().options)}
  -o, --output <path>   ${t().optOutput}
      --in-place        ${t().optInPlace}
      --skip <names>    ${t().optSkip}
      --force-text      ${t().optForceText}
      --remove-hidden   ${t().optRemoveHidden}
      --accept-changes  ${t().optAcceptChanges}
      --remove-comments ${t().optRemoveComments}
      --normalize-spaces ${t().optNormalizeSpaces}
      --pii             ${t().optPii}
      --rules <file>    ${t().optRules}
      --strip-active    ${t().optStripActive}
      --strip-remote-resources ${t().optStripRemote}
      --remove-notes    ${t().optRemoveNotes}
      --remove-hidden-slides ${t().optRemoveHiddenSlides}
      --remove-hidden-sheets ${t().optRemoveHiddenSheets}
      --remove-attachments ${t().optRemoveAttachments}
      --flatten-annotations ${t().optFlattenAnnotations}
      --strip-tracking-params ${t().optStripTracking}
      --burn-redactions ${t().optBurnRedactions}
      --clear-outputs   ${t().optClearOutputs}
      --manifest <file> ${t().optManifest}
      --report <file>   ${t().optReport}
      --changed-only    ${t().optChangedOnly}
      --base <ref>      ${t().optBase}
      --profile <name>  ${t().optProfile}
      --reencode-images ${t().optReencodeImages}
      --lang <fr|en>    ${t().optLang}
      --json            ${t().optJson}
      --sarif           ${t().optSarif}
      --fail-on <level> ${t().optFailOn}
      --host <address>  ${t().optHost}
      --http <port|off> ${t().optHttpPort}
      --icap <port|off> ${t().optIcapPort}
      --block-on <level> ${t().optBlockOn}
      --allow-clean     ${t().optAllowClean}
      --max-size <MB>   ${t().optMaxSize}
      --interval <s>    ${t().optInterval}
      --new-only        ${t().optNewOnly}
  -h, --help            ${t().optHelp}
  -V, --version         ${t().optVersion}

${bold(t().confidenceTitle)}
  confirmed      ${t().confConfirmed}
  probable       ${t().confProbable}
  informational  ${t().confInformational}

${bold(t().scopeTitle)}
  ${t().scopeBody}
`.replace(/^\n+|\n+$/g, '');

/*
 * [C2] What came out of a file is made safe before it reaches the terminal —
 * findings, notes, paths — and nowhere else: our own colours are escape codes
 * too, so the line as a whole cannot be cleaned once they are in it.
 */
const safeFinding = (finding: Finding): Finding => ({
  ...finding,
  label: terminalSafe(finding.label),
  value: terminalSafe(finding.value),
  location: terminalSafe(finding.location),
});
const safeFindings = (findings: Finding[]): Finding[] => findings.map(safeFinding);
const safeNotes = (notes: Note[]): Note[] =>
  notes.map((note) => (note.detail === undefined ? note : { ...note, detail: terminalSafe(note.detail) }));

interface Args {
  command: string | undefined;
  files: string[];
  output?: string;
  inPlace: boolean;
  json: boolean;
  clean: boolean;
  help: boolean;
  /** [F-P2 2.8] Print the version and stop. */
  version: boolean;
  forceText: boolean;
  removeHidden: boolean;
  acceptChanges: boolean;
  removeComments: boolean;
  normalizeSpaces: boolean;
  stripActive: boolean;
  stripRemote: boolean;
  removeNotes: boolean;
  clearOutputs: boolean;
  manifest?: string;
  /** [F-P2 2.7] The report as a page or a Markdown file. */
  report?: string;
  /** [F-P2 2.6] Staged files, or those changed since `base`. */
  changedOnly: boolean;
  base?: string;
  profile?: string;
  reencodeImages: boolean;
  removeHiddenSlides: boolean;
  removeHiddenSheets: boolean;
  removeAttachments: boolean;
  flattenAnnotations: boolean;
  stripTracking: boolean;
  burnRedactions: boolean;
  failOnInstructions: boolean;
  pii: boolean;
  rulesFile?: string;
  rules?: Rule[];
  skip: string[];
  lang?: string;
  sarif: boolean;
  failOn?: string;
  /** [F-P3 2.5] cirta serve. */
  host: string;
  httpPort?: string;
  icapPort?: string;
  blockOn?: string;
  allowClean: boolean;
  maxSize?: string;
  /** [F-P3 2.6] cirta watch. */
  interval?: string;
  newOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: undefined,
    files: [],
    inPlace: false,
    json: false,
    clean: false,
    help: false,
    version: false,
    changedOnly: false,
    forceText: false,
    removeHidden: false,
    acceptChanges: false,
    removeComments: false,
    normalizeSpaces: false,
    stripActive: false,
    stripRemote: false,
    removeNotes: false,
    clearOutputs: false,
    reencodeImages: false,
    removeHiddenSlides: false,
    removeHiddenSheets: false,
    removeAttachments: false,
    flattenAnnotations: false,
    stripTracking: false,
    burnRedactions: false,
    failOnInstructions: false,
    pii: false,
    skip: [],
    sarif: false,
    host: '127.0.0.1',
    allowClean: false,
    newOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '-V':
      case '--version':
        args.version = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--in-place':
        args.inPlace = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--clean':
        args.clean = true;
        break;
      case '--remove-hidden':
        args.removeHidden = true;
        break;
      case '--accept-changes':
        args.acceptChanges = true;
        break;
      case '--remove-comments':
        args.removeComments = true;
        break;
      case '--normalize-spaces':
        args.normalizeSpaces = true;
        break;
      case '--strip-active':
        args.stripActive = true;
        break;
      case '--strip-remote-resources':
        args.stripRemote = true;
        break;
      case '--reencode-images':
        args.reencodeImages = true;
        break;
      case '--profile':
        args.profile = argv[++i];
        break;
      case '--manifest':
        args.manifest = argv[++i];
        break;
      case '--report':
        args.report = argv[++i];
        break;
      case '--changed-only':
        args.changedOnly = true;
        break;
      case '--base':
        args.base = argv[++i];
        break;
      case '--clear-outputs':
        args.clearOutputs = true;
        break;
      case '--remove-notes':
        args.removeNotes = true;
        break;
      case '--remove-hidden-slides':
        args.removeHiddenSlides = true;
        break;
      case '--remove-hidden-sheets':
        args.removeHiddenSheets = true;
        break;
      case '--remove-attachments':
        args.removeAttachments = true;
        break;
      case '--flatten-annotations':
        args.flattenAnnotations = true;
        break;
      case '--strip-tracking-params':
        args.stripTracking = true;
        break;
      case '--burn-redactions':
        args.burnRedactions = true;
        break;
      case '--fail-on-instructions':
        args.failOnInstructions = true;
        break;
      case '--pii':
        args.pii = true;
        break;
      case '--rules':
        args.rulesFile = argv[++i];
        break;
      case '--force-text':
        args.forceText = true;
        break;
      case '--lang':
        args.lang = argv[++i];
        break;
      case '--sarif':
        args.sarif = true;
        break;
      case '--fail-on':
        args.failOn = argv[++i];
        break;
      case '--host':
        args.host = argv[++i] ?? args.host;
        break;
      case '--http':
        args.httpPort = argv[++i];
        break;
      case '--icap':
        args.icapPort = argv[++i];
        break;
      case '--block-on':
        args.blockOn = argv[++i];
        break;
      case '--allow-clean':
        args.allowClean = true;
        break;
      case '--max-size':
        args.maxSize = argv[++i];
        break;
      case '--interval':
        args.interval = argv[++i];
        break;
      case '--new-only':
        args.newOnly = true;
        break;
      case '--skip':
        args.skip.push(...(argv[++i] ?? '').split(',').map((name) => name.trim()).filter(Boolean));
        break;
      case '-o':
      case '--output':
        args.output = argv[++i];
        break;
      default:
        if (arg.startsWith('-')) throw new Error(t().unknownOption(arg));
        if (!args.command) args.command = arg;
        else args.files.push(arg);
    }
  }
  return args;
}

/** Confirmed findings are the ones worth acting on, so they are the ones that stand out. */
const CONFIDENCE_STYLE: Record<Confidence, (text: string) => string> = {
  confirmed: red,
  probable: yellow,
  informational: dim,
};

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(`  ${green(t().noMetadata)}`);
    return;
  }
  const width = Math.max(...findings.map((f) => translateLabel(f.label, lang()).length));
  /*
   * The kind column was a hardcoded 11, which `environnement` already overran
   * by two and `lien trompeur` by two more — every row carrying one pushed the
   * rest of its line out of the table. Measuring it also gives the indent for
   * the location line below, which was the same width written out again as 26.
   */
  const kindWidth = Math.max(...findings.map((f) => t().kinds[f.kind].length));
  const indent = 13 + 1 + kindWidth + 1;
  for (const finding of findings) {
    const flag = finding.affectsVerifiability ? yellow(' [verifiable provenance]') : '';
    const mark = CONFIDENCE_STYLE[finding.confidence](t().confidence[finding.confidence].padEnd(13));
    console.log(
      `  ${mark} ${dim(t().kinds[finding.kind].padEnd(kindWidth))} ${translateLabel(
        finding.label,
        lang(),
      ).padEnd(width)}  ${preview(translateValue(finding, lang()))}${flag}`,
    );
    console.log(`  ${dim(' '.repeat(indent) + translateLocation(finding.location, lang()))}`);
  }
}

/** Walk a tree, pruning the directories rather than filtering their files out. */
async function walkDirectory(root: string, skip: Set<string>): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      // Pruning rather than filtering: descending into node_modules to throw
      // the results away still costs the descent.
      if (!isWalkedDirectory(entry.name, skip)) continue;
      found.push(...(await walkDirectory(path, skip)));
    } else if (entry.isFile() && isSupportedFile(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Expand directory arguments into the supported files they contain, so that
 * `cirta inspect ./contrats` audits a whole folder before it is sent out.
 * Explicit file arguments are kept regardless of extension: naming a file is a
 * deliberate act, and format detection reads magic bytes rather than the name.
 */
async function expandPaths(paths: string[], skip: string[] = []): Promise<string[]> {
  const skipSet = new Set([...SKIP_DIRECTORIES, ...skip]);
  const out: string[] = [];
  for (const path of paths) {
    let isDirectory = false;
    try {
      isDirectory = (await stat(path)).isDirectory();
    } catch {
      out.push(path); // Let the per-file handler report the failure.
      continue;
    }
    if (!isDirectory) {
      out.push(path);
      continue;
    }
    const found = (await walkDirectory(path, skipSet)).sort();
    if (found.length === 0) console.error(dim(t().noSupported(terminalSafe(path))));
    out.push(...found);
  }
  return out;
}

/**
 * State what a silent report is worth at this length.
 *
 * No verdict is given because none is possible: reading a keyed watermark needs
 * the vendor's key. What can be said is how much statistical power a detector
 * that *did* hold the key would have on a passage this size.
 */
/**
 * Wrap a long sentence under a label, so the prose lives in one string in the
 * translation table instead of being hand-broken across console.log calls. It
 * was hand-broken, and every edit to the wording meant re-breaking four lines.
 */
function field(label: string, body: string, width = 78): void {
  const indent = ' '.repeat(11);
  // French sets a space before ? ! : ; and inside guillemets. Those are spaces
  // to a naive wrapper, which happily ends a line on the space and drops the
  // punctuation onto the next one. Tying them makes the wrap respect the
  // typography instead of mangling it.
  const words = body
    .replace(/ ([?!:;»])/g, '\u00a0$1')
    .replace(/« /g, '«\u00a0')
    .split(' ')
    .map((word) => word.replace(/\u00a0/g, ' '));
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  console.log(`  ${dim(label.padEnd(11))} ${lines[0] ?? ''}`);
  for (const rest of lines.slice(1)) console.log(`  ${indent} ${dim(rest)}`);
}

function printExposure(report: Exposure): void {
  console.log(`\n  ${bold(t().exposureTitle)}  ${dim(t().exposureBadge)}`);
  field(
    t().exposureRowLength,
    t().exposureLength(report.low, report.high, report.characters, report.words),
  );
  field(t().exposureRowMeaning, t().exposureBands[report.band]);

  // Length is not the only thing that governs detectability. The mark rides on
  // choices between equally good words, and code mostly has one right answer.
  if (report.freeChoice.code) {
    const { commentLines, nonBlankLines } = report.freeChoice;
    const share = Math.round((commentLines / nonBlankLines) * 100);
    field(t().exposureRowRoom, t().exposureRoom(nonBlankLines, commentLines, share));
  }
  // Since August 2026 this is a live question rather than a theoretical one.
  field(t().exposureRowStatus, t().exposureStatus);
  // The point most likely to be conflated with this tool's own subject.
  field(t().exposureRowNotThis, t().exposureNotThis);
  field(t().exposureRowCareful, t().exposureCareful);
  console.log(`  ${dim('note:')} ${dim(t().exposureNote)}`);
}

/**
 * Answer "was this made by an AI, and which?" in one line.
 *
 * The rows below already carry it, spread over as many as five of them. What
 * they cannot do is answer when there is nothing: a report that stays silent
 * reads as "no AI", and the truthful answer is narrower than that.
 */
function printProvenance(findings: Finding[]): void {
  const { tools, attributed, declared, machineAssembled, assistantVoice } = provenance(findings);
  const head = (value: string) => console.log(`  ${bold(t().producedBy)}  ${value}`);
  const under = (value: string) => console.log(`  ${dim(' '.repeat(14))}${dim(value)}`);

  if (declared) {
    // A declaration outranks an inference: the file states this about itself
    // in the IPTC vocabulary, which is what the transparency rules are built on.
    head(red(t().provDeclared));
    if (tools.length) console.log(`  ${dim('              ')}${tools.join(' \u00b7 ')}`);
    return;
  }
  if (attributed) {
    head(yellow(tools.join(' \u00b7 ')));
    under(t().provAttributedCaveat);
    return;
  }
  if (tools.length) {
    head(`${tools.join(' \u00b7 ')} ${dim(t().provToolCaveat)}`);
    if (machineAssembled) under(t().provShapeAgrees);
    return;
  }
  if (machineAssembled) {
    // No name, but the container's shape is evidence in itself.
    head(yellow(t().provMachine));
    under(t().provMachineCaveat);
    return;
  }
  if (assistantVoice) {
    head(yellow(t().provVoice));
    under(t().provVoiceCaveat);
    return;
  }
  head(dim(t().provNone));
  under(t().provNoneCaveat);
}

/**
 * How much the prose reads like generated prose.
 *
 * Deliberately shaped like the watermark block above it: measurements, and a
 * count of how many are present. No score, because a score would be read as a
 * probability and these signals have never been calibrated to produce one —
 * and because the detectors that do produce one flag 61% of non-native English
 * writers (Liang et al., Stanford 2023).
 */
function printStyle(report: Stylometry): void {
  if (report.band === 'too-short') return;
  console.log(`\n  ${bold(t().styleTitle)}  ${dim(t().styleBadge)}`);

  field(t().styleRowShape, t().styleShape(report.sentences, report.meanSentence.toFixed(1)));
  field(t().styleRowVariation, t().styleVariation(report.burstiness.toFixed(2)));
  field(t().styleRowDashes, t().styleDashes(report.dashRate.toFixed(1)));
  if (report.boldLeadIns > 0) {
    field(t().styleRowLeadIns, t().styleLeadIns(Math.round(report.boldLeadIns * 100)));
  }

  if (report.indicators.length) {
    field(t().styleRowPhrases, t().stylePhrases(report.indicators.length));
    for (const indicator of report.indicators.slice(0, 8)) {
      console.log(`  ${' '.repeat(11)}   ${yellow(indicator.label)} ${dim(`\u00d7${indicator.count}`)}`);
    }
    if (report.indicators.length > 8) {
      console.log(`  ${' '.repeat(11)}   ${dim(t().styleMore(report.indicators.length - 8))}`);
    }
  }

  field(t().styleRowReading, t().styleBands[report.band]);
  console.log(`  ${dim('note:')} ${dim(t().styleNote)}`);
}

/**
 * Notes are codes rather than sentences so each front-end words them for its
 * own audience; both languages now live in the shared renderer.
 */
function printNotes(notes: Note[]): void {
  for (const note of notes) {
    console.log(`  ${dim('note:')} ${dim(noteText(note, lang()))}`);
  }
}

function defaultOutputPath(input: string): string {
  const ext = extname(input);
  return join(dirname(input), `${basename(input, ext)}.clean${ext}`);
}

/**
 * What the process exits with.
 *
 * A failure to read a file is always an error. Beyond that, `--fail-on` turns
 * findings into a gate: a pipeline that should stop when a document carries
 * verbatim identifying data asks for `--fail-on confirmed`, and gets exit 1.
 * Without the flag, findings are reported and the run still succeeds — scanning
 * is not the same as failing, and a tool that exits non-zero for every document
 * with a title would be disabled within a week.
 */
function exitCode(
  args: Args,
  results: SarifInput[],
  failures: number,
): number {
  if (failures > 0) return 1;
  if (!args.failOn) return 0;
  const level = args.failOn.toLowerCase();
  if (level !== 'confirmed' && level !== 'probable' && level !== 'informational') {
    console.error(red(t().unknownLevel(args.failOn)));
    return 2;
  }
  return meetsThreshold(results, level) ? 1 : 0;
}

/**
 * [F-2.5] The text a reader sees, for a model: on stdout, ready for a pipe.
 * What was hidden is said on stderr; --json carries all of it; a file that
 * holds an instruction to a model can stop the pipeline.
 */
async function runSanitize(args: Args): Promise<number> {
  const report: Array<SanitizedText & { file: string; error?: string }> = [];
  let failed = false;
  for (const file of args.files) {
    try {
      const result = await sanitizeForLlm(new Uint8Array(await readFile(file)), formatHint(file, args.forceText), { xray: await nodeXrayEngine() });
      report.push({ file, ...result });
      if (!args.json) {
        if (args.files.length > 1) process.stdout.write(`==> ${file} <==\n`);
        process.stdout.write(process.stdout.isTTY ? result.text.split('\n').map(terminalSafe).join('\n') : result.text);
        process.stdout.write('\n');
        if (result.hiddenRemoved) console.error(dim(t().sanitizeHidden(result.hiddenRemoved)));
        if (result.invisibleRemoved) console.error(dim(t().removedTypes(result.invisibleRemoved).trim()));
        for (const instruction of result.hiddenInstructions) {
          console.error(red(t().sanitizeInstruction(terminalSafe(translateLocation(instruction.location, lang())), terminalSafe(instruction.text))));
        }
      }
    } catch (error) {
      failed = true;
      const message = errorText(error, lang());
      report.push({ file, format: 'text', text: '', hiddenInstructions: [], hiddenRemoved: 0, invisibleRemoved: 0, error: message });
      if (!args.json) console.error(`${bold(terminalSafe(file))}\n  ${red(terminalSafe(message))}`);
    }
  }
  if (args.json) console.log(terminalJson(report));
  if (failed) return 1;
  return args.failOnInstructions && report.some((r) => r.hiddenInstructions.length) ? 1 : 0;
}

const LEVELS = ['informational', 'probable', 'confirmed'] as const;

/**
 * [F-P3 2.5] Cirta as a service (src/cli/serve.ts): ICAP and an HTTP API,
 * inspection only unless --block-on or --allow-clean says otherwise. Stays up
 * until SIGTERM or SIGINT — which a container's PID 1 must handle itself.
 */
async function runServe(args: Args): Promise<number> {
  const port = (value: string | undefined, fallback: number): number | undefined | null => {
    if (value === undefined) return fallback;
    if (value.toLowerCase() === 'off') return undefined;
    const n = Number(value);
    return /^\d+$/.test(value) && n <= 65535 ? n : null;
  };
  const http = port(args.httpPort, 8080);
  const icap = port(args.icapPort, 1344);
  for (const [value, parsed] of [[args.httpPort, http], [args.icapPort, icap]] as const) {
    if (parsed === null) {
      console.error(red(terminalSafe(t().serveBadPort(String(value)))));
      return 2;
    }
  }
  if (http === undefined && icap === undefined) {
    console.error(red(t().serveNothing));
    return 2;
  }
  const blockOn = args.blockOn?.toLowerCase();
  if (blockOn !== undefined && !(LEVELS as readonly string[]).includes(blockOn)) {
    console.error(red(terminalSafe(t().unknownLevel(args.blockOn!))));
    return 2;
  }
  const megabytes = args.maxSize === undefined ? 50 : Number(args.maxSize);
  if (!(megabytes > 0)) {
    console.error(red(terminalSafe(t().serveBadSize(String(args.maxSize)))));
    return 2;
  }
  const service = await serve({
    host: args.host,
    http: http ?? undefined,
    icap: icap ?? undefined,
    blockOn: blockOn as Confidence | undefined,
    allowClean: args.allowClean,
    maxBytes: Math.round(megabytes * 1024 * 1024),
    inspect: { xray: await nodeXrayEngine(), pii: args.pii, rules: args.rules },
    clean: { ...redactOptions(args), xray: await nodeXrayEngine(), imageCodec: args.reencodeImages ? await nodeImageCodec() : undefined },
    lang: lang(),
    version: version(),
    log: (line) => process.stdout.write(`${line}\n`),
  });
  const host = args.host.includes(':') ? `[${args.host}]` : args.host;
  if (service.icap) console.error(t().serveListening('ICAP', `icap://${host}:${service.icap.port}/respmod  icap://${host}:${service.icap.port}/reqmod`));
  if (service.http) console.error(t().serveListening('HTTP', `http://${host}:${service.http.port}/  (/health, /inspect${args.allowClean ? ', /clean' : ''})`));
  console.error(dim(blockOn ? t().serveModeBlock(t().confidenceName[blockOn as Confidence]) : t().serveModeInspect));
  if (args.allowClean) console.error(dim(t().serveModeClean));
  await new Promise<void>((resolve) => {
    process.once('SIGTERM', resolve);
    process.once('SIGINT', resolve);
  });
  await service.close();
  console.error(dim(t().serveStopped));
  return 0;
}

/**
 * [F-2.4] The gate before a file goes out. Inspected again; a file passes
 * when nothing at or above the level is left — confirmed by default, so that
 * an ordinary cleaned file passes and a forgotten author does not. A file that
 * cannot be read fails: a gate that lets through what it could not look at is
 * not one.
 */
async function runVerify(args: Args): Promise<number> {
  const level = (args.failOn ?? 'confirmed').toLowerCase() as (typeof LEVELS)[number];
  if (!LEVELS.includes(level)) {
    console.error(red(t().unknownLevel(args.failOn ?? '')));
    return 2;
  }
  const floor = LEVELS.indexOf(level);
  const report: Array<{ file: string; pass: boolean; level: string; findings: Finding[]; error?: string }> = [];
  for (const file of args.files) {
    try {
      const result = await inspectFile(new Uint8Array(await readFile(file)), formatHint(file, args.forceText), { xray: await nodeXrayEngine(), pii: args.pii, rules: args.rules });
      const left = result.findings.filter((f) => LEVELS.indexOf(f.confidence) >= floor);
      report.push({ file, pass: left.length === 0, level, findings: left });
    } catch (error) {
      report.push({ file, pass: false, level, findings: [], error: errorText(error, lang()) });
    }
  }
  if (args.json) {
    console.log(terminalJson(report));
  } else {
    for (const entry of report) {
      const name = bold(terminalSafe(entry.file));
      if (entry.error) console.log(`${red(t().verifyFail)}  ${name}  ${red(terminalSafe(entry.error))}`);
      else if (entry.pass) console.log(`${green(t().verifyPass)}  ${name}  ${dim(t().verifyNothing(translateConfidence(level)))}`);
      else {
        console.log(`${red(t().verifyFail)}  ${name}  ${t().verifyLeft(entry.findings.length, translateConfidence(level))}`);
        printFindings(safeFindings(entry.findings));
      }
    }
  }
  return report.every((entry) => entry.pass) ? 0 : 1;
}

const translateConfidence = (level: (typeof LEVELS)[number]) => t().confidenceName[level];

async function runInspect(args: Args): Promise<number> {
  const results: Array<{ file: string; result?: InspectResult; error?: string; code?: string }> = [];
  let failures = 0;

  for (const file of args.files) {
    try {
      const result = await inspectFile(
        new Uint8Array(await readFile(file)),
        formatHint(file, args.forceText),
        { xray: await nodeXrayEngine(), pii: args.pii, rules: args.rules },
      );
      results.push({ file, result });
      if (!args.json && !args.sarif) {
        console.log(`\n${bold(terminalSafe(file))} ${dim(`(${result.format})`)}`);
        // Ahead of everything: an order to a model hidden from the reader is the
        // one finding that is an attack rather than a trace.
        const aimed = result.findings.filter((f) => f.label === AIMED_LABEL).length;
        if (aimed) console.log(`  ${red(bold(t().aimedAlert(aimed)))}`);
        const findings = safeFindings(result.findings);
        printProvenance(findings);
        printFindings(findings);
        printNotes(safeNotes(result.notes));
      }
    } catch (error) {
      failures++;
      const message = errorText(error, lang());
      const code = (error as { code?: unknown } | null)?.code;
      if (args.json || args.sarif || args.report) results.push({ file, error: message, ...(typeof code === 'string' ? { code } : {}) });
      else console.error(`\n${bold(terminalSafe(file))}\n  ${red(terminalSafe(message))}`);
    }
  }

  // [F-P2 2.7] Written beside whatever the terminal shows; a pipeline's stdout stays clean.
  if (args.report) {
    const page = /\.html?$/i.test(args.report);
    const written = (page ? reportHtml : reportMarkdown)(results, lang(), { version: version() });
    await writeFile(args.report, written);
    if (!args.json && !args.sarif) console.log(`\n${dim(t().reportWritten(terminalSafe(args.report), results.length))}`);
  }

  // SARIF is what a pipeline reads, so it is emitted alone on stdout with
  // nothing else mixed in — a stray banner makes the file unparseable.
  if (args.sarif) {
    console.log(terminalJson(toSarif(results, version())));
    return exitCode(args, results, failures);
  }
  if (args.json) {
    // [F-P2 2.5] Versioned: each entry names the schema it follows, schema/report.v1.json.
    console.log(terminalJson(results.map((entry) => ({ schema: REPORT_SCHEMA, ...entry }))));
    return exitCode(args, results, failures);
  }

  // A folder audit is only useful if it ends with a verdict rather than pages
  // of tables the reader has to tally themselves.
  if (args.files.length > 1) {
    const flagged = results.filter((r) =>
      r.result?.findings.some((f) => f.confidence === 'confirmed'),
    ).length;
    // [C11.1] The verdict line, in the reader's language like the rest.
    console.log(
      `\n${bold(t().summaryTitle)}  ${t().summaryFiles(args.files.length)}, ` +
        (flagged ? red(t().summaryFlagged(flagged)) : green(t().summaryClean)) +
        (failures ? `, ${red(t().summaryUnreadable(failures))}` : ''),
    );
  }

  return exitCode(args, results, failures);
}

/** The cleaning options the command line sets, for redact and for serve's /clean. */
function redactOptions(args: Args) {
  return {
    removeHidden: args.removeHidden, acceptChanges: args.acceptChanges, removeComments: args.removeComments, stripActive: args.stripActive, stripRemote: args.stripRemote,
    removeNotes: args.removeNotes, removeHiddenSlides: args.removeHiddenSlides, removeHiddenSheets: args.removeHiddenSheets,
    removeAttachments: args.removeAttachments, flattenAnnotations: args.flattenAnnotations, stripTracking: args.stripTracking,
    burnRedactions: args.burnRedactions, clearOutputs: args.clearOutputs, reencodeImages: args.reencodeImages, pii: args.pii, rules: args.rules,
  };
}

async function runRedact(args: Args): Promise<number> {
  if (args.output && args.files.length > 1) {
    console.error(red(t().outputSingle));
    return 2;
  }

  let failures = 0;
  const options = redactOptions(args);
  // [F-P2 2.4] One entry per file cleaned, written once all are done.
  const entries: Awaited<ReturnType<typeof manifestEntry>>[] = [];
  for (const file of args.files) {
    try {
      const input = new Uint8Array(await readFile(file));
      const hint = formatHint(file, args.forceText);
      const xray = await nodeXrayEngine();
      const result = await redactFile(input, hint, { xray, imageCodec: args.reencodeImages ? await nodeImageCodec() : undefined, ...options });
      const destination = args.inPlace ? file : (args.output ?? defaultOutputPath(file));
      // Overwriting the input is the one case where a failed write costs the
      // original, so a copy is taken first and named in the report.
      const saved = args.inPlace ? await backup(file) : undefined;
      await safeWrite(destination, result.data!);
      if (args.manifest) {
        entries.push(
          await manifestEntry({
            file,
            output: destination,
            format: result.format,
            before: input,
            after: result.data!,
            findingsBefore: (await inspectFile(input, hint, { xray, pii: args.pii, rules: args.rules })).findings,
            findingsAfter: (await inspectFile(result.data!, hint, { xray, pii: args.pii, rules: args.rules })).findings,
            notes: result.notes.map((note) => note.code),
          }),
        );
      }

      if (!args.json) {
        console.log(`\n${bold(terminalSafe(file))} ${dim(SYMBOL.arrow)} ${bold(terminalSafe(destination))}`);
        console.log(`  ${green(t().fieldsRemoved(result.removed.length))}`);
        if (saved) console.log(`  ${dim(t().originalKept(terminalSafe(saved)))}`);
        printFindings(safeFindings(result.removed));
        printNotes(safeNotes(result.notes));
        // Hidden text a cleaner could have taken out, had it been asked to.
        const removable = ['docx', 'pptx', 'html', 'markdown'].includes(result.format);
        const hidden = (result.kept ?? []).some(removableFinding);
        if (!args.removeHidden && removable && hidden) console.log(`  ${dim(t().removeHiddenHint)}`);
        // Tracked changes left in, with the option that takes them out.
        const tracked = (result.kept ?? []).some((f) => TRACKED_LABELS.has(f.label));
        if (!args.acceptChanges && tracked) console.log(`  ${dim(t().acceptChangesHint)}`);
        const comments = (result.kept ?? []).some((f) => f.label === 'Comment text');
        if (!args.removeComments && comments) console.log(`  ${dim(t().removeCommentsHint)}`);
        // [F-2.1] Scripts, actions, macros and embedded files left in place.
        const active = (result.kept ?? []).some((f) => f.kind === 'active-content' && f.confidence !== 'informational');
        if (!args.stripActive && active) console.log(`  ${dim(t().stripActiveHint)}`);
        const remote = (result.kept ?? []).some((f) => f.label === 'Tracking pixel' || f.label === 'Remote resource loaded on opening');
        if (!args.stripRemote && remote && ['html', 'markdown'].includes(result.format)) console.log(`  ${dim(t().stripRemoteHint)}`);
      }
    } catch (error) {
      failures++;
      const message = errorText(error, lang());
      console.error(`\n${bold(terminalSafe(file))}\n  ${red(terminalSafe(message))}`);
    }
  }
  if (args.manifest) {
    // [F-P2 2.4] Written even when some files failed: it lists the ones cleaned.
    const written = manifest(version(), { ...options, rules: args.rules }, entries);
    await writeFile(args.manifest, `${JSON.stringify(written, null, 2)}\n`);
    if (!args.json) console.log(`\n${dim(t().manifestWritten(terminalSafe(args.manifest), entries.length))}`);
  }
  return failures > 0 ? 1 : 0;
}

/**
 * [F-P3 2.6] A folder watched (src/cli/watch.ts): each file that arrives or
 * changes is inspected, and with --clean a cleaned copy is written to another
 * folder — never over the original, which may be the very file someone is
 * about to send. A file Cirta refuses to clean is named with the reason and
 * not copied. One line of JSON per file with --json.
 */
async function runWatch(args: Args): Promise<number> {
  const [folder, ...extra] = args.files;
  if (!folder || extra.length) {
    console.error(red(t().watchNeedFolder));
    return 2;
  }
  if (!(await stat(folder).then((info) => info.isDirectory(), () => false))) {
    console.error(red(terminalSafe(t().watchNotFolder(folder))));
    return 2;
  }
  const seconds = args.interval === undefined ? 1 : Number(args.interval);
  if (!(seconds >= 0.05)) {
    console.error(red(terminalSafe(t().watchBadInterval(String(args.interval)))));
    return 2;
  }
  if (args.clean && (args.inPlace || !args.output)) {
    console.error(red(t().watchNeedOutput));
    return 2;
  }
  const out = args.clean ? resolve(args.output!) : undefined;
  if (out) await mkdir(out, { recursive: true });
  const xray = await nodeXrayEngine();
  const options = redactOptions(args);
  const imageCodec = args.reencodeImages ? await nodeImageCodec() : undefined;

  const failed = (name: string, error: unknown) => {
    const message = errorText(error, lang());
    const code = (error as { code?: unknown } | null)?.code;
    if (args.json) console.log(terminalJson({ schema: REPORT_SCHEMA, file: name, error: message, ...(typeof code === 'string' ? { code } : {}) }, 0));
    else console.error(`\n${bold(terminalSafe(name))}\n  ${red(terminalSafe(message))}`);
  };

  const watcher = watchFolder({
    root: folder,
    interval: seconds * 1000,
    existing: !args.newOnly,
    ignore: out,
    skip: new Set([...SKIP_DIRECTORIES, ...args.skip]),
    onFile: async (path, name) => {
      try {
        const input = new Uint8Array(await readFile(path));
        const hint = formatHint(path, args.forceText);
        if (!out) {
          const result = await inspectFile(input, hint, { xray, pii: args.pii, rules: args.rules });
          if (args.json) console.log(terminalJson({ schema: REPORT_SCHEMA, file: name, result }, 0));
          else {
            console.log(`\n${bold(terminalSafe(name))} ${dim(`(${result.format})`)}`);
            const findings = safeFindings(result.findings);
            printFindings(findings);
            printNotes(safeNotes(result.notes));
          }
          return;
        }
        const result = await redactFile(input, hint, { xray, imageCodec, ...options });
        const destination = join(out, name);
        await mkdir(dirname(destination), { recursive: true });
        await safeWrite(destination, result.data!);
        if (args.json) console.log(terminalJson({ schema: REPORT_SCHEMA, file: name, output: destination, format: result.format, removed: result.removed, notes: result.notes }, 0));
        else {
          console.log(`\n${bold(terminalSafe(name))} ${dim(SYMBOL.arrow)} ${bold(terminalSafe(destination))}`);
          console.log(`  ${green(t().fieldsRemoved(result.removed.length))}`);
          printFindings(safeFindings(result.removed));
          printNotes(safeNotes(result.notes));
        }
      } catch (error) {
        failed(name, error);
      }
    },
  });
  console.error(t().watchWatching(terminalSafe(resolve(folder)), String(seconds)));
  console.error(dim(out ? t().watchModeClean(terminalSafe(out)) : t().watchModeInspect));
  await new Promise<void>((done) => {
    process.once('SIGTERM', done);
    process.once('SIGINT', done);
  });
  await watcher.stop();
  console.error(dim(t().watchStopped));
  return 0;
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

async function runText(args: Args): Promise<number> {
  const raw = await readStdin();

  let input: string;
  try {
    input = decodeTextInput(raw, { allowBinary: args.forceText });
  } catch (error) {
    if (!(error instanceof BinaryInputError)) throw error;
    console.error(red(`cirta text: ${t().binaryReasons[error.reason]}.`));
    console.error(dim(t().binaryRefused));
    return 2;
  }

  if (args.clean) {
    // The same clean the page runs. They used to differ: the page removed mail
    // headers that named a tool and the CLI kept them.
    const result = cleanPlainText(input, { normalizeSpaces: args.normalizeSpaces });
    // The cleaned text is the data, and is written as it is — except to a
    // terminal, where its controls would be obeyed rather than shown.
    process.stdout.write(process.stdout.isTTY ? result.text.split('\n').map(terminalSafe).join('\n') : result.text);
    // [C8] The report goes to stderr whether or not it is a terminal: piping
    // the text into a file is the usual case, and a clean that changed
    // something without saying so — Markdown taken out, letters recomposed —
    // is what this report exists to prevent.
    const count = result.removed.length;
    const anything = count || result.headersRemoved.length || result.markdownRemoved || result.spacesReplaced || result.recomposed;
    if (count) console.error(dim(t().removedTypes(count)));
    else if (!anything) console.error(dim(t().nothingRemoved));
    if (result.headersRemoved.length) console.error(dim(t().headersRemoved(result.headersRemoved.join(', '))));
    if (result.markdownRemoved) console.error(dim(t().markdownRemoved(result.markdownRemoved)));
    if (result.markdownKept) console.error(dim(t().markdownKept));
    if (result.recomposed) console.error(dim(t().recomposed(result.recomposed)));
    if (result.spacesReplaced) console.error(dim(t().spacesReplaced(result.spacesReplaced)));
    if (result.spacesKept) console.error(dim(t().spacesKept(result.spacesKept)));
    // What the clean left: lookalike letters, a secret, the lines an assistant
    // addressed to you. Without it the count above reads as "the text is clean".
    if (result.survivors.length) {
      console.error(yellow(t().stillInCleaned));
      for (const finding of result.survivors) {
        console.error(
          yellow(
            t().survivor(
              terminalSafe(translateLabel(finding.label, lang())),
              terminalSafe(translateLocation(finding.location, lang())),
              terminalSafe(translateValue(finding, lang())),
            ),
          ),
        );
      }
    }
    return 0;
  }

  // The same reading a file gets. These used to be two separate paths, and
  // they disagreed: piping a mail draft in reported only its odd characters,
  // while saving the identical bytes and inspecting the file named the
  // assistant that wrote it.
  const findings = inspectPlainText(input);
  if (args.json) {
    console.log(terminalJson({ format: 'text', findings }));
    return 0;
  }

  console.log(bold('stdin'));
  printProvenance(safeFindings(findings));
  printFindings(safeFindings(findings));
  printNotes([{ code: 'scope:invisible-characters-only' }]);
  printExposure(exposure(input));
  printStyle(stylometry(input));
  return 0;
}

async function main(): Promise<number> {
  // The locale first, so that even a parse error is reported in the right
  // language; --lang then overrides it. An unrecognised value is ignored rather
  // than rejected: failing a whole run over a typo in a cosmetic flag would be
  // out of proportion.
  setLang(detectLang(process.env));

  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(red(error instanceof Error ? error.message : String(error)));
    return 2;
  }
  if (args.lang === 'fr' || args.lang === 'en') setLang(args.lang);

  if (args.version) {
    console.log(`cirta ${version()}`);
    return 0;
  }

  // Asking for help succeeded; being invoked with nothing did not.
  if (args.help) {
    console.log(help());
    return 0;
  }
  if (!args.command) {
    console.log(help());
    return 1;
  }

  // [F-P2 2.3] A profile sets the cleaning options and the threshold in one word.
  // Options given explicitly are added to it; an explicit --fail-on wins.
  if (args.profile !== undefined) {
    if (!isProfile(args.profile)) {
      console.error(red(terminalSafe(t().unknownProfile(args.profile, Object.keys(PROFILES).join(', ')))));
      return 2;
    }
    const chosen = PROFILES[args.profile];
    for (const [key, value] of Object.entries(chosen.options)) if (value) (args as unknown as Record<string, boolean>)[key] = true;
    args.failOn ??= chosen.failOn;
  }

  if (args.report !== undefined && !/\.(?:html?|md|markdown)$/i.test(args.report)) {
    console.error(red(terminalSafe(t().reportFormat(args.report))));
    return 2;
  }

  // [F-2.3] The organisation's rules, read once; a file that does not read stops the run.
  if (args.rulesFile) {
    try {
      args.rules = parseRules(await readFile(args.rulesFile, 'utf8'));
    } catch (error) {
      console.error(red(terminalSafe(errorText(error, lang()))));
      return 2;
    }
  }

  // [F-P2 2.6] What a commit or a pull request touches, in place of the paths' whole content.
  if (args.changedOnly && (args.command === 'inspect' || args.command === 'verify')) {
    try {
      args.files = changedFiles(args.base, args.files);
    } catch (error) {
      if (!(error instanceof ChangedFilesError)) throw error;
      console.error(red(terminalSafe(error.reason === 'not-a-repository' ? t().changedNotRepo : t().changedUnknownBase(error.detail))));
      return 2;
    }
    if (!args.files.length) {
      // Nothing to judge is a pass, and machine output stays machine-readable.
      if (args.sarif) console.log(terminalJson(toSarif([], version())));
      else if (args.json) console.log('[]');
      else console.error(dim(t().changedNone));
      return 0;
    }
    args.skip = [];
  }

  switch (args.command) {
    case 'inspect':
      if (!args.files.length) {
        console.error(red(t().needFiles('inspect')));
        return 2;
      }
      args.files = await expandPaths(args.files, args.skip);
      if (!args.files.length) return 1;
      return runInspect(args);
    case 'redact':
      if (!args.files.length) {
        console.error(red(t().needFiles('redact')));
        return 2;
      }
      args.files = await expandPaths(args.files, args.skip);
      if (!args.files.length) return 1;
      return runRedact(args);
    case 'text':
      return runText(args);
    case 'sanitize-for-llm':
      if (!args.files.length) {
        console.error(red(t().needFiles('sanitize-for-llm')));
        return 2;
      }
      args.files = await expandPaths(args.files, args.skip);
      if (!args.files.length) return 1;
      return runSanitize(args);
    case 'mcp':
      return runMcp();
    case 'serve':
      return runServe(args);
    case 'watch':
      return runWatch(args);
    case 'verify':
      if (!args.files.length) {
        console.error(red(t().needFiles('verify')));
        return 2;
      }
      args.files = await expandPaths(args.files, args.skip);
      if (!args.files.length) return 1;
      return runVerify(args);
    default:
      console.error(red(t().unknownCommand(String(args.command))));
      console.log(help());
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof UnsupportedFormatError) console.error(red(errorText(error, lang())));
    else console.error(red(error instanceof Error ? error.stack ?? error.message : String(error)));
    process.exitCode = 1;
  });
