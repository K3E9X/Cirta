/**
 * [F-2.2] OLE property sets (MS-OLEPS): the "\x05SummaryInformation" and
 * "\x05DocumentSummaryInformation" streams of a legacy .doc, .xls or .ppt,
 * where Office keeps the author, the last person to save, the company, the
 * template and the editing time — the same fields docProps/ holds in a .docx.
 *
 * Read-only and bounded: every count is capped by what the stream can hold,
 * every offset is checked, and a property that does not read is skipped.
 */

export const FMTID_SUMMARY = 'f29f85e0-4ff9-1068-ab91-08002b27b3d9';
export const FMTID_DOC_SUMMARY = 'd5cdd502-2e9c-101b-9397-08002b2cf9ae';
export const FMTID_USER_DEFINED = 'd5cdd505-2e9c-101b-9397-08002b2cf9ae';

const VT_I2 = 0x02;
const VT_I4 = 0x03;
const VT_BOOL = 0x0b;
const VT_UI4 = 0x13;
const VT_LPSTR = 0x1e;
const VT_LPWSTR = 0x1f;
const VT_FILETIME = 0x40;
const MAX_STRING = 64 * 1024;
const MAX_SECTIONS = 4;

export type PropertyValue = string | number | boolean;

export interface PropertySection {
  fmtid: string;
  properties: Map<number, PropertyValue>;
  /** The user-defined section's dictionary: property id to name. */
  names: Map<number, string>;
}

/** FILETIME ticks (100 ns since 1601) between 1601 and 1970. */
const EPOCH_DIFF = 116_444_736_000_000_000n;

/** An editing time is a FILETIME holding a duration, not a date. */
export function duration(ticks: bigint): string {
  const minutes = Number(ticks / 600_000_000n);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

function guid(bytes: Uint8Array): string {
  const hex = (from: number, to: number, reverse: boolean) => {
    const part = [...bytes.subarray(from, to)];
    return (reverse ? part.reverse() : part).map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10, false)}-${hex(10, 16, false)}`;
}

function decoder(codepage: number): TextDecoder {
  try {
    if (codepage === 65001) return new TextDecoder('utf-8');
    if (codepage === 1200) return new TextDecoder('utf-16le');
    return new TextDecoder(`windows-${codepage}`);
  } catch {
    return new TextDecoder('windows-1252');
  }
}

const clean = (text: string) => text.replace(/\0[\s\S]*$/, '').trim();

/**
 * The sections of a property set stream, each with the properties that read.
 * Times are ISO strings, except PID 10 of the summary section (editing time),
 * which is a duration and comes back as one.
 */
export function readPropertySet(data: Uint8Array): PropertySection[] {
  if (data.length < 28 || data[0] !== 0xfe || data[1] !== 0xff) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u32 = (at: number) => (at >= 0 && at + 4 <= data.length ? view.getUint32(at, true) : undefined);
  const count = Math.min(u32(24) ?? 0, MAX_SECTIONS);
  const sections: PropertySection[] = [];

  for (let s = 0; s < count; s++) {
    const entry = 28 + s * 20;
    if (entry + 20 > data.length) break;
    const fmtid = guid(data.subarray(entry, entry + 16));
    const base = u32(entry + 16);
    if (base === undefined || base + 8 > data.length) continue;
    const size = Math.min(u32(base) ?? 0, data.length - base);
    const end = base + size;
    // Each property takes 8 bytes of the table: the count cannot exceed that.
    const props = Math.min(u32(base + 4) ?? 0, Math.floor(size / 8));
    const table: Array<[number, number]> = [];
    for (let i = 0; i < props; i++) {
      const id = u32(base + 8 + i * 8);
      const offset = u32(base + 12 + i * 8);
      if (id === undefined || offset === undefined) break;
      table.push([id, base + offset]);
    }

    let codepage = 1252;
    const codepageAt = table.find(([id]) => id === 1)?.[1];
    if (codepageAt !== undefined && codepageAt + 6 <= end && view.getUint16(codepageAt, true) === VT_I2) codepage = view.getUint16(codepageAt + 4, true);
    const text = decoder(codepage);
    const wide = new TextDecoder('utf-16le');

    const section: PropertySection = { fmtid, properties: new Map(), names: new Map() };
    for (const [id, at] of table) {
      if (at < base || at + 4 > end) continue;
      // The code page, the locale and the behaviour flags describe the set, not the document.
      if (id === 1 || id >= 0x80000000) continue;
      if (id === 0) {
        // The dictionary has no type: a count, then id, length and name.
        const entries = Math.min(u32(at) ?? 0, 1024);
        let p = at + 4;
        for (let i = 0; i < entries && p + 8 <= end; i++) {
          const pid = u32(p)!;
          const length = Math.min(u32(p + 4)!, MAX_STRING);
          const bytes = codepage === 1200 ? length * 2 : length;
          if (p + 8 + bytes > end) break;
          section.names.set(pid, clean((codepage === 1200 ? wide : text).decode(data.subarray(p + 8, p + 8 + bytes))));
          p += 8 + bytes;
          if (codepage === 1200) p += (4 - (bytes % 4)) % 4;
        }
        continue;
      }
      const type = view.getUint16(at, true);
      const value = at + 4;
      let read: PropertyValue | undefined;
      if (type === VT_I2 && value + 2 <= end) read = view.getInt16(value, true);
      else if (type === VT_I4 && value + 4 <= end) read = view.getInt32(value, true);
      else if (type === VT_UI4 && value + 4 <= end) read = view.getUint32(value, true);
      else if (type === VT_BOOL && value + 2 <= end) read = view.getUint16(value, true) !== 0;
      else if (type === VT_LPSTR && value + 4 <= end) {
        const length = Math.min(u32(value)!, MAX_STRING, end - value - 4);
        read = clean((codepage === 1200 ? wide : text).decode(data.subarray(value + 4, value + 4 + length)));
      } else if (type === VT_LPWSTR && value + 4 <= end) {
        const length = Math.min(u32(value)! * 2, MAX_STRING, end - value - 4);
        read = clean(wide.decode(data.subarray(value + 4, value + 4 + (length & ~1))));
      } else if (type === VT_FILETIME && value + 8 <= end) {
        const ticks = view.getBigUint64(value, true);
        if (fmtid === FMTID_SUMMARY && id === 10) read = duration(ticks);
        else if (ticks > EPOCH_DIFF) {
          const ms = Number((ticks - EPOCH_DIFF) / 10_000n);
          const date = new Date(ms);
          if (!Number.isNaN(date.getTime()) && date.getUTCFullYear() < 10_000) read = date.toISOString();
        }
      }
      if (read !== undefined && read !== '') section.properties.set(id, read);
    }
    sections.push(section);
  }
  return sections;
}
