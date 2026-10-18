/**
 * Legacy Office files written by hand, for tests: OLE property sets
 * (MS-OLEPS) inside a compound file, with the stream that names the
 * application. No binary fixture — every byte is built here.
 */

import { strToU8, zlibSync } from 'fflate';
import { cfbFile } from './cfb.js';

export const SUMMARY = 'F29F85E0-4FF9-1068-AB91-08002B27B3D9';
export const DOC_SUMMARY = 'D5CDD502-2E9C-101B-9397-08002B2CF9AE';
export const USER_DEFINED = 'D5CDD505-2E9C-101B-9397-08002B2CF9AE';

export type PropValue = string | { wide: string } | { time: Date } | { seconds: number } | { i4: number };

export interface Section {
  fmtid: string;
  props: Record<number, PropValue>;
  /** The user-defined section's dictionary: property id to name. */
  names?: Record<number, string>;
}

function guid(text: string): number[] {
  const hex = text.replace(/-/g, '');
  const bytes = (from: number, count: number) => Array.from({ length: count }, (_, i) => parseInt(hex.slice(from + i * 2, from + i * 2 + 2), 16));
  return [...bytes(0, 4).reverse(), ...bytes(8, 2).reverse(), ...bytes(12, 2).reverse(), ...bytes(16, 8)];
}

const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const pad4 = (bytes: number[]) => [...bytes, ...new Array<number>((4 - (bytes.length % 4)) % 4).fill(0)];
const cp1252 = (text: string) => [...text].map((c) => c.charCodeAt(0) & 0xff);

function filetime(ticks: bigint): number[] {
  const out: number[] = [];
  for (let i = 0n; i < 8n; i++) out.push(Number((ticks >> (i * 8n)) & 0xffn));
  return out;
}

function value(v: PropValue): number[] {
  if (typeof v === 'string') return pad4([0x1e, 0, 0, 0, ...u32(v.length + 1), ...cp1252(v), 0]);
  if ('wide' in v) {
    const units = [...v.wide].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]);
    return pad4([0x1f, 0, 0, 0, ...u32(v.wide.length + 1), ...units, 0, 0]);
  }
  if ('time' in v) return [0x40, 0, 0, 0, ...filetime(BigInt(v.time.getTime()) * 10_000n + 116_444_736_000_000_000n)];
  if ('seconds' in v) return [0x40, 0, 0, 0, ...filetime(BigInt(v.seconds) * 10_000_000n)];
  return [0x03, 0, 0, 0, ...u32(v.i4)];
}

function section(s: Section): number[] {
  const entries: Array<[number, number[]]> = [[1, [0x02, 0, 0, 0, 0xe4, 0x04, 0, 0]]]; // codepage 1252
  if (s.names) {
    const dict: number[] = [...u32(Object.keys(s.names).length)];
    for (const [id, name] of Object.entries(s.names)) dict.push(...u32(Number(id)), ...u32(name.length + 1), ...cp1252(name), 0);
    entries.push([0, pad4(dict)]);
  }
  for (const [id, v] of Object.entries(s.props)) entries.push([Number(id), value(v)]);
  const headerSize = 8 + entries.length * 8;
  const table: number[] = [];
  const body: number[] = [];
  for (const [id, bytes] of entries) {
    table.push(...u32(id), ...u32(headerSize + body.length));
    body.push(...bytes);
  }
  return [...u32(headerSize + body.length), ...u32(entries.length), ...table, ...body];
}

export function propertySet(...sections: Section[]): Uint8Array {
  const head = [0xfe, 0xff, 0, 0, 0x06, 0x01, 0x02, 0x00, ...new Array<number>(16).fill(0), ...u32(sections.length)];
  let offset = head.length + sections.length * 20;
  const built = sections.map(section);
  for (const [i, s] of sections.entries()) {
    head.push(...guid(s.fmtid), ...u32(offset));
    offset += built[i]!.length;
  }
  return new Uint8Array([...head, ...built.flat()]);
}

/** The stream each application keeps its document in. */
const MAIN: Record<'doc' | 'xls' | 'ppt', string> = { doc: 'WordDocument', xls: 'Workbook', ppt: 'PowerPoint Document' };

export function legacyOffice(
  kind: 'doc' | 'xls' | 'ppt',
  options: { summary?: Section['props']; docSummary?: Section['props']; custom?: Record<string, string>; streams?: Record<string, Uint8Array> } = {},
): Uint8Array {
  const streams: Record<string, Uint8Array> = { [MAIN[kind]]: options.streams?.[MAIN[kind]] ?? new Uint8Array(64).fill(0x20) };
  if (options.summary) streams['\x05SummaryInformation'] = propertySet({ fmtid: SUMMARY, props: options.summary });
  if (options.docSummary || options.custom) {
    const sections: Section[] = [{ fmtid: DOC_SUMMARY, props: options.docSummary ?? {} }];
    if (options.custom) {
      const names: Record<number, string> = {};
      const props: Record<number, PropValue> = {};
      Object.entries(options.custom).forEach(([name, v], i) => {
        names[i + 2] = name;
        props[i + 2] = v;
      });
      sections.push({ fmtid: USER_DEFINED, props, names });
    }
    streams['\x05DocumentSummaryInformation'] = propertySet(...sections);
  }
  Object.assign(streams, options.streams ?? {});
  return cfbFile(streams);
}

/** MS-OLEDS CompObj: the header, then the user type, no clipboard format, then the ProgID. */
export function compObj(userType: string, progId: string): Uint8Array {
  const z = (s: string) => [...u32(s.length + 1), ...cp1252(s), 0];
  return new Uint8Array([...new Array<number>(28).fill(0), ...z(userType), ...u32(0), ...z(progId)]);
}

/** MS-OLEDS Ole10Native, as the Packager writes it: a file carried with the paths it came from. */
export function ole10Native(label: string, source: string, temp: string, data: Uint8Array): Uint8Array {
  const z = (s: string) => [...cp1252(s), 0];
  const body = [0x02, 0x00, ...z(label), ...z(source), 0x00, 0x00, 0x03, 0x00, ...u32(temp.length + 1), ...z(temp), ...u32(data.length), ...data];
  return new Uint8Array([...u32(body.length), ...body]);
}

/**
 * A "PowerPoint Document" stream holding one ExOleObjStg record (MS-PPT
 * 2.10.34), compressed as PowerPoint stores a VBA project or an object.
 */
export function pptOleRecord(storage: Uint8Array): Uint8Array {
  const compressed = zlibSync(storage);
  const body = [...u32(storage.length), ...compressed];
  return new Uint8Array([0x10, 0x00, 0x11, 0x10, ...u32(body.length), ...body]);
}

export const text = strToU8;
