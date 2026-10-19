import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve, type Service } from '../src/cli/serve.js';
import { inspectFile } from '../src/core/index.js';
import { makeDocx } from './fixtures.js';

/*
 * [F-P3 2.5] Cirta as a service: ICAP (RFC 3507), for a proxy or a mail
 * gateway, and an HTTP API. Inspection only unless told otherwise; values
 * never logged; nothing contacted.
 */

const CRLF = '\r\n';
const chunked = (body: Buffer, ieof = false) => Buffer.concat([body.length ? Buffer.from(`${body.length.toString(16)}${CRLF}`) : Buffer.alloc(0), body, Buffer.from(body.length ? CRLF : ''), Buffer.from(`0${ieof ? '; ieof' : ''}${CRLF}${CRLF}`)]);

/** An ICAP request with an HTTP response encapsulated, as a proxy sends it for a download. */
function respmod(body: Buffer, { headers = '', allow204 = true, service = 'respmod', httpHeaders = 'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document' } = {}) {
  const req = `GET http://example.test/docs/rapport.docx HTTP/1.1${CRLF}Host: example.test${CRLF}${CRLF}`;
  const res = `HTTP/1.1 200 OK${CRLF}${httpHeaders}${CRLF}Content-Length: ${body.length}${CRLF}${CRLF}`;
  const head =
    `RESPMOD icap://127.0.0.1/${service} ICAP/1.0${CRLF}Host: 127.0.0.1${CRLF}${allow204 ? `Allow: 204${CRLF}` : ''}${headers}` +
    `Encapsulated: req-hdr=0, res-hdr=${req.length}, res-body=${req.length + res.length}${CRLF}${CRLF}`;
  return Buffer.concat([Buffer.from(head + req + res), chunked(body)]);
}

/** Sends `requests` on one connection and collects one response per request (a 100 Continue counts as one). */
function talk(port: number, requests: Array<Buffer | ((received: string) => Buffer | undefined)>, expected = requests.length): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let buffer = '';
    const responses: string[] = [];
    let next = 0;
    const send = () => {
      const item = requests[next++];
      const data = typeof item === 'function' ? item(responses.at(-1) ?? '') : item;
      if (data) socket.write(data);
    };
    socket.on('connect', send);
    socket.on('data', (data) => {
      buffer += data.toString('latin1');
      for (;;) {
        const end = buffer.indexOf(CRLF + CRLF);
        if (end < 0) return;
        const head = buffer.slice(0, end);
        const hasBody = /^Encapsulated:.*-body=/im.test(head) && !/null-body/i.test(/^Encapsulated:(.*)$/im.exec(head)?.[1] ?? '');
        let total = end + 4;
        if (hasBody) {
          const offsets = /^Encapsulated:(.*)$/im.exec(head)![1]!;
          const bodyAt = Number(/-body=(\d+)/.exec(offsets)![1]);
          const terminator = buffer.indexOf(`0${CRLF}${CRLF}`, total + bodyAt);
          if (terminator < 0) return;
          total = terminator + 5;
        }
        responses.push(buffer.slice(0, total));
        buffer = buffer.slice(total);
        if (responses.length === expected) {
          socket.end();
          resolve(responses);
          return;
        }
        if (next < requests.length) send();
      }
    });
    socket.on('error', reject);
  });
}

