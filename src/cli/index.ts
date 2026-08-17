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

const KIND_LABEL: Record<Finding['kind'], string> = {
  identity: 'identity',
  provenance: 'provenance',
  timestamp: 'timestamp',
  environment: 'environment',
  'invisible-character': 'invisible',
};

const HELP = `
${banner({
  unicode: useUnicode,
  paint: accent,
  lines: [
    bold('cirta'),
    'inspect and strip provenance metadata from documents',
    '',
    dim('everything runs locally; no network calls are made'),
  ],
})}

${bold('Usage')}
  cirta inspect <path...>            Report metadata carried by each file
  cirta redact  <path...> [options]  Write a copy with that metadata removed
  cirta text [--clean]               Read text on stdin; report or clean it

Paths may be files or directories. Directories are walked recursively for
documents, images and text files; build and dependency directories such as
node_modules, .git and dist are skipped.

${bold('Options')}
  -o, --output <path>   Destination for a single redacted file
      --in-place        Overwrite the input files (keeps a .bak)
      --skip <names>    Extra directory names to skip, comma-separated
      --force-text      Treat the input as text even if it looks binary
      --json            Machine-readable output
  -h, --help            Show this message

${bold('Confidence')}
  confirmed      Verbatim identifying data — a name, a company, a local path
  probable       Real information about you or your workflow, not always sensitive
  informational  Names the software rather than the author

${bold('Scope')}
  Handles document metadata (PDF /Info and XMP, Office docProps) and invisible
  Unicode in text. It does not detect or remove statistical model watermarks:
  those live in word choice, not in a field, and reading one requires the
  vendor's secret key. No local tool can do it, including this one.
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
      case '--skip':
        args.skip.push(...(argv[++i] ?? '').split(',').map((name) => name.trim()).filter(Boolean));
        break;
      case '-o':
      case '--output':
        args.output = argv[++i];
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
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
    console.log(`  ${green('No metadata found.')}`);
    return;
  }
  const width = Math.max(...findings.map((f) => f.label.length));
  for (const finding of findings) {
    const flag = finding.affectsVerifiability ? yellow(' [verifiable provenance]') : '';
    const mark = CONFIDENCE_STYLE[finding.confidence](finding.confidence.padEnd(13));
    console.log(
      `  ${mark} ${dim(KIND_LABEL[finding.kind].padEnd(11))} ${finding.label.padEnd(width)}  ${preview(
        finding.value,
      )}${flag}`,
    );
    console.log(`  ${dim(' '.repeat(26) + finding.location)}`);
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
    if (found.length === 0) console.error(dim(`${path}: no supported files found`));
    out.push(...found);
  }
  return out;
}

const NOTE_TEXT: Record<Note['code'], (detail?: string) => string> = {
  'scope:pdf-metadata-only': () =>
    'Metadata, plus a scan of decompressed streams for credentials and provider identifiers, and of page text decoded through each font\'s ToUnicode map. That map is what turns a subset font\'s glyph codes back into characters; a page whose font carries none is still read as raw codes, where a hit is real but a miss proves nothing. A statistical model watermark would not show up either way.',
  'scope:ooxml-metadata-only': () =>
    'Document properties, a scan of the parts for credentials and provider identifiers, and a scan of the visible text for invisible characters. What is not analysed is the wording: a statistical model watermark lives there and is unaffected by redaction.',
  'scope:invisible-characters-only': () =>
    'Character-level only: invisible codepoints, lookalike letters, and the credentials and provider identifiers that cannot occur innocently. A statistical model watermark in this text, if present, is unaffected and cannot be detected locally.',
  'scope:markup-metadata-only': () =>
    'Markup metadata, plus a scan of the body for invisible characters. What is not analysed is the wording: a statistical model watermark lives there and would not show up here.',
  'scope:image-metadata-only': () =>
    'Image container metadata only. The pixels are not analysed: an invisible watermark encoded in the image data itself would not show up here, and is not removed.',
  'removed:c2pa': (detail) =>
    `Removed a C2PA manifest${detail ? ` (${detail})` : ''}. The file no longer carries verifiable provenance — third parties can no longer confirm its origin in either direction. Note that C2PA also supports soft binding, where a mark in the content itself lets a vendor re-attach the credential: a removed manifest does not mean no provenance remains.`,
  'scope:archive': () =>
    'Archive report. Every member was dispatched through the normal detection path; members no parser recognises at all were scanned for credentials and provider identifiers only.',
  'limit:archive-truncated': (detail) =>
    `Archive traversal stopped at a built-in limit (${detail ?? 'member cap'}). Some members were not examined.`,
  'kept:in-content': (detail) =>
    `Not removed: ${detail ?? 'traces inside the content'}. These sit in the document's own content rather than in a metadata field, and rewriting it would change what the document says. Edit the source and regenerate — and if a credential is listed, rotate it.`,
  'kept:content': (detail) =>
    `Left in place: ${detail ?? 'document content'}. These are content rather than metadata — removing them would change what the recipient reads, so review them yourself.`,
};

