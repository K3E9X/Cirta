/**
 * [F-P3 2.2] TAR archives built byte by byte: ustar headers with their
 * checksum, pax records, GNU long names. No binary fixture.
 */

const enc = new TextEncoder();

export interface TarEntry {
  name: string;
  data?: Uint8Array | string;
  type?: '0' | '2' | '5' | 'x' | 'g' | 'L';
  link?: string;
  uname?: string;
  gname?: string;
  uid?: number;
  gid?: number;
  mtime?: number;
  pax?: Record<string, string>;
}

const octal = (n: number, size: number) => n.toString(8).padStart(size - 1, '0') + '\0';

function header(entry: TarEntry, size: number, type: string, name: string): Uint8Array {
  const block = new Uint8Array(512);
  const put = (text: string, at: number, length: number) => block.set(enc.encode(text).subarray(0, length), at);
  put(name, 0, 100);
  put(octal(type === '5' ? 0o755 : 0o644, 8), 100, 8);
  put(octal(entry.uid ?? 0, 8), 108, 8);
  put(octal(entry.gid ?? 0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(entry.mtime ?? 0, 12), 136, 12);
  put('        ', 148, 8);
  put(type, 156, 1);
  put(entry.link ?? '', 157, 100);
  put('ustar\u000000', 257, 8);
  put(entry.uname ?? '', 265, 32);
  put(entry.gname ?? '', 297, 32);
  const sum = block.reduce((n, b) => n + b, 0);
  put(octal(sum, 7) + ' ', 148, 8);
  return block;
}

const padded = (data: Uint8Array) => {
  const out = new Uint8Array(Math.ceil(data.length / 512) * 512);
  out.set(data);
  return out;
};

/** A pax record set, each line "<length> <key>=<value>\n" with the length counting itself. */
export function paxRecords(records: Record<string, string>): Uint8Array {
  let text = '';
  for (const [key, value] of Object.entries(records)) {
    const body = ` ${key}=${value}\n`;
    let length = enc.encode(body).length + 1;
    while (`${length}`.length + enc.encode(body).length !== length) length = `${length}`.length + enc.encode(body).length;
    text += `${length}${body}`;
  }
  return enc.encode(text);
}

export function tar(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    if (entry.pax) {
      const records = paxRecords(entry.pax);
      blocks.push(header(entry, records.length, 'x', `PaxHeader/${entry.name}`.slice(0, 99)), padded(records));
    }
    let name = entry.name;
    if (name.length > 99) {
      const long = enc.encode(`${name}\0`);
      blocks.push(header(entry, long.length, 'L', '././@LongLink'), padded(long));
      name = name.slice(0, 99);
    }
    const data = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data ?? new Uint8Array(0);
    blocks.push(header(entry, data.length, entry.type ?? '0', name), padded(data));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}

/** The bytes of a binary plist holding one URL, as macOS keeps kMDItemWhereFroms. */
export const whereFroms = (url: string) => enc.encode(`bplist00¡\u0001_\u0010${String.fromCharCode(url.length)}${url}`);