describe('[F-P3 2.5] cirta serve', () => {
  const logs: string[] = [];
  let inspecting: Service;
  let blocking: Service;
  let cleaning: Service;
  const icap = (service: Service) => service.icap!.port;
  const http = (service: Service) => `http://127.0.0.1:${service.http!.port}`;

  beforeAll(async () => {
    const common = { host: '127.0.0.1', http: 0, icap: 0, maxBytes: 1024 * 1024, inspect: {}, clean: {}, lang: 'en' as const, version: 'test', log: (line: string) => logs.push(line) };
    inspecting = await serve({ ...common, allowClean: false });
    blocking = await serve({ ...common, allowClean: false, blockOn: 'confirmed' });
    cleaning = await serve({ ...common, allowClean: true });
  });
  afterAll(async () => {
    await Promise.all([inspecting.close(), blocking.close(), cleaning.close()]);
  });

  it('answers OPTIONS for each service, and 404 for one it does not offer', async () => {
    const [respmodOptions, reqmodOptions, unknown] = await talk(icap(inspecting), [
      Buffer.from(`OPTIONS icap://127.0.0.1/respmod ICAP/1.0${CRLF}Host: x${CRLF}Encapsulated: null-body=0${CRLF}${CRLF}`),
      Buffer.from(`OPTIONS icap://127.0.0.1/reqmod ICAP/1.0${CRLF}Host: x${CRLF}Encapsulated: null-body=0${CRLF}${CRLF}`),
      Buffer.from(`OPTIONS icap://127.0.0.1/avscan ICAP/1.0${CRLF}Host: x${CRLF}Encapsulated: null-body=0${CRLF}${CRLF}`),
    ]);
    expect(respmodOptions).toMatch(/^ICAP\/1\.0 200 OK\r\n/);
    expect(respmodOptions).toMatch(/^Methods: RESPMOD\r$/m);
    expect(respmodOptions).toMatch(/^Allow: 204\r$/m);
    expect(respmodOptions).toMatch(/^ISTag: "[^"]{1,32}"\r$/m);
    expect(reqmodOptions).toMatch(/^Methods: REQMOD\r$/m);
    expect(unknown).toMatch(/^ICAP\/1\.0 404 /);
  });

  it('inspects a download and lets it through untouched (204), saying what it found in headers and the log, never a value', async () => {
    logs.length = 0;
    const [response] = await talk(icap(inspecting), [respmod(Buffer.from(makeDocx()))]);
    expect(response).toMatch(/^ICAP\/1\.0 204 No Content\r\n/);
    expect(response).toMatch(/^X-Cirta-Verdict: pass\r$/m);
    expect(response).toMatch(/^X-Cirta-Findings: confirmed=[1-9]\d*, probable=\d+, informational=\d+\r$/m);
    const entry = JSON.parse(logs.at(-1)!);
    expect(entry).toMatchObject({ via: 'icap', service: 'respmod', name: 'rapport.docx', format: 'docx', outcome: 'pass' });
    expect(entry.labels).toContain('Author');
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(logs.join('\n')).not.toMatch(/Lotfi|Zakaria|example\.test/);
  });

  it('sends the message back unchanged when the client does not allow 204', async () => {
    const body = Buffer.from(makeDocx());
    const [response] = await talk(icap(inspecting), [respmod(body, { allow204: false })]);
    expect(response).toMatch(/^ICAP\/1\.0 200 OK\r\n/);
    const encapsulated = response!.slice(response!.indexOf(CRLF + CRLF) + 4);
    expect(encapsulated).toMatch(/^HTTP\/1\.1 200 OK\r\n/);
    const chunks = encapsulated.slice(encapsulated.indexOf(CRLF + CRLF) + 4);
    const size = parseInt(chunks.slice(0, chunks.indexOf(CRLF)), 16);
    expect(Buffer.from(chunks.slice(chunks.indexOf(CRLF) + 2, chunks.indexOf(CRLF) + 2 + size), 'latin1')).toEqual(body);
  });

  it('blocks with --block-on, naming what it found but not the values', async () => {
    const [response] = await talk(icap(blocking), [respmod(Buffer.from(makeDocx()))]);
    expect(response).toMatch(/^ICAP\/1\.0 200 OK\r\n/);
    expect(response).toMatch(/^X-Cirta-Verdict: block\r$/m);
    expect(response).toMatch(/\r\n\r\nHTTP\/1\.1 403 Forbidden\r\n/);
    expect(response).toMatch(/at least one confirmed finding[\s\S]*rapport\.docx: Author/);
    expect(response).not.toMatch(/Lotfi/);
    // A clean file still goes through.
    const [clean] = await talk(icap(blocking), [respmod(Buffer.from('Bonjour, tout simplement.\n'), { httpHeaders: 'Content-Type: text/plain' })]);
    expect(clean).toMatch(/^ICAP\/1\.0 204 /);
  });

  it('takes a preview, asks for the rest with 100 Continue, then judges the whole', async () => {
    const body = Buffer.from(makeDocx());
    const preview = body.subarray(0, 4);
    const req = `GET http://example.test/r.docx HTTP/1.1${CRLF}${CRLF}`;
    const res = `HTTP/1.1 200 OK${CRLF}Content-Length: ${body.length}${CRLF}${CRLF}`;
    const head = `RESPMOD icap://127.0.0.1/respmod ICAP/1.0${CRLF}Host: x${CRLF}Allow: 204${CRLF}Preview: 4${CRLF}Encapsulated: req-hdr=0, res-hdr=${req.length}, res-body=${req.length + res.length}${CRLF}${CRLF}`;
    const first = Buffer.concat([Buffer.from(head + req + res), Buffer.from(`4${CRLF}`), preview, Buffer.from(`${CRLF}0${CRLF}${CRLF}`)]);
    const rest = chunked(body.subarray(4));
    const [proceed, verdict] = await talk(icap(blocking), [first, (received) => (/^ICAP\/1\.0 100 Continue/.test(received) ? rest : undefined)], 2);
    expect(proceed).toMatch(/^ICAP\/1\.0 100 Continue\r\n\r\n$/);
    expect(verdict).toMatch(/^X-Cirta-Verdict: block\r$/m);
  });

  it.each([
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const)('reads a download compressed with %s as the browser would', async (coding, compress) => {
    const [response] = await talk(icap(blocking), [respmod(compress(makeDocx()), { httpHeaders: `Content-Type: application/octet-stream\r\nContent-Encoding: ${coding}` })]);
    expect(response).toMatch(/^X-Cirta-Verdict: block\r$/m);
  });

  it('lets through what it will not read whole, and says so: a body past --max-size, a body that inflates past it', async () => {
    logs.length = 0;
    const big = Buffer.alloc(1024 * 1024 + 10, 0x41);
    const [skipped, refused, bomb] = await talk(icap(blocking), [
      respmod(big, { httpHeaders: 'Content-Type: text/plain' }),
      respmod(big, { httpHeaders: 'Content-Type: text/plain', allow204: false }),
      respmod(gzipSync(Buffer.alloc(8 * 1024 * 1024)), { httpHeaders: 'Content-Type: text/plain\r\nContent-Encoding: gzip' }),
    ]);
    expect(skipped).toMatch(/^ICAP\/1\.0 204 /);
    expect(skipped).toMatch(/^X-Cirta-Verdict: skipped\r$/m);
    // Neither inspected nor kept: the client's own bypass setting decides.
    expect(refused).toMatch(/^ICAP\/1\.0 500 /);
    expect(bomb).toMatch(/^X-Cirta-Verdict: skipped\r$/m);
    expect(logs.map((line) => JSON.parse(line).reason)).toEqual(['too-large', 'too-large', 'content-encoding']);
  });

  it('inspects each file of an upload (REQMOD, multipart), and keeps the connection for the next request', async () => {
    const boundary = '----cirta';
    const form = Buffer.concat([
      Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="subject"${CRLF}${CRLF}Rapport${CRLF}`),
      Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="rapport.docx"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}`),
      Buffer.from(makeDocx()),
      Buffer.from(`${CRLF}--${boundary}--${CRLF}`),
    ]);
    const req = `POST http://mail.example.test/upload HTTP/1.1${CRLF}Content-Type: multipart/form-data; boundary=${boundary}${CRLF}Content-Length: ${form.length}${CRLF}${CRLF}`;
    const reqmod = Buffer.concat([
      Buffer.from(`REQMOD icap://127.0.0.1/reqmod ICAP/1.0${CRLF}Host: x${CRLF}Allow: 204${CRLF}Encapsulated: req-hdr=0, req-body=${req.length}${CRLF}${CRLF}${req}`),
      chunked(form),
    ]);
    logs.length = 0;
    const [blocked, options] = await talk(icap(blocking), [reqmod, Buffer.from(`OPTIONS icap://127.0.0.1/reqmod ICAP/1.0${CRLF}Host: x${CRLF}Encapsulated: null-body=0${CRLF}${CRLF}`)]);
    expect(blocked).toMatch(/HTTP\/1\.1 403 Forbidden/);
    expect(logs.map((line) => JSON.parse(line).name)).toContain('rapport.docx');
    expect(options).toMatch(/^Methods: REQMOD\r$/m);
  });

  it('serves an HTTP API: health, inspect, and clean only when allowed', async () => {
    const health = await fetch(`${http(inspecting)}/health`);
    expect(await health.json()).toMatchObject({ status: 'ok', version: 'test', blockOn: null, allowClean: false });

    const inspected = await fetch(`${http(inspecting)}/inspect?name=rapport.docx`, { method: 'POST', body: new Uint8Array(makeDocx()) });
    expect(inspected.status).toBe(200);
    const report = await inspected.json();
    expect(report).toMatchObject({ schema: 'cirta.report/1', file: 'rapport.docx', result: { format: 'docx' } });

    const unreadable = await fetch(`${http(inspecting)}/inspect?name=x.bin`, { method: 'POST', body: new Blob([new Uint8Array([0, 1, 2, 3, 0xff, 0xfe, 0, 0])]) });
    expect(unreadable.status).toBe(422);
    expect(await unreadable.json()).toMatchObject({ schema: 'cirta.report/1', file: 'x.bin' });

    const tooLarge = await fetch(`${http(inspecting)}/inspect`, { method: 'POST', body: new Blob([new Uint8Array(1024 * 1024 + 1)]) });
    expect(tooLarge.status).toBe(413);

    const refused = await fetch(`${http(inspecting)}/clean?name=rapport.docx`, { method: 'POST', body: new Uint8Array(makeDocx()) });
    expect(refused.status).toBe(403);

    const cleaned = await fetch(`${http(cleaning)}/clean?name=rapport.docx`, { method: 'POST', body: new Uint8Array(makeDocx()) });
    expect(cleaned.status).toBe(200);
    expect(cleaned.headers.get('content-disposition')).toBe('attachment; filename="rapport.clean.docx"');
    expect(Number(cleaned.headers.get('x-cirta-removed'))).toBeGreaterThan(0);
    const after = await inspectFile(new Uint8Array(await cleaned.arrayBuffer()), 'rapport.clean.docx');
    expect(after.findings.some((f) => /Lotfi Zakaria/.test(f.value))).toBe(false);

    expect((await fetch(`${http(inspecting)}/nowhere`)).status).toBe(404);
    expect((await fetch(`${http(inspecting)}/inspect`)).status).toBe(405);
  });
});

describe('[F-P3 2.5] cirta serve from the command line', () => {
  it('listens on the loopback only unless told otherwise, says where, and stops cleanly on SIGTERM', async () => {
    const child = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', '--root', '.', 'src/cli/index.ts', 'serve', '--http', '0', '--icap', '0', '--lang', 'en'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (data) => (stderr += data));
    await expect.poll(() => /HTTP: http:\/\/127\.0\.0\.1:\d+/.test(stderr), { timeout: 30_000 }).toBe(true);
    expect(stderr).toMatch(/ICAP: icap:\/\/127\.0\.0\.1:\d+\/respmod/);
    expect(stderr).toMatch(/inspection only/i);
    const port = Number(/http:\/\/127\.0\.0\.1:(\d+)/.exec(stderr)![1]);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const exit = new Promise<number | null>((resolve) => child.on('exit', resolve));
    child.kill('SIGTERM');
    expect(await exit).toBe(0);
    expect(stderr).toMatch(/Stopped\./);
  }, 60_000);
});