/**
 * State what a silent report is worth at this length.
 *
 * No verdict is given because none is possible: reading a keyed watermark needs
 * the vendor's key. What can be said is how much statistical power a detector
 * that *did* hold the key would have on a passage this size.
 */
function printExposure(report: Exposure): void {
  const size = `~${report.low}-${report.high} tokens (${report.characters} characters, ${report.words} words)`;
  console.log(`\n  ${bold('Statistical watermark')}  ${dim('no local verdict is possible')}`);
  console.log(`  ${dim('length'.padEnd(11))} ${size}`);

  const verdict =
    report.band === 'too-short'
      ? 'At this length even the vendor may not get a reliable result; finding nothing here would mean almost nothing.'
      : report.band === 'uncertain'
        ? 'Long enough for a keyed detector to have some power, short enough that the outcome depends on the scheme and the threshold chosen.'
        : 'Long enough that published work (Kirchenbauer et al., ICLR 2024) found watermark signal surviving even sustained paraphrasing at a 1e-5 false-positive rate.';
  console.log(`  ${dim('meaning'.padEnd(11))} ${verdict}`);
  // Since August 2026 this is a live question rather than a theoretical one.
  console.log(
    `  ${dim('status'.padEnd(11))} ${dim('Anthropic states that future Claude models carry a watermark — a version of')}`,
  );
  console.log(
    `  ${dim(' '.repeat(11))} ${dim('DeepMind\'s SynthID-Text — under the EU transparency code in force since 2 Aug')}`,
  );
  console.log(
    `  ${dim(' '.repeat(11))} ${dim('2026; earlier models follow over the coming months. A detection API is announced')}`,
  );
  console.log(
    `  ${dim(' '.repeat(11))} ${dim('but not published, and reading the mark needs their key. Files instead get a')}`,
  );
  console.log(
    `  ${dim(' '.repeat(11))} ${dim('signed C2PA credential, which this tool does read and report.')}`,
  );
  // The point most likely to be conflated with this tool's own subject, said in
  // Anthropic's own words because the press coverage merged the two.
  console.log(
    `  ${dim('not this'.padEnd(11))} ${dim('"Nothing is added to the text and there are no hidden characters." The invisible')}`,
  );
  console.log(
    `  ${dim(' '.repeat(11))} ${dim('codepoints found above are a different mechanism, by someone else; removing them')}`,
  );
  console.log(
    `  ${dim(' '.repeat(11))} ${dim('leaves a statistical watermark untouched. It also carries no identifying data.')}`,
  );
  console.log(
    `  ${dim('careful'.padEnd(11))} ${dim('At best it answers how likely Claude was involved — not whether a person wrote')}`,
  );
  console.log(
    `  ${dim(' '.repeat(11))} ${dim('it, and not whether some other model did. It cannot separate "Claude wrote this"')}`,
  );
  console.log(
    `  ${dim(' '.repeat(11))} ${dim('from "Claude heavily edited this"; light proofreading leaves it almost nothing.')}`,
  );
  console.log(
    `  ${dim('note:')} ${dim('Cirta cannot read this class of mark, and neither can any other local tool. Token counts are estimated, not tokenized.')}`,
  );
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
  if (declared) {
    // A declaration outranks an inference: the file states this about itself
    // in the IPTC vocabulary, which is what the transparency rules are built on.
    console.log(`  ${bold('Produced by')}  ${red('a generative model — the file declares it')}`);
    if (tools.length) console.log(`  ${dim('              ')}${tools.join(' \u00b7 ')}`);
    return;
  }
  if (attributed) {
    console.log(`  ${bold('Produced by')}  ${yellow(tools.join(' · '))}`);
    console.log(`  ${dim('              according to the file\'s own metadata, which can be absent, wrong or forged')}`);
    return;
  }
  if (tools.length) {
    console.log(
      `  ${bold('Produced by')}  ${tools.join(' · ')} ` +
        dim('— the software that wrote the file; nothing names an assistant'),
    );
    if (machineAssembled) {
      console.log(
        `  ${dim('              the container\'s shape agrees: a program built it, not a word processor.')}`,
      );
    }
    return;
  }
  if (machineAssembled) {
    // No name, but the container's shape is evidence in itself.
    console.log(`  ${bold('Produced by')}  ${yellow('no tool is named, but a program assembled this file')}`);
    console.log(
      `  ${dim('              the container has the shape a library leaves, not the one a word processor does.')}`,
    );
    console.log(`  ${dim('              What it does not say is which program, or whether a model wrote the words.')}`);
    return;
  }
  console.log(
    `  ${bold('Produced by')}  ${dim('nothing in the metadata names a tool. That is not the same as "not AI":')}`,
  );
  console.log(
    `  ${dim('              the fields may have been cleared, never written, or the text pasted in by hand,')}`,
  );
  console.log(`  ${dim('              and the wording itself cannot be read here at all.')}`);
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
  console.log(`\n  ${bold('Style')}  ${dim('indicators, not a verdict')}`);

  const line = (name: string, value: string) => console.log(`  ${dim(name.padEnd(11))} ${value}`);
  line('shape', `${report.sentences} sentences, ${report.meanSentence.toFixed(1)} words on average`);
  line(
    'variation',
    `${report.burstiness.toFixed(2)} — how much sentence length moves; people usually vary more than models, ` +
      'and documentation varies less than either',
  );
  line('dashes', `${report.dashRate.toFixed(1)} em/en dashes per 1000 words`);
  if (report.boldLeadIns > 0) {
    line('lead-ins', `${Math.round(report.boldLeadIns * 100)}% of paragraphs open with a bold phrase`);
  }

  if (report.indicators.length) {
    line('phrases', `${report.indicators.length} of the turns of phrase assistants overuse:`);
    for (const indicator of report.indicators.slice(0, 8)) {
      console.log(`  ${' '.repeat(11)}   ${yellow(indicator.label)} ${dim(`×${indicator.count}`)}`);
    }
    if (report.indicators.length > 8) {
      console.log(`  ${' '.repeat(11)}   ${dim(`and ${report.indicators.length - 8} more`)}`);
    }
  }

  const meaning =
    report.band === 'many'
      ? 'Many of these are present at once. That is what generated prose tends to look like — and also what a rushed corporate draft looks like.'
      : report.band === 'several'
        ? 'A few are present. Individually every one of them has an innocent explanation.'
        : 'Few of these are present.';
  line('meaning', meaning);
  console.log(
    `  ${dim('note:')} ${dim('These are style signals, not evidence of authorship. Editing them away changes how the text reads, not where it came from.')}`,
  );
}

