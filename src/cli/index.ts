#!/usr/bin/env node
/**
 * Cirta command line interface.
 *
 * Everything runs locally; the process makes no network requests.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, dirname, join } from 'node:path';
import process from 'node:process';
import {
  inspectFile,
  redactFile,
  scanText,
  cleanText,
  UnsupportedFormatError,
  type Finding,
  type InspectResult,
  type Note,
  preview,
} from '../core/index.js';

const useColor = process.stdout.isTTY && !process.env['NO_COLOR'];
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
  cirta inspect <file...>            Report metadata carried by each file
  cirta redact  <file...> [options]  Write a copy with that metadata removed
  cirta text [--clean]               Read text on stdin; report or clean it

${bold('Options')}
  -o, --output <path>   Destination for a single redacted file
      --in-place        Overwrite the input files
      --json            Machine-readable output
  -h, --help            Show this message

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

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log(`  ${green('No metadata found.')}`);
    return;
  }
  const width = Math.max(...findings.map((f) => f.label.length));
  for (const finding of findings) {
    const flag = finding.affectsVerifiability ? yellow(' [verifiable provenance]') : '';
    console.log(
      `  ${dim(KIND_LABEL[finding.kind].padEnd(11))} ${finding.label.padEnd(width)}  ${preview(
        finding.value,
      )}${flag}`,
    );
    console.log(`  ${dim(' '.repeat(12) + finding.location)}`);
  }
}

const NOTE_TEXT: Record<Note['code'], (detail?: string) => string> = {
  'scope:pdf-metadata-only': () =>
    'PDF metadata only. Text inside the page content is not analysed, and a statistical model watermark there would not show up in this report.',
  'scope:ooxml-metadata-only': () =>
    'Document properties only. If the body contains text from a watermarking model, that signal lives in the wording and is unaffected by redaction.',
  'scope:invisible-characters-only': () =>
    'Invisible characters only. A statistical model watermark in this text, if present, is unaffected and cannot be detected locally.',
  'removed:c2pa': (detail) =>
    `Removed a C2PA manifest${detail ? ` (${detail})` : ''}. The file no longer carries verifiable provenance — third parties can no longer confirm its origin in either direction.`,
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
      const result = await inspectFile(new Uint8Array(await readFile(file)));
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

  if (args.json) console.log(JSON.stringify(results, null, 2));
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
      const result = await redactFile(new Uint8Array(await readFile(file)));
      const destination = args.inPlace ? file : (args.output ?? defaultOutputPath(file));
      await writeFile(destination, result.data!);

      if (!args.json) {
        console.log(`\n${bold(file)} ${dim('→')} ${bold(destination)}`);
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function runText(args: Args): Promise<number> {
  const input = await readStdin();

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

  if (args.help || !args.command) {
    console.log(HELP);
    return args.command ? 0 : 1;
  }

  switch (args.command) {
    case 'inspect':
      if (!args.files.length) {
        console.error(red('inspect needs at least one file.'));
        return 2;
      }
      return runInspect(args);
    case 'redact':
      if (!args.files.length) {
        console.error(red('redact needs at least one file.'));
        return 2;
      }
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
