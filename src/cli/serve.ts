/**
 * [F-P3 2.5] Cirta as a service, for the machines that cannot run the
 * command line on each file: a web proxy, a mail gateway, an upload service.
 *
 *   ICAP (RFC 3507)   RESPMOD /respmod — what is downloaded through a proxy
 *                     REQMOD  /reqmod  — what is sent: uploads, form posts, mail
 *   HTTP              GET /health, POST /inspect, POST /clean (--allow-clean)
 *
 * Inspection only, by default: every file is let through untouched (ICAP 204,
 * or the message sent back as it came) and what it carries is reported — in
 * X-Cirta-* headers the proxy can log, and as one JSON line per file on
 * stdout. With --block-on <level>, a file carrying a finding at that level is
 * replaced by a 403 page that names the findings, never their values.
 *
 * The log names the file, its format, size, SHA-256, the count per level and
 * the labels. Never a value, never the URL: a gateway's log is read by more
 * people than the documents it saw.
 *
 * It listens, and only that: it opens no connection to anything (see
 * test/no-network.test.ts). Loopback by default; the Docker image listens on
 * every interface of its container.
 *
 * What it does not inspect, it lets through and says so (outcome "skipped"):
 * a format Cirta does not read, a body larger than --max-size, an encoding it
 * cannot undo. A gateway that blocked whatever it could not read would block
 * most of the web; the log is there to see what went by unread.
 */

import { createHash } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { inspectFile, redactFile, type Confidence, type InspectOptions, type InspectResult } from '../core/index.js';
import { REPORT_SCHEMA } from '../core/report-schema.js';
import { errorText, translateLabel, type Lang } from '../shared/french.js';
import { formatHint } from './hint.js';
import { stringsFor } from './i18n.js';

export interface ServeOptions {
  host: string;
  /** Port of the HTTP API; undefined: none. 0 picks a free one. */
  http?: number;
  /** Port of the ICAP server; undefined: none. */
  icap?: number;
  /** Replace a file carrying a finding at this level or above. Undefined: inspection only. */
  blockOn?: Confidence;
  /** Offer POST /clean. */
  allowClean: boolean;
  /** Bodies larger than this are not inspected. */
  maxBytes: number;
  inspect: InspectOptions;
  clean: InspectOptions;
  lang: Lang;
  version: string;
  /** One JSON line per file judged. */
  log: (line: string) => void;
}

export interface Service {
  http?: { port: number; server: HttpServer };
  icap?: { port: number; server: TcpServer };
  close(): Promise<void>;
}

const RANK: Record<Confidence, number> = { informational: 0, probable: 1, confirmed: 2 };
const LEVELS: Confidence[] = ['confirmed', 'probable', 'informational'];

/* ------------------------------------------------------------- judging -- */

interface Verdict {
  name: string;
  format?: string;
  bytes: number;
  sha256: string;
  counts: Record<Confidence, number>;
  labels: string[];
  outcome: 'pass' | 'block' | 'skipped';
  reason?: string;
}

/** A name for the format detection, from what the transfer says the content is. */
const TYPE_HINT: Array<[RegExp, string]> = [
  [/^(?:text\/html|application\/xhtml\+xml)\b/i, 'page.html'],
  [/^image\/svg\+xml\b/i, 'image.svg'],
  [/^text\/markdown\b/i, 'page.md'],
  [/^message\/rfc822\b/i, 'message.eml'],
  [/^text\/calendar\b/i, 'event.ics'],
  [/^text\/(?:x-)?vcard\b/i, 'card.vcf'],
  [/^application\/json\b/i, 'data.json'],
  [/^text\//i, 'text.txt'],
];

function hintFor(name: string | undefined, contentType: string | undefined): string | undefined {
  if (name && /\.[a-z0-9]{1,8}$/i.test(name)) return name;
  const typed = contentType ? TYPE_HINT.find(([pattern]) => pattern.test(contentType))?.[1] : undefined;
  return typed ?? name;
}

async function judge(data: Uint8Array, name: string | undefined, contentType: string | undefined, options: ServeOptions): Promise<{ verdict: Verdict; result?: InspectResult; error?: unknown }> {
  const counts: Record<Confidence, number> = { confirmed: 0, probable: 0, informational: 0 };
  const base = { name: name ?? '', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), counts, labels: [] as string[] };
  const hint = hintFor(name, contentType);
  try {
    const result = await inspectFile(data, hint ? formatHint(hint) ?? hint : undefined, options.inspect);
    for (const finding of result.findings) counts[finding.confidence]++;
    const block = options.blockOn !== undefined && result.findings.some((f) => RANK[f.confidence] >= RANK[options.blockOn!]);
    const labels = [...new Set(result.findings.map((f) => f.label))].sort();
    return { verdict: { ...base, format: result.format, labels, outcome: block ? 'block' : 'pass' }, result };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { verdict: { ...base, outcome: 'skipped', reason: typeof code === 'string' ? code : 'unreadable' }, error };
  }
}