function printNotes(notes: Note[]): void {
  for (const note of notes) {
    const text = NOTE_TEXT[note.code](note.detail);
    const label = note.code === 'removed:c2pa' ? yellow('note:') : dim('note:');
    console.log(`  ${label} ${dim(text)}`);
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
    console.error(red('--output takes a single input file; use --in-place for several.'));
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
      console.error(dim(count ? `\ncirta: removed ${count} invisible character type(s)` : '\ncirta: nothing to remove'));
      // Lookalike letters are part of a word, so cleaning leaves them; saying so
      // on stderr keeps the count above from reading as "the text is now clean".
      for (const finding of result.kept) {
        console.error(yellow(`cirta: left in place — ${finding.label}: ${finding.value}`));
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
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(red(error instanceof Error ? error.message : String(error)));
    return 2;
  }

  // Asking for help succeeded; being invoked with nothing did not.
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (!args.command) {
    console.log(HELP);
    return 1;
  }

  switch (args.command) {
    case 'inspect':
      if (!args.files.length) {
        console.error(red('inspect needs at least one file or directory.'));
        return 2;
      }
      args.files = await expandPaths(args.files, args.skip);
      if (!args.files.length) return 1;
      return runInspect(args);
    case 'redact':
      if (!args.files.length) {
        console.error(red('redact needs at least one file or directory.'));
        return 2;
      }
      args.files = await expandPaths(args.files, args.skip);
      if (!args.files.length) return 1;
      return runRedact(args);
    case 'text':
      return runText(args);
    default:
      console.error(red(`Unknown command: ${args.command}`));
      console.log(HELP);
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
