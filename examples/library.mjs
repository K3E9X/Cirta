// [F-P2 2.5] Cirta as a library, from Node.
//
//   node examples/library.mjs document.pdf
//
// inspectFile() reports, redactFile() cleans and says what was removed and
// what is still there. The engines from 'cirta/node' let the core render PDF
// pages (hidden text); without them it says it could not check.

import { readFile, writeFile } from 'node:fs/promises';
import { inspectFile, redactFile, REPORT_SCHEMA } from 'cirta';
import { nodeXrayEngine } from 'cirta/node';

const path = process.argv[2];
if (!path) {
  console.error('usage: node examples/library.mjs <file>');
  process.exit(2);
}

const data = new Uint8Array(await readFile(path));
const xray = await nodeXrayEngine();

const report = await inspectFile(data, path, { xray });
console.log(JSON.stringify({ schema: REPORT_SCHEMA, file: path, result: report }, null, 2));

const cleaned = await redactFile(data, path, { xray });
const output = path.replace(/(\.[^.]+)?$/, '.clean$1');
await writeFile(output, cleaned.data ?? new TextEncoder().encode(cleaned.text ?? ''));
console.error(`${cleaned.removed.length} removed, ${cleaned.kept?.length ?? 0} still there → ${output}`);