function record(options: ServeOptions, via: 'icap' | 'http', service: string, verdict: Verdict): void {
  options.log(JSON.stringify({ time: new Date().toISOString(), via, service, ...verdict }));
}

const findingsHeader = (verdicts: Verdict[]) =>
  LEVELS.map((level) => `${level}=${verdicts.reduce((sum, v) => sum + v.counts[level], 0)}`).join(', ');

/** The page a blocked file is replaced by: what was found, by label, never a value. */
function blockedPage(verdicts: Verdict[], options: ServeOptions): Buffer {
  const s = stringsFor(options.lang);
  const lines = verdicts
    .filter((v) => v.outcome === 'block')
    .map((v) => `- ${v.name || s.serveUnnamed}: ${v.labels.map((label) => translateLabel(label, options.lang)).join(', ')}`);
  return Buffer.from(`${s.serveBlocked(s.confidenceName[options.blockOn!])}\n\n${lines.join('\n')}\n`);
}

/* ---------------------------------------------------------- HTTP parts -- */

interface HttpHead {
  startLine: string;
  headers: Map<string, string>;
}

function parseHttpHead(raw: Buffer): HttpHead {
  const lines = raw.toString('latin1').split('\r\n');
  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { startLine: lines[0] ?? '', headers };
}

/** The file name a Content-Disposition gives, if any. */
function dispositionName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(value)?.[1];
  if (extended) {
    try {
      return decodeURIComponent(extended.trim());
    } catch {
      return extended.trim();
    }
  }
  return /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;\s]+)/.exec(value)?.slice(1).find((v) => v !== undefined);
}

/** The last segment of the URL a request line names. */
function urlName(startLine: string | undefined): string | undefined {
  const target = startLine?.split(' ')[1];
  if (!target) return undefined;
  try {
    const path = new URL(target, 'http://host/').pathname;
    const last = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    return last || undefined;
  } catch {
    return undefined;
  }
}

/** The body as the receiving application would read it: Content-Encoding undone. */
function decoded(body: Buffer, encoding: string | undefined, maxBytes: number): Buffer | undefined {
  const codings = (encoding ?? '').toLowerCase().split(',').map((c) => c.trim()).filter((c) => c && c !== 'identity');
  let out = body;
  for (const coding of codings.reverse()) {
    try {
      if (coding === 'gzip' || coding === 'x-gzip') out = gunzipSync(out, { maxOutputLength: maxBytes });
      else if (coding === 'deflate') out = inflateSync(out, { maxOutputLength: maxBytes });
      else if (coding === 'br') out = brotliDecompressSync(out, { maxOutputLength: maxBytes });
      else return undefined;
    } catch {
      return undefined;
    }
  }
  return out;
}

interface Part {
  name?: string;
  contentType?: string;
  data: Buffer;
}

