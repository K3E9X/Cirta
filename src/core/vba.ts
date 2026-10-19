/**
 * [F-2.1] A VBA project — the macros of a .docm, .xlsm, .pptm or a legacy
 * .doc — read for what it would run: module names, the procedures Office
 * starts on its own, the calls that reach the system, and the addresses the
 * code holds. Read, never executed.
 *
 * The source is stored compressed (MS-OVBA 2.4.1) in each module's stream,
 * after a p-code block whose length the project's "dir" stream gives.
 */

import { readCfb } from './cfb.js';

const MAX_SOURCE = 4 * 1024 * 1024;

/** MS-OVBA 2.4.1: a signature byte, then chunks of at most 4096 decompressed bytes. */
export function decompressVba(data: Uint8Array): Uint8Array | undefined {
  if (data[0] !== 0x01) return undefined;
  const out: number[] = [];
  let at = 1;
  while (at + 2 <= data.length && out.length < MAX_SOURCE) {
    const header = data[at]! | (data[at + 1]! << 8);
    const size = (header & 0x0fff) + 3;
    const compressed = (header & 0x8000) !== 0;
    const end = Math.min(at + size, data.length);
    at += 2;
    const chunkStart = out.length;
    if (!compressed) {
      for (let i = 0; i < 4096 && at < end; i++) out.push(data[at++]!);
      at = end;
      continue;
    }
    while (at < end) {
      const flags = data[at++]!;
      for (let bit = 0; bit < 8 && at < end; bit++) {
        if ((flags & (1 << bit)) === 0) {
          out.push(data[at++]!);
          continue;
        }
        if (at + 2 > end) return undefined;
        const token = data[at]! | (data[at + 1]! << 8);
        at += 2;
        const position = out.length - chunkStart;
        let bitCount = 4;
        while (1 << bitCount < position) bitCount++;
        const lengthMask = 0xffff >> bitCount;
        const length = (token & lengthMask) + 3;
        const offset = (token >> (16 - bitCount)) + 1;
        if (offset > position) return undefined;
        for (let i = 0; i < length; i++) out.push(out[out.length - offset]!);
      }
    }
  }
  return new Uint8Array(out);
}

export interface VbaModule {
  name: string;
  source: string;
}

/** The modules of a vbaProject.bin, with their source when it reads. */
export function readVbaProject(bin: Uint8Array): VbaModule[] | undefined {
  const cfb = readCfb(bin);
  if (!cfb) return undefined;
  const dirEntry = cfb.entries.find((e) => e.type === 'stream' && /(^|\/)VBA\/dir$/i.test(e.path));
  if (!dirEntry) return undefined;
  const base = dirEntry.path.slice(0, -'dir'.length);
  const dir = decompressVba(cfb.read(dirEntry.path) ?? new Uint8Array());
  if (!dir) return undefined;

  const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const latin = new TextDecoder('latin1');
  const modules: Array<{ name: string; stream: string; offset: number }> = [];
  let current: { name: string; stream: string; offset: number } | undefined;
  let at = 0;
  while (at + 6 <= dir.length) {
    const id = view.getUint16(at, true);
    // PROJECTVERSION states a size of 4 and carries 6 bytes after it.
    if (id === 0x0009) {
      at += 12;
      continue;
    }
    const size = view.getUint32(at + 2, true);
    const body = dir.subarray(at + 6, at + 6 + size);
    at += 6 + size;
    if (id === 0x0019) {
      current = { name: latin.decode(body), stream: '', offset: 0 };
      modules.push(current);
    } else if (id === 0x001a && current) current.stream = latin.decode(body);
    else if (id === 0x0031 && current && body.length >= 4) current.offset = new DataView(body.buffer, body.byteOffset).getUint32(0, true);
    else if (id === 0x002b) current = undefined;
  }

  return modules.map(({ name, stream, offset }) => {
    const raw = cfb.read(`${base}${stream || name}`);
    const source = raw && offset < raw.length ? decompressVba(raw.subarray(offset)) : undefined;
    return { name, source: source ? latin.decode(source) : '' };
  });
}

/** Procedures Office runs without being asked. */
const AUTO = /\b(Auto_?Open|AutoExec|Auto_?Close|AutoNew|Document_(?:Open|Close|New|ContentControlOnEnter)|Workbook_(?:Open|Activate|BeforeClose)|Presentation_Open|DocumentBeforeClose)\b/gi;
/** Calls that leave the document: a shell, an object, the network, the file system. */
const SYSTEM =
  /\b(Shell(?:Execute)?|CreateObject|GetObject|WScript\.Shell|Wscript|PowerShell|cmd\.exe|URLDownloadToFile|XMLHTTP|WinHttp|MSXML2|ADODB\.Stream|Environ|Kill|CallByName|Declare\s+(?:PtrSafe\s+)?Function|VirtualAlloc|RtlMoveMemory)\b/gi;
const ADDRESS = /\bhttps?:\/\/[^\s"'<>)]+/gi;

export interface VbaSummary {
  modules: string[];
  autoRun: string[];
  system: string[];
  addresses: string[];
}

export function summariseVba(modules: VbaModule[]): VbaSummary {
  const unique = (values: string[]) => [...new Set(values)];
  const per = (pattern: RegExp) =>
    unique(modules.flatMap((m) => [...new Set([...m.source.matchAll(pattern)].map((x) => x[0]))].map((hit) => `${m.name}: ${hit}`)));
  return {
    modules: modules.map((m) => m.name),
    autoRun: per(AUTO),
    system: per(SYSTEM),
    addresses: unique(modules.flatMap((m) => [...m.source.matchAll(ADDRESS)].map((x) => x[0]))),
  };
}
