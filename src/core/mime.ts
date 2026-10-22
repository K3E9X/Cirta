/**
 * A mail message, taken apart: its header block, and each MIME part decoded.
 *
 * The bytes are read as Latin-1 first, which maps every byte to one character
 * and back, so the structure — header lines, boundaries — is found without
 * guessing an encoding; each part's own Content-Transfer-Encoding and charset
 * then decide what its body really is. Depth and part count are capped: a
 * message is attacker-shaped input like any other.
 */

export interface MailHeader {
  name: string;
  value: string;
}

export interface MailPart {
  /** `type/subtype`, lowercased; text/plain when the part says nothing. */
  type: string;
  headers: MailHeader[];
  /** The decoded body bytes. */
  body: Uint8Array;
  /** The body as text, for text parts, in the declared charset. */
  text?: string;
  /** A name, when the part is an attachment or names itself. */
  filename?: string;
  attachment: boolean;
  /** [R3] The body as it stands in the message, still encoded, and its Content-Transfer-Encoding: for rewriting one part. */
  encoded: string;
  transferEncoding: string;
}

export interface MailMessage {
  /** The header block exactly as written, folded lines and all. */
  headerText: string;
  headers: MailHeader[];
  /** The leaf parts, in order; containers (multipart/*) are flattened away. */
  parts: MailPart[];
}

const MAX_DEPTH = 8;
const MAX_PARTS = 200;

export const latin1 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
};

export const bytesOf = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/** Split at the first blank line: the header block, then the body. */
function split(raw: string): { head: string; body: string } {
  const m = /\r?\n\r?\n/.exec(raw);
  if (!m) return { head: raw, body: '' };
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

export function parseHeaders(head: string): MailHeader[] {
  const headers: MailHeader[] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length) {
      headers[headers.length - 1]!.value += ' ' + line.trim();
      continue;
    }
    const m = /^([!-9;-~]+):[ \t]*(?![ \t])(.*)$/.exec(line);
    if (m) headers.push({ name: m[1]!.toLowerCase(), value: m[2]!.trim() });
  }
  return headers;
}

const header = (headers: MailHeader[], name: string) => headers.find((h) => h.name === name)?.value;

/**
 * [P0-1] The value cut at each ";" with an even number of quotes after it, as
 * `split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)` cut it — that lookahead read to the
 * end from every ";", quadratic on a header of semicolons.
 */
export function splitOutsideQuotes(value: string): string[] {
  let after = 0;
  for (const c of value) if (c === '"') after++;
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '"') after--;
    else if (value[i] === ';' && after % 2 === 0) {
      out.push(value.slice(from, i));
      from = i + 1;
    }
  }
  out.push(value.slice(from));
  return out;
}

/** A header's main value and its `; key=value` parameters, RFC 2231 continuations kept simple. */
function parameters(value: string | undefined): { main: string; params: Map<string, string> } {
  const params = new Map<string, string>();
  if (!value) return { main: '', params };
  const [main = '', ...rest] = splitOutsideQuotes(value);
  for (const part of rest) {
    const m = /^\s*([^=\s]+)\s*=\s*(?!\s)(.*)$/.exec(part);
    if (!m) continue;
    let key = m[1]!.toLowerCase();
    let val = m[2]!.trim().replace(/^"(.*)"$/, '$1');
    if (key.endsWith('*')) {
      // RFC 2231: charset'language'percent-encoded
      key = key.slice(0, -1);
      const encoded = /^([^']*)'[^']*'(.*)$/.exec(val);
      if (encoded) {
        const raw = encoded[2]!.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
        try {
          val = new TextDecoder(encoded[1] || 'utf-8').decode(bytesOf(raw));
        } catch {
          val = raw;
        }
      }
    }
    params.set(key, decodeWords(val));
  }
  return { main: main.trim().toLowerCase(), params };
}

/** RFC 2047 encoded words: `=?UTF-8?B?…?=` and `=?ISO-8859-1?Q?…?=`. */
export function decodeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset: string, kind: string, data: string) => {
      try {
        const bytes =
          kind.toLowerCase() === 'b'
            ? bytesOf(atob(data))
            : bytesOf(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return whole;
      }
    });
}

export function decodeTransfer(body: string, encoding: string): Uint8Array {
  switch (encoding) {
    case 'base64':
      try {
        return bytesOf(atob(body.replace(/[^A-Za-z0-9+/=]/g, '')));
      } catch {
        return bytesOf(body);
      }
    case 'quoted-printable':
      return bytesOf(
        body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
      );
    default:
      return bytesOf(body);
  }
}

/**
 * [R3] A part's body encoded again as it was: base64 in lines of 76, quoted-
 * printable with soft breaks, anything else as it is. `text` holds one byte
 * per character, as latin1() gives.
 */
export function encodeTransfer(text: string, encoding: string): string {
  if (encoding === 'base64') return (btoa(text).match(/.{1,76}/g) ?? []).join('\r\n');
  if (encoding !== 'quoted-printable') return text;
  return text
    .split(/\r?\n/)
    .map((line) => {
      let out = '';
      let width = 0;
      for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i);
        const last = i === line.length - 1;
        const plain = (code >= 33 && code <= 126 && code !== 61) || ((code === 32 || code === 9) && !last);
        const piece = plain ? line[i]! : `=${code.toString(16).toUpperCase().padStart(2, '0')}`;
        if (width + piece.length > 75) {
          out += '=\r\n';
          width = 0;
        }
        out += piece;
        width += piece.length;
      }
      return out;
    })
    .join('\r\n');
}

