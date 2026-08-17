#!/usr/bin/env node
/**
 * Cirta command line interface.
 *
 * Everything runs locally; the process makes no network requests.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, dirname, join } from 'node:path';
import process from 'node:process';
import { banner } from './logo.js';
import { lang, setLang, detectLang, t } from './i18n.js';
import { translateLabel, translateValue, translateLocation, noteText } from '../shared/french.js';
import { safeWrite, backup } from './write.js';
import {
  inspectFile,
  redactFile,
  inspectPlainText,
  cleanText,
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

${t().paths}

${bold(t().options)}
  -o, --output <path>   ${t().optOutput}
      --in-place        ${t().optInPlace}
      --skip <names>    ${t().optSkip}
      --force-text      ${t().optForceText}
      --lang <fr|en>    ${t().optLang}
      --json            ${t().optJson}
  -h, --help            ${t().optHelp}

${bold(t().confidenceTitle)}
  confirmed      ${t().confConfirmed}
  probable       ${t().confProbable}
  informational  ${t().confInformational}

${bold(t().scopeTitle)}
  ${t().scopeBody}
`.replace(/^\n+|\n+$/g, '');

interface Args {
  command: string | undefined;
  files: string[];
  output?: string;
  inPlace: boolean;
  json: boolean;
  clean: boolean;
  help: boolean;
  forceText: boolean;
  skip: string[];
  lang?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: undefined,
    files: [],
    inPlace: false,
    json: false,
    clean: false,
    help: false,
    forceText: false,
    skip: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
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
      case '--force-text':
        args.forceText = true;
        break;
      case '--lang':
        args.lang = argv[++i];
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
  for (const finding of findings) {
    const flag = finding.affectsVerifiability ? yellow(' [verifiable provenance]') : '';
    const mark = CONFIDENCE_STYLE[finding.confidence](t().confidence[finding.confidence].padEnd(13));
    console.log(
      `  ${mark} ${dim(t().kinds[finding.kind].padEnd(11))} ${translateLabel(
        finding.label,
        lang(),
      ).padEnd(width)}  ${preview(translateValue(finding, lang()))}${flag}`,
    );
    console.log(`  ${dim(' '.repeat(26) + translateLocation(finding.location, lang()))}`);
  }
}

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.pptx', '.docx', '.xlsx',
  '.odt', '.ods', '.odp',
  '.svg', '.html', '.htm',
  '.md', '.markdown', '.mdx',
  '.jpg', '.jpeg', '.png',
  '.zip', '.epub',
  // Plain text and source files. An invisible character in a .py or a .json
  // travels exactly as far as one in a .docx, and a bidi override in source is
  // the Trojan Source case — the reason those controls are called out at all.
  '.txt', '.text', '.log', '.csv', '.tsv',
  // Mail exports. The header block is the most talkative metadata this tool
  // reads, and a saved draft is exactly where it survives.
  '.eml', '.mbox',
  '.json', '.yaml', '.yml', '.toml', '.ini',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.rs', '.go', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.sql',
  '.css', '.scss', '.xml', '.rst', '.adoc',
]);

/**
 * Directories that are never the user's own content.
 *
 * Without this, `cirta inspect .` on an ordinary project is mostly noise: on
 * this repository the walk returned 125 files, 118 of them inside
 * node_modules. A report nobody can read through is a report nobody reads.
 */
const SKIP_DIRECTORIES = new Set([
  '.git', '.hg', '.svn',
  'node_modules', 'bower_components', 'vendor',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit',
  '.cache', '.gradle', '.terraform', 'coverage', '.idea', '.vscode',
]);

/**
 * Text formats whose bytes are ambiguous: a Markdown file without front matter
 * is indistinguishable from plain text, so the extension breaks the tie.
 */
function formatHint(path: string, forceText = false): string | undefined {
  if (forceText) return 'text';
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  return undefined;
}

/**
 * Dotfiles carrying secrets. `extname('.env')` is the empty string — a leading
 * dot is not an extension to Node — so these can only be matched by name.
 */
const SUPPORTED_NAMES = new Set(['.env', '.env.local', '.env.production', '.npmrc', '.netrc']);

const isSupportedFile = (name: string) =>
  SUPPORTED_NAMES.has(name.toLowerCase()) ||
  SUPPORTED_EXTENSIONS.has(extname(name).toLowerCase());