/** The parts of a multipart/form-data body. */
function multipart(body: Buffer, contentType: string): Part[] | undefined {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.slice(1).find((v) => v !== undefined);
  if (!boundary) return undefined;
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString('latin1') === '--') break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const section = body.subarray(start + 2, next - 2); // past the CRLF after the delimiter, before the CRLF ahead of the next
    const split = section.indexOf('\r\n\r\n');
    if (split >= 0) {
      const head = parseHttpHead(Buffer.concat([Buffer.from('part\r\n'), section.subarray(0, split)]));
      const disposition = head.headers.get('content-disposition');
      const field = /\bname="([^"]*)"/.exec(disposition ?? '')?.[1];
      parts.push({ name: dispositionName(disposition) ?? (field !== undefined ? `${field}.txt` : undefined), contentType: head.headers.get('content-type'), data: section.subarray(split + 4) });
    }
    at = next;
  }
  return parts;
}

/* ---------------------------------------------------------------- ICAP -- */

class Closed extends Error {}
class Malformed extends Error {}

/** Reads a socket as a stream of bytes: lines, exact lengths, without copying a body more than once. */
class SocketReader {
  private queue: Buffer[] = [];
  private queued = 0;
  private wake?: () => void;
  private closed = false;

  constructor(socket: Socket) {
    socket.on('data', (data: Buffer) => {
      this.queue.push(data);
      this.queued += data.length;
      this.wake?.();
    });
    const end = () => {
      this.closed = true;
      this.wake?.();
    };
    socket.on('end', end);
    socket.on('close', end);
    socket.on('error', end);
  }

  private async fill(): Promise<void> {
    if (this.closed) throw new Closed();
    await new Promise<void>((resolve) => (this.wake = resolve));
    this.wake = undefined;
  }

  private head(max: number): Buffer {
    if (this.queue.length === 1 || (this.queue[0]?.length ?? 0) >= max) return (this.queue[0] ?? Buffer.alloc(0)).subarray(0, max);
    const parts: Buffer[] = [];
    let length = 0;
    for (const chunk of this.queue) {
      parts.push(chunk);
      length += chunk.length;
      if (length >= max) break;
    }
    return Buffer.concat(parts, Math.min(length, max)).subarray(0, max);
  }

  private take(n: number): Buffer {
    const parts: Buffer[] = [];
    let need = n;
    while (need > 0) {
      const first = this.queue[0]!;
      if (first.length <= need) {
        parts.push(first);
        this.queue.shift();
        need -= first.length;
      } else {
        parts.push(first.subarray(0, need));
        this.queue[0] = first.subarray(need);
        need = 0;
      }
    }
    this.queued -= n;
    return parts.length === 1 ? parts[0]! : Buffer.concat(parts, n);
  }

  /** The bytes up to and including `delimiter`, refused past `limit`. */
  async until(delimiter: string, limit: number): Promise<Buffer> {
    const mark = Buffer.from(delimiter, 'latin1');
    for (;;) {
      const head = this.head(limit + mark.length);
      const at = head.indexOf(mark);
      if (at >= 0) return this.take(at + mark.length);
      if (head.length >= limit + mark.length) throw new Malformed();
      await this.fill();
    }
  }

  async exactly(n: number): Promise<Buffer> {
    while (this.queued < n) await this.fill();
    return this.take(n);
  }

  async discard(n: number): Promise<void> {
    let left = n;
    while (left > 0) {
      if (this.queued === 0) await this.fill();
      const step = Math.min(left, this.queued);
      this.take(step);
      left -= step;
    }
  }

  /** Whether the peer has closed and nothing is left to read. */
  get done(): boolean {
    return this.closed && this.queued === 0;
  }
}

/** Reads chunks up to the last one into `sink`; past `room()` bytes, they are read and dropped. Returns whether the last chunk said ieof. */
async function readChunks(reader: SocketReader, sink: (data: Buffer) => void, room: () => number): Promise<boolean> {
  for (;;) {
    const line = (await reader.until('\r\n', 1024)).toString('latin1').trim();
    const [sizeText = '', ...extensions] = line.split(';');
    if (!/^[0-9a-f]+$/i.test(sizeText.trim())) throw new Malformed();
    const size = parseInt(sizeText, 16);
    if (size === 0) {
      // Trailers, if any, then the empty line.
      while ((await reader.until('\r\n', 8192)).length > 2);
      return extensions.some((e) => e.trim().toLowerCase() === 'ieof');
    }
    if (size > room()) {
      await reader.discard(size);
      sink(Buffer.alloc(0));
      room = () => -1;
    } else sink(await reader.exactly(size));
    await reader.exactly(2);
  }
}

