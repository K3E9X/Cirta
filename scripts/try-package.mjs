#!/usr/bin/env node
/**
 * [F-P2 2.8] The package as a user gets it: packed, installed into an empty
 * folder from the tarball, then the command and the library used from there.
 * What `npm publish` would send is what is tried. Run after `npm run build`;
 * the release workflow runs it before publishing.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'cirta-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd = dir) => execFileSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

try {
  console.log('the package as installed');
  run(npm, ['pack', '--pack-destination', dir], root);
  const tarball = readdirSync(dir).find((name) => name.endsWith('.tgz'));
  writeFileSync(join(dir, 'package.json'), '{"name":"try","private":true,"type":"module"}');
  run(npm, ['install', '--no-audit', '--no-fund', join(dir, tarball)]);

  writeFileSync(join(dir, 'note.txt'), 'Bon​jour');
  const help = run(npm, ['exec', '--', 'cirta', '--help']);
  check('the cirta command runs from the installed package', help.includes('cirta inspect'));
  const json = JSON.parse(run(npm, ['exec', '--', 'cirta', 'inspect', '--json', 'note.txt']));
  check('it inspects a file', json[0]?.result?.findings?.some((f) => f.kind === 'invisible-character'), JSON.stringify(json).slice(0, 200));

  writeFileSync(
    join(dir, 'use.mjs'),
    "import { inspectFile, REPORT_SCHEMA } from 'cirta';\nimport { nodeXrayEngine } from 'cirta/node';\nimport schema from 'cirta/schema/report.v1.json' with { type: 'json' };\n" +
      "const r = await inspectFile(new TextEncoder().encode('a\\u200bb'), 'a.txt');\nconsole.log(JSON.stringify({ format: r.format, schema: REPORT_SCHEMA, id: schema.$id, engine: typeof nodeXrayEngine }));\n",
  );
  const used = JSON.parse(run(process.execPath, ['use.mjs']));
  check('the library, cirta/node and the schema import from it', used.format === 'text' && used.schema === 'cirta.report/1' && used.engine === 'function' && Boolean(used.id), JSON.stringify(used));
  // [P0-3] The README's example, as printed, against the installed package: only the file it reads changes.
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const example = /```js\n([\s\S]*?)```/.exec(readme.slice(readme.indexOf('## As a library')))?.[1] ?? '';
  writeFileSync(join(dir, 'cv.html'), '<p>Camille Durand</p><p style="color:#fff">Python Java Kubernetes Docker AWS Terraform React SQL</p>');
  writeFileSync(join(dir, 'example.mjs'), `${example.replaceAll("'cv.pdf'", "'cv.html'")}\nconsole.log(JSON.stringify({ labels: report.findings.map((f) => f.label), text: forModel.text, pasted: pasted.findings.length, kept: cleaned.kept.length }));\n`);
  try {
    const ran = JSON.parse(run(process.execPath, ['example.mjs']));
    check("the README's example runs", ran.labels.includes('Hidden keyword stuffing') && !/Kubernetes/.test(ran.text) && ran.pasted > 0, JSON.stringify(ran));
  } catch (error) {
    check("the README's example runs", false, String(error.stderr ?? error).slice(0, 300));
  }
  writeFileSync(join(dir, 'use.ts'), "import { inspectFile, type InspectResult } from 'cirta';\nconst r: Promise<InspectResult> = inspectFile(new Uint8Array(), 'a');\nvoid r;\n");
  try {
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--skipLibCheck', 'use.ts']);
    check('its types resolve for a TypeScript user', true);
  } catch (error) {
    check('its types resolve for a TypeScript user', false, String(error.stdout ?? error).slice(0, 300));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nthe installed package works');