function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  try {
    return new TextDecoder(charset?.toLowerCase() || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function walk(raw: string, depth: number, out: MailPart[], top: boolean): MailHeader[] {
  const { head, body } = split(raw);
  const headers = parseHeaders(head);
  const { main: type, params } = parameters(header(headers, 'content-type'));
  const boundary = params.get('boundary');

  if (type.startsWith('multipart/') && boundary && depth < MAX_DEPTH) {
    const delimiter = `--${boundary}`;
    const chunks = body.split(new RegExp(`(?:^|\\r?\\n)${delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    // chunks[0] is the preamble; a chunk starting with "--" is the close.
    for (const chunk of chunks.slice(1)) {
      if (out.length >= MAX_PARTS || chunk.startsWith('--')) break;
      walk(chunk.replace(/^[ \t]*\r?\n/, ''), depth + 1, out, false);
    }
    return headers;
  }

  const disposition = parameters(header(headers, 'content-disposition'));
  const filename = disposition.params.get('filename') ?? params.get('name');
  const effective = type || 'text/plain';
  const transferEncoding = (header(headers, 'content-transfer-encoding') ?? '').toLowerCase().trim();
  const bytes = decodeTransfer(body, transferEncoding);
  const textual = effective.startsWith('text/') && disposition.main !== 'attachment';
  out.push({
    type: effective,
    headers: top ? [] : headers,
    body: bytes,
    text: textual ? decodeCharset(bytes, params.get('charset')) : undefined,
    filename,
    attachment: disposition.main === 'attachment' || (!textual && Boolean(filename)) || (!textual && !effective.startsWith('multipart/')),
    encoded: body,
    transferEncoding,
  });
  return headers;
}

export function parseMail(data: Uint8Array): MailMessage {
  const raw = latin1(data);
  const parts: MailPart[] = [];
  const headers = walk(raw, 0, parts, true);
  return { headerText: split(raw).head, headers, parts };
}

/**
 * Whether bytes open with an RFC 5322 header block: several fields, one of
 * them a field only a message has, then a blank line. The same bar the plain
 * text pass uses before it reports headers, so prose that happens to start
 * with "To:" is still prose.
 */
export function looksLikeMail(data: Uint8Array): boolean {
  const head = split(latin1(data.subarray(0, 64 * 1024))).head;
  if (!head || head.length === data.length) return false;
  const lines = head.split(/\r?\n/);
  if (!lines.every((line) => /^[ \t]/.test(line) || /^[!-9;-~]+:/.test(line))) return false;
  const names = new Set(parseHeaders(head).map((h) => h.name));
  const anchors = ['from', 'to', 'received', 'message-id', 'return-path', 'date'].filter((n) => names.has(n));
  return names.size >= 3 && anchors.length >= 1 && (names.has('mime-version') || names.has('content-type') || anchors.length >= 2);
}
