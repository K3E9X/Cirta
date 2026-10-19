#!/usr/bin/env node
/**
 * [F-P3 2.5] A running `cirta serve`, tried as a client would: the health
 * route, an inspection over HTTP, ICAP OPTIONS, and a RESPMOD of a Word file
 * carrying its author — let through and reported, the default.
 *
 *   node scripts/smoke-serve.mjs [--http http://127.0.0.1:8080] [--icap 127.0.0.1:1344]
 *
 * CI runs it against the Docker image. Exit 1 with the problems listed.
 */

import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { strToU8, zipSync } from 'fflate';

/** A Word file whose properties name its author. */
function docx() {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'docProps/core.xml': strToU8('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Marie Martin</dc:creator></cp:coreProperties>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Rapport</w:t></w:r></w:p></w:body></w:document>'),
  });
}

/** One ICAP exchange: the request sent, the whole response read (until the connection ends). */
function icapExchange({ host, port }, request) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, host);
    let response = '';
    socket.setTimeout(10_000, () => socket.destroy(new Error('timeout')));
    socket.on('connect', () => socket.end(request));
    socket.on('data', (data) => (response += data.toString('latin1')));
    socket.on('end', () => resolve(response));
    socket.on('close', () => resolve(response));
    socket.on('error', reject);
  });
}

export async function smokeServe({ http = 'http://127.0.0.1:8080', icap = { host: '127.0.0.1', port: 1344 } } = {}) {
  const problems = [];
  const check = async (label, run) => {
    try {
      const problem = await run();
      if (problem) problems.push(`${label}: ${problem}`);
    } catch (error) {
      problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const file = docx();

  await check('GET /health', async () => {
    const response = await fetch(`${http}/health`);
    const body = await response.json();
    if (response.status !== 200 || body.status !== 'ok') return `status ${response.status}`;
    if (body.blockOn !== null || body.allowClean !== false) return 'not inspection-only by default';
  });
  await check('POST /inspect', async () => {
    const response = await fetch(`${http}/inspect?name=rapport.docx`, { method: 'POST', body: file });
    const body = await response.json();
    if (response.status !== 200) return `status ${response.status}`;
    if (!body.result?.findings?.some((f) => f.label === 'Author' && f.value === 'Marie Martin')) return 'the author was not found';
  });
  await check('ICAP OPTIONS', async () => {
    const response = await icapExchange(icap, `OPTIONS icap://${icap.host}/respmod ICAP/1.0\r\nHost: ${icap.host}\r\nEncapsulated: null-body=0\r\n\r\n`);
    if (!/^ICAP\/1\.0 200 OK\r\n/.test(response) || !/\r\nMethods: RESPMOD\r\n/.test(response)) return JSON.stringify(response.slice(0, 80));
  });
  await check('ICAP RESPMOD', async () => {
    const res = `HTTP/1.1 200 OK\r\nContent-Length: ${file.length}\r\n\r\n`;
    const head = `RESPMOD icap://${icap.host}/respmod ICAP/1.0\r\nHost: ${icap.host}\r\nAllow: 204\r\nEncapsulated: res-hdr=0, res-body=${res.length}\r\n\r\n`;
    const body = Buffer.concat([Buffer.from(head + res + `${file.length.toString(16)}\r\n`), Buffer.from(file), Buffer.from('\r\n0\r\n\r\n')]);
    const response = await icapExchange(icap, body);
    if (!/^ICAP\/1\.0 204 No Content\r\n/.test(response)) return JSON.stringify(response.slice(0, 80));
    if (!/\r\nX-Cirta-Verdict: pass\r\n/.test(response) || !/\r\nX-Cirta-Findings: confirmed=[1-9]/.test(response)) return 'the author was not reported';
  });
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const [host = '127.0.0.1', port = '1344'] = (option('--icap') ?? '127.0.0.1:1344').split(':');
  const problems = await smokeServe({ http: option('--http') ?? 'http://127.0.0.1:8080', icap: { host, port: Number(port) } });
  for (const problem of problems) console.error(`FAIL  ${problem}`);
  if (problems.length) process.exit(1);
  console.log('cirta serve answers: health, inspect, ICAP OPTIONS, RESPMOD');
}