/** Walk a tree, pruning the directories rather than filtering their files out. */
async function walkDirectory(root: string, skip: Set<string>): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      // Pruning rather than filtering: descending into node_modules to throw
      // the results away still costs the descent.
      if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
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
    if (found.length === 0) console.error(dim(t().noSupported(path)));
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
  const { tools, attributed, declared, machineAssembled } = provenance(findings);
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

async function runInspect(args: Args): Promise<number> {
  const results: Array<{ file: string; result?: InspectResult; error?: string }> = [];
  let failures = 0;

  for (const file of args.files) {
    try {
      const result = await inspectFile(
        new Uint8Array(await readFile(file)),
        formatHint(file, args.forceText),
      );
      results.push({ file, result });
      if (!args.json) {
        console.log(`\n${bold(file)} ${dim(`(${result.format})`)}`);
        printProvenance(result.findings);
        printFindings(result.findings);
        printNotes(result.notes);
      }
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      if (args.json) results.push({ file, error: message });
      else console.error(`\n${bold(file)}\n  ${red(message)}`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return failures > 0 ? 1 : 0;
  }

  // A folder audit is only useful if it ends with a verdict rather than pages
  // of tables the reader has to tally themselves.
  if (args.files.length > 1) {
    const flagged = results.filter((r) =>
      r.result?.findings.some((f) => f.confidence === 'confirmed'),
    ).length;
    console.log(
      `\n${bold('Summary')}  ${args.files.length} file${args.files.length > 1 ? 's' : ''}, ` +
        (flagged
          ? red(`${flagged} carrying confirmed identifying data`)
          : green('none carrying confirmed identifying data')) +
        (failures ? `, ${red(`${failures} unreadable`)}` : ''),
    );
  }

  return failures > 0 ? 1 : 0;
}

async function runRedact(args: Args): Promise<number> {
  if (args.output && args.files.length > 1) {
    console.error(red(t().outputSingle));
    return 2;
  }

  let failures = 0;
  for (const file of args.files) {
    try {
      const result = await redactFile(
        new Uint8Array(await readFile(file)),
        formatHint(file, args.forceText),
      );
      const destination = args.inPlace ? file : (args.output ?? defaultOutputPath(file));
      // Overwriting the input is the one case where a failed write costs the
      // original, so a copy is taken first and named in the report.
      const saved = args.inPlace ? await backup(file) : undefined;
      await safeWrite(destination, result.data!);

      if (!args.json) {
        console.log(`\n${bold(file)} ${dim(SYMBOL.arrow)} ${bold(destination)}`);
        console.log(
          `  ${green(`${result.removed.length} field${result.removed.length === 1 ? '' : 's'} removed`)}`,
        );
        if (saved) console.log(`  ${dim(`original kept as ${saved}`)}`);
        printFindings(result.removed);
        printNotes(result.notes);
      }
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n${bold(file)}\n  ${red(message)}`);
    }
  }
  return failures > 0 ? 1 : 0;
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
    console.error(red(`cirta text: ${error.message}.`));
    console.error(
      dim(
        'Cleaning a document as if it were text corrupts it. Use `cirta redact <file>` instead,\n' +
          'or pass --force-text if you are certain these bytes are text.',
      ),
    );
    return 2;
  }

  if (args.clean) {
    const result = cleanText(input);
    process.stdout.write(result.text);
    if (process.stderr.isTTY) {
      const count = result.removed.length;
      console.error(dim(count ? t().removedTypes(count) : t().nothingRemoved));
      // Lookalike letters are part of a word, so cleaning leaves them; saying so
      // on stderr keeps the count above from reading as "the text is now clean".
      for (const finding of result.kept) {
        console.error(
          yellow(
            t().leftInPlace(translateLabel(finding.label, lang()), translateValue(finding, lang())),
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
    console.log(JSON.stringify({ format: 'text', findings }, null, 2));
    return 0;
  }

  console.log(bold('stdin'));
  printProvenance(findings);
  printFindings(findings);
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

  // Asking for help succeeded; being invoked with nothing did not.
  if (args.help) {
    console.log(help());
    return 0;
  }
  if (!args.command) {
    console.log(help());
    return 1;
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
    if (error instanceof UnsupportedFormatError) console.error(red(error.message));
    else console.error(red(error instanceof Error ? error.stack ?? error.message : String(error)));
    process.exitCode = 1;
  });
