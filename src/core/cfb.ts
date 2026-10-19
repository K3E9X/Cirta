/**
 * Compound File Binary (OLE2), read-only: the container of a VBA project, a
 * legacy .doc/.xls/.ppt, an Outlook .msg, an embedded OLE object.
 *
 * The format is a small file system: a FAT chaining sectors, a directory of
 * 128-byte entries arranged as red-black trees, and a mini stream for small
 * streams. Every chain is followed with a visited set and a length bound,
 * every offset is checked, so a file whose chains loop or point outside it
 * yields what it can and stops — it does not hang or throw a RangeError.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const FREE = 0xffffffff;
const NONE = 0xffffffff;
const MAX_ENTRIES = 10_000;
const MAX_STREAM = 64 * 1024 * 1024;

export interface CfbEntry {
  /** Path from the root, with "/" between storages: "VBA/dir", "__substg1.0_0037001F". */
  path: string;
  name: string;
  type: 'storage' | 'stream';
  size: number;
}

export interface Cfb {
  entries: CfbEntry[];
  /** A stream's bytes by path, matched without regard to case as the format specifies. */
  read(path: string): Uint8Array | undefined;
}

export function isCfb(data: Uint8Array): boolean {
  return data.length >= 512 && SIGNATURE.every((byte, i) => data[i] === byte);
}

export function readCfb(data: Uint8Array): Cfb | undefined {
  if (!isCfb(data)) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (at: number) => (at + 2 <= data.length ? view.getUint16(at, true) : 0);
  const u32 = (at: number) => (at + 4 <= data.length ? view.getUint32(at, true) : NONE);

  const sectorShift = u16(0x1e);
  const miniShift = u16(0x20);
  if (sectorShift < 7 || sectorShift > 16 || miniShift > sectorShift) return undefined;
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const cutoff = u32(0x38);
  const sectorAt = (sector: number) => (sector + 1) * sectorSize;
  const sectorCount = Math.floor((data.length - sectorSize) / sectorSize) + 1;

  // The FAT's own sectors are listed in the header's DIFAT, then in DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(0x4c + i * 4);
    if (s !== FREE && s !== END) fatSectors.push(s);
  }
  let difat = u32(0x44);
  const seenDifat = new Set<number>();
  while (difat !== END && difat !== FREE && difat < sectorCount && !seenDifat.has(difat) && fatSectors.length < sectorCount) {
    seenDifat.add(difat);
    const base = sectorAt(difat);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) {
      const s = u32(base + i * 4);
      if (s !== FREE && s !== END) fatSectors.push(s);
    }
    difat = u32(base + per * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    if (s >= sectorCount) continue;
    const base = sectorAt(s);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(u32(base + i * 4));
  }

  const chain = (start: number, table: number[], limit: number): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    let s = start;
    while (s !== END && s !== FREE && s < table.length && !seen.has(s) && out.length < limit) {
      seen.add(s);
      out.push(s);
      s = table[s]!;
    }
    return out;
  };

  const readChain = (start: number, size: number): Uint8Array => {
    const want = Math.min(size, MAX_STREAM);
    const out = new Uint8Array(want);
    let written = 0;
    for (const s of chain(start, fat, Math.ceil(want / sectorSize) + 1)) {
      if (written >= want) break;
      const base = sectorAt(s);
      const piece = data.subarray(base, Math.min(base + sectorSize, data.length, base + want - written));
      out.set(piece, written);
      written += piece.length;
    }
    return out.subarray(0, written);
  };

  // The directory is a stream like any other.
  const dirBytes = readChain(u32(0x30), MAX_ENTRIES * 128);
  const count = Math.min(Math.floor(dirBytes.length / 128), MAX_ENTRIES);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  interface Raw { name: string; type: number; left: number; right: number; child: number; start: number; size: number }
  const raw: Raw[] = [];
  for (let i = 0; i < count; i++) {
    const at = i * 128;
    const nameLength = Math.min(dirView.getUint16(at + 0x40, true), 64);
    let name = '';
    for (let j = 0; j + 1 < nameLength - 1; j += 2) name += String.fromCharCode(dirView.getUint16(at + j, true));
    raw.push({
      name,
      type: dirBytes[at + 0x42]!,
      left: dirView.getUint32(at + 0x44, true),
      right: dirView.getUint32(at + 0x48, true),
      child: dirView.getUint32(at + 0x4c, true),
      start: dirView.getUint32(at + 0x74, true),
      size: dirView.getUint32(at + 0x78, true),
    });
  }
  const root = raw[0];
  if (!root || root.type !== 5) return undefined;

  // Small streams live in the mini stream, which is the root entry's own stream.
  const miniStream = readChain(root.start, root.size);
  const miniFat: number[] = [];
  const miniFatBytes = readChain(u32(0x3c), u32(0x40) * sectorSize);
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset).getUint32(i, true));

  const readEntry = (entry: Raw): Uint8Array => {
    if (entry.size < cutoff) {
      const want = Math.min(entry.size, MAX_STREAM);
      const out = new Uint8Array(want);
      let written = 0;
      for (const s of chain(entry.start, miniFat, Math.ceil(want / miniSize) + 1)) {
        if (written >= want) break;
        const piece = miniStream.subarray(s * miniSize, Math.min((s + 1) * miniSize, miniStream.length, s * miniSize + want - written));
        out.set(piece, written);
        written += piece.length;
      }
      return out.subarray(0, written);
    }
    return readChain(entry.start, entry.size);
  };

  // Walk the trees: each storage's children hang off `child`, siblings off left/right.
  const entries: CfbEntry[] = [];
  const byPath = new Map<string, Raw>();
  const visited = new Set<number>();
  const walk = (index: number, prefix: string) => {
    const stack = [index];
    while (stack.length) {
      const i = stack.pop()!;
      if (i === NONE || i >= raw.length || visited.has(i)) continue;
      visited.add(i);
      const entry = raw[i]!;
      stack.push(entry.left, entry.right);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.type === 2) {
        entries.push({ path, name: entry.name, type: 'stream', size: entry.size });
        byPath.set(path.toLowerCase(), entry);
      } else if (entry.type === 1) {
        entries.push({ path, name: entry.name, type: 'storage', size: 0 });
        walk(entry.child, path);
      }
    }
  };
  walk(root.child, '');

  return {
    entries,
    read: (path) => {
      const entry = byPath.get(path.toLowerCase());
      return entry ? readEntry(entry) : undefined;
    },
  };
}
