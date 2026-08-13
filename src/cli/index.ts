#!/usr/bin/env node
/**
 * Cirta command line interface.
 *
 * Everything runs locally; the process makes no network requests.
 */

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, dirname, join } from 'node:path';
import process from 'node:process';
import {
  inspectFile,
  redactFile,
  scanText,
  cleanText,
  UnsupportedFormatError,
  decodeTextInput,
  BinaryInputError,
  type Confidence,
  type Finding,
  type InspectResult,
  type Note,
  preview,
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

const paint = (code: string, text: string) => (useColor ? `[${code}m${text}[0m` : text);
const bold = (t: string) => paint('1', t);
const dim = (t: string) => paint('2', t);
const yellow = (t: string) => paint('33', t);
const red = (t: string) => paint('31', t);
const green = (t: string) => paint('32', t);

const KIND_LABEL: Record<Finding['kind'], string> = {
  identity: 'identity',
  provenance: 'provenance',
  timestamp: 'timestamp',
  environment: 'environment',
  'invisible-character': 'invisible',
};

const HELP = `
${bold('cirta')} — inspect and strip provenance metadata from documents

${bold('Usage')}
  cirta inspect <path...>            Report metadata carried by each file
  cirta redact  <path...> [options]  Write a copy with that metadata removed
  cirta text [--clean]               Read text on stdin; report or clean it

Paths may be files or directories. Directories are walked recursively for
.pdf, Office and OpenDocument files, .svg, .html, .md, .jpg and .png.

${bold('Options')}
  -o, --output <path>   Destination for a single redacted file
      --in-place        Overwrite the input files
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
`.trim();

interface Args {
  command: string | undefined;
  files: string[];
  output?: string;
  inPlace: boolean;
  json: boolean;
  clean: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: undefined, files: [], inPlace: false, json: false, clean: false, help: false };
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
  '.md', '.markdown',
  '.jpg', '.jpeg', '.png',
]);

/**
 * Text formats whose bytes are ambiguous: a Markdown file without front matter
 * is indistinguishable from plain text, so the extension breaks the tie.
 */
function formatHint(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  return undefined;
}

/**
 * Expand directory arguments into the supported files they contain, so that
 * `cirta inspect ./contrats` audits a whole folder before it is sent out.
 * Explicit file arguments are kept regardless of extension: naming a file is a
 * deliberate act, and format detection reads magic bytes rather than the name.
 */
async function expandPaths(paths: string[]): Promise<string[]> {
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
    const entries = await readdir(path, { recursive: true, withFileTypes: true });
    const found = entries
      .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(entry.parentPath ?? (entry as { path?: string }).path ?? path, entry.name))
      .sort();
    if (found.length === 0) console.error(dim(`${path}: no supported files found`));
    out.push(...found);
  }
  return out;
}

const NOTE_TEXT: Record<Note['code'], (detail?: string) => string> = {
  'scope:pdf-metadata-only': () =>
    'PDF metadata only. Text inside the page content is not analysed, and a statistical model watermark there would not show up in this report.',
  'scope:ooxml-metadata-only': () =>
    'Document properties only. If the body contains text from a watermarking model, that signal lives in the wording and is unaffected by redaction.',
  'scope:invisible-characters-only': () =>
    'Invisible characters only. A statistical model watermark in this text, if present, is unaffected and cannot be detected locally.',
  'scope:markup-metadata-only': () =>
    'Markup metadata only. The body text is not analysed, and a statistical model watermark in it would not show up here.',
  'scope:image-metadata-only': () =>
    'Image container metadata only. The pixels are not analysed: an invisible watermark encoded in the image data itself would not show up here, and is not removed.',
  'removed:c2pa': (detail) =>
    `Removed a C2PA manifest${detail ? ` (${detail})` : ''}. The file no longer carries verifiable provenance — third parties can no longer confirm its origin in either direction. Note that C2PA also supports soft binding, where a mark in the content itself lets a vendor re-attach the credential: a removed manifest does not mean no provenance remains.`,
  'kept:content': (detail) =>
    `Left in place: ${detail ?? 'document content'}. These are content rather than metadata — removing them would change what the recipient reads, so review them yourself.`,
};

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
      const result = await inspectFile(new Uint8Array(await readFile(file)), formatHint(file));
      results.push({ file, result });
      if (!args.json) {
        console.log(`\n${bold(file)} ${dim(`(${result.format})`)}`);
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
      const result = await redactFile(new Uint8Array(await readFile(file)), formatHint(file));
      const destination = args.inPlace ? file : (args.output ?? defaultOutputPath(file));
      await writeFile(destination, result.data!);

      if (!args.json) {
        console.log(`\n${bold(file)} ${dim(SYMBOL.arrow)} ${bold(destination)}`);
        console.log(
          `  ${green(`${result.removed.length} field${result.removed.length === 1 ? '' : 's'} removed`)}`,
        );
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
    input = decodeTextInput(raw);
  } catch (error) {
    if (!(error instanceof BinaryInputError)) throw error;
    console.error(red(`cirta text: ${error.message}.`));
    console.error(
      dim('Cleaning a document as if it were text corrupts it. Use `cirta redact <file>` instead.'),
    );
    return 2;
  }

  if (args.clean) {
    const result = cleanText(input);
    process.stdout.write(result.text);
    if (process.stderr.isTTY) {
      const count = result.removed.length;
      console.error(dim(count ? `\ncirta: removed ${count} invisible character type(s)` : '\ncirta: nothing to remove'));
    }
    return 0;
  }

  const scan = scanText(input);
  if (args.json) {
    console.log(JSON.stringify(scan, null, 2));
    return 0;
  }

  console.log(bold('stdin'));
  printFindings(scan.findings);
  for (const payload of scan.decoded) console.log(`  ${yellow('decoded:')} ${payload}`);
  printNotes([{ code: 'scope:invisible-characters-only' }]);
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
      args.files = await expandPaths(args.files);
      if (!args.files.length) return 1;
      return runInspect(args);
    case 'redact':
      if (!args.files.length) {
        console.error(red('redact needs at least one file or directory.'));
        return 2;
      }
      args.files = await expandPaths(args.files);
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