const SERVICES: Record<string, 'RESPMOD' | 'REQMOD'> = { '/respmod': 'RESPMOD', '/reqmod': 'REQMOD' };

function icapResponse(status: string, headers: Array<[string, string]>, encapsulated?: { http: Buffer; kind: 'res' | 'req'; body?: Buffer }): Buffer {
  const lines = [`ICAP/1.0 ${status}`, ...headers.map(([name, value]) => `${name}: ${value}`)];
  if (!encapsulated) {
    lines.push('Encapsulated: null-body=0');
    return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1');
  }
  const body = encapsulated.body;
  lines.push(`Encapsulated: ${encapsulated.kind}-hdr=0, ${body ? `${encapsulated.kind}-body` : 'null-body'}=${encapsulated.http.length}`);
  const parts = [Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1'), encapsulated.http];
  if (body) parts.push(body.length ? Buffer.from(`${body.length.toString(16)}\r\n`) : Buffer.alloc(0), body, Buffer.from(body.length ? '\r\n0\r\n\r\n' : '0\r\n\r\n'));
  return Buffer.concat(parts);
}

async function handleIcap(socket: Socket, options: ServeOptions): Promise<void> {
  const reader = new SocketReader(socket);
  const tag = `"cirta-${options.version}-${options.blockOn ?? 'inspect'}"`.slice(0, 34);
  const common: Array<[string, string]> = [['ISTag', tag], ['Service', `Cirta ${options.version}`]];
  socket.setTimeout(120_000, () => socket.destroy());

  while (!reader.done) {
    let head: Buffer;
    try {
      head = await reader.until('\r\n\r\n', 65536);
    } catch {
      break;
    }
    const request = parseHttpHead(head.subarray(0, head.length - 4));
    const match = /^(OPTIONS|REQMOD|RESPMOD) (\S+) ICAP\/1\.0$/.exec(request.startLine);
    if (!match) {
      socket.end(icapResponse('400 Bad Request', common));
      return;
    }
    const [, method, uri] = match;
    let path: string;
    try {
      path = new URL(uri!).pathname;
    } catch {
      socket.end(icapResponse('400 Bad Request', common));
      return;
    }
    const offered = SERVICES[path];

    // The encapsulated message: its HTTP headers, then perhaps a chunked body.
    const sections = [...(request.headers.get('encapsulated') ?? '').matchAll(/(?<![a-z-])([a-z-]+)=(\d+)/g)].map(([, name, offset]) => ({ name: name!, offset: Number(offset) }));
    const bodySection = sections.find((section) => /-body$/.test(section.name));
    const http: Record<string, Buffer> = {};
    try {
      if (bodySection && bodySection.offset > 0) {
        const raw = await reader.exactly(bodySection.offset);
        const ordered = [...sections].sort((a, b) => a.offset - b.offset);
        for (let i = 0; i < ordered.length; i++) {
          const section = ordered[i]!;
          if (/-hdr$/.test(section.name)) http[section.name] = raw.subarray(section.offset, ordered[i + 1]?.offset ?? raw.length);
        }
      }
    } catch {
      break;
    }

    if (method === 'OPTIONS') {
      if (bodySection && bodySection.name !== 'null-body') await readChunks(reader, () => {}, () => -1);
      if (!offered) socket.write(icapResponse('404 ICAP Service Not Found', common));
      else
        socket.write(
          icapResponse('200 OK', [
            ['Methods', offered],
            ...common,
            ['Allow', '204'],
            ['Transfer-Preview', '*'],
            ['Options-TTL', '3600'],
            ['Max-Connections', '100'],
          ]),
        );
      continue;
    }

    // The body, preview first if the client sent one.
    const parts: Buffer[] = [];
    let size = 0;
    let oversize = false;
    const sink = (data: Buffer) => {
      if (oversize) return;
      size += data.length;
      if (data.length === 0 || size > options.maxBytes) {
        oversize = true;
        parts.length = 0;
      } else parts.push(data);
    };
    const room = () => options.maxBytes - size;
    const hasBody = bodySection !== undefined && bodySection.name !== 'null-body';
    const preview = request.headers.has('preview');
    let previewComplete = false;
    try {
      if (hasBody) {
        const ieof = await readChunks(reader, sink, room);
        if (preview && !ieof) {
          socket.write('ICAP/1.0 100 Continue\r\n\r\n');
          await readChunks(reader, sink, room);
        } else if (preview) previewComplete = true;
      }
    } catch {
      break;
    }

    if (!offered || offered !== method) {
      socket.write(icapResponse(offered ? '405 Method Not Allowed' : '404 ICAP Service Not Found', common));
      continue;
    }
    const may204 = (request.headers.get('allow') ?? '').split(',').some((v) => v.trim() === '204') || previewComplete;
    const kind = method === 'RESPMOD' ? 'res' : 'req';
    const message = http[`${kind}-hdr`];
    const httpHead = message ? parseHttpHead(message) : undefined;
    const requestHead = http['req-hdr'] ? parseHttpHead(http['req-hdr']) : undefined;
    const raw = parts.length === 1 ? parts[0]! : Buffer.concat(parts);

    // What is inspected: the body as the application reads it; for a form upload, each part.
    const verdicts: Verdict[] = [];
    const service = path.slice(1);
    if (oversize) {
      verdicts.push({ name: '', bytes: size, sha256: '', counts: { confirmed: 0, probable: 0, informational: 0 }, labels: [], outcome: 'skipped', reason: 'too-large' });
    } else if (hasBody && raw.length) {
      const contentType = httpHead?.headers.get('content-type');
      const body = decoded(raw, httpHead?.headers.get('content-encoding'), options.maxBytes);
      const name = dispositionName(httpHead?.headers.get('content-disposition')) ?? urlName(requestHead?.startLine);
      const items: Part[] | undefined = !body
        ? undefined
        : method === 'REQMOD' && /^multipart\/form-data/i.test(contentType ?? '')
          ? multipart(body, contentType!)
          : [{ name, contentType, data: body }];
      if (!items) verdicts.push({ name: name ?? '', bytes: raw.length, sha256: '', counts: { confirmed: 0, probable: 0, informational: 0 }, labels: [], outcome: 'skipped', reason: 'content-encoding' });
      else for (const item of items) verdicts.push((await judge(new Uint8Array(item.data), item.name, item.contentType, options)).verdict);
    }
    for (const verdict of verdicts) record(options, 'icap', service, verdict);

    const blocked = verdicts.some((v) => v.outcome === 'block');
    const summary: Array<[string, string]> = [
      ...common,
      ['X-Cirta-Verdict', blocked ? 'block' : verdicts.length && verdicts.every((v) => v.outcome === 'skipped') ? 'skipped' : 'pass'],
      ['X-Cirta-Findings', findingsHeader(verdicts)],
    ];
    if (blocked) {
      const page = blockedPage(verdicts, options);
      const http403 = Buffer.from(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${page.length}\r\nCache-Control: no-store\r\n\r\n`, 'latin1');
      socket.write(icapResponse('200 OK', summary, { http: http403, kind: 'res', body: page }));
    } else if (may204) {
      socket.write(icapResponse('204 No Content', summary));
    } else if (oversize) {
      // Neither inspected nor kept: the client's bypass policy decides.
      socket.write(icapResponse('500 Server Error', [...summary, ['X-Cirta-Reason', 'too-large']]));
    } else {
      socket.write(icapResponse('200 OK', summary, { http: message ?? Buffer.alloc(0), kind, body: hasBody ? raw : undefined }));
    }
  }
  socket.end();
}

/* ---------------------------------------------------------------- HTTP -- */

function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    let over = false;
    request.on('data', (data: Buffer) => {
      size += data.length;
      if (size > maxBytes) {
        over = true;
        parts.length = 0;
      } else if (!over) parts.push(data);
    });
    request.on('end', () => resolve(over ? undefined : Buffer.concat(parts)));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  response.end(body);
}

const cleanName = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}.clean${name.slice(dot)}` : `${name || 'file'}.clean`;
};

async function handleHttp(request: IncomingMessage, response: ServerResponse, options: ServeOptions): Promise<void> {
  const s = stringsFor(options.lang);
  const url = new URL(request.url ?? '/', 'http://localhost/');
  const routes = ['/health', '/inspect', '/clean'];
  if (!routes.includes(url.pathname)) return json(response, 404, { error: s.serveNotFound });
  if (url.pathname === '/health') {
    if (request.method !== 'GET') return json(response, 405, { error: s.serveMethod });
    return json(response, 200, { status: 'ok', version: options.version, blockOn: options.blockOn ?? null, allowClean: options.allowClean });
  }
  if (request.method !== 'POST') return json(response, 405, { error: s.serveMethod });
  if (url.pathname === '/clean' && !options.allowClean) {
    request.resume();
    return json(response, 403, { error: s.serveCleanDisabled });
  }
  const body = await readBody(request, options.maxBytes);
  if (!body) return json(response, 413, { error: s.serveTooLarge(Math.round(options.maxBytes / 1024 / 1024)) });
  const name = url.searchParams.get('name') ?? dispositionName(request.headers['content-disposition']) ?? '';
  const contentType = request.headers['content-type'];

  if (url.pathname === '/inspect') {
    const { verdict, result, error } = await judge(new Uint8Array(body), name || undefined, contentType, options);
    record(options, 'http', 'inspect', verdict);
    if (result) return json(response, 200, { schema: REPORT_SCHEMA, file: name, result });
    const code = (error as { code?: unknown } | null)?.code;
    return json(response, 422, { schema: REPORT_SCHEMA, file: name, error: errorText(error, options.lang), ...(typeof code === 'string' ? { code } : {}) });
  }

  // /clean
  const hint = hintFor(name || undefined, contentType);
  try {
    const result = await redactFile(new Uint8Array(body), hint ? formatHint(hint) ?? hint : undefined, options.clean);
    const out = result.data ?? new TextEncoder().encode(result.text ?? '');
    options.log(JSON.stringify({ time: new Date().toISOString(), via: 'http', service: 'clean', name, format: result.format, bytes: body.length, removed: result.removed.length, kept: result.kept?.length ?? 0 }));
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': out.length,
      'Content-Disposition': `attachment; filename="${cleanName(name).replace(/["\\\r\n]/g, '_')}"`,
      'X-Cirta-Removed': String(result.removed.length),
      'X-Cirta-Kept': String(result.kept?.length ?? 0),
      'Cache-Control': 'no-store',
    });
    response.end(out);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    json(response, 422, { schema: REPORT_SCHEMA, file: name, error: errorText(error, options.lang), ...(typeof code === 'string' ? { code } : {}) });
  }
}

/* --------------------------------------------------------------- start -- */

const listen = (server: HttpServer | TcpServer, port: number, host: string) =>
  new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });

export async function serve(options: ServeOptions): Promise<Service> {
  const service: Service = {
    close: async () => {
      const closing: Array<Promise<void>> = [];
      if (service.http) closing.push(new Promise((resolve) => service.http!.server.close(() => resolve())));
      if (service.icap) closing.push(new Promise((resolve) => service.icap!.server.close(() => resolve())));
      service.http?.server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      await Promise.all(closing);
    },
  };
  const sockets = new Set<Socket>();
  if (options.icap !== undefined) {
    const server = createTcpServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      handleIcap(socket, options).catch(() => socket.destroy());
    });
    service.icap = { server, port: await listen(server, options.icap, options.host) };
  }
  if (options.http !== undefined) {
    const server = createHttpServer((request, response) => {
      handleHttp(request, response, options).catch(() => {
        if (!response.headersSent) json(response, 500, { error: 'internal error' });
        else response.destroy();
      });
    });
    server.requestTimeout = 120_000;
    service.http = { server, port: await listen(server, options.http, options.host) };
  }
  return service;
}
