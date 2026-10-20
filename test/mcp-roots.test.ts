import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * [R4] `cirta mcp` read and wrote any path an agent named: a prompt injected
 * into a document could have it clean ~/.ssh/id_rsa into a copy beside it, or
 * write over a file anywhere. Now it answers only inside its roots — the
 * folders given with --root, the current one by default — after following
 * symbolic links.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function session(args: string[], calls: Array<Record<string, unknown>>, cwd = ROOT): Promise<Map<number, Record<string, any>>> {
  const child = spawn(process.execPath, [join(ROOT, 'node_modules/vite-node/vite-node.mjs'), '--root', ROOT, join(ROOT, 'src/cli/index.ts'), 'mcp', ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`);
  calls.forEach((call, i) => child.stdin.write(`${JSON.stringify(call.method ? { jsonrpc: '2.0', id: i + 1, ...call } : { jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: call })}\n`));
  child.stdin.end();
  await new Promise((done) => child.on('close', done));
  return new Map(out.split('\n').filter(Boolean).map((line) => JSON.parse(line)).map((r) => [r.id, r]));
}

function layout() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'cirta-r4-')));
  const inside = join(base, 'dossier');
  const outside = join(base, 'ailleurs');
  mkdirSync(inside);
  mkdirSync(outside);
  writeFileSync(join(inside, 'note.txt'), 'Bon​jour');
  writeFileSync(join(outside, 'secret.txt'), 'clé privée');
  symlinkSync(join(outside, 'secret.txt'), join(inside, 'lien.txt'));
  symlinkSync(outside, join(inside, 'sortie'));
  return { base, inside, outside };
}

const refused = (reply: Record<string, any> | undefined) => {
  expect(reply?.error?.code).toBe(-32602);
  expect(reply?.error?.message).toMatch(/outside the allowed roots/);
};

describe('[R4] the MCP server stays inside its roots', () => {
  it('reads and cleans inside --root, and refuses a path outside, through .., or through a link', async () => {
    const { inside, outside } = layout();
    const replies = await session(['--root', inside], [
      { name: 'inspect_file', arguments: { path: join(inside, 'note.txt') } },
      { name: 'inspect_file', arguments: { path: join(outside, 'secret.txt') } },
      { name: 'inspect_file', arguments: { path: join(inside, '..', 'ailleurs', 'secret.txt') } },
      { name: 'inspect_file', arguments: { path: join(inside, 'lien.txt') } },
      { name: 'sanitize_for_llm', arguments: { path: join(inside, 'sortie', 'secret.txt') } },
      { name: 'redact_file', arguments: { path: join(inside, 'note.txt'), output: join(outside, 'copie.txt') } },
      { name: 'redact_file', arguments: { path: join(inside, 'note.txt'), output: join(inside, 'sortie', 'copie.txt') } },
      { name: 'redact_file', arguments: { path: join(inside, 'note.txt'), output: join(inside, 'propre.txt') } },
    ]);
    expect(replies.get(1)!.result.isError).toBe(false);
    for (const id of [2, 3, 4, 5, 6, 7]) refused(replies.get(id));
    expect(existsSync(join(outside, 'copie.txt'))).toBe(false);
    expect(replies.get(8)!.result.structuredContent.output).toBe(join(inside, 'propre.txt'));
    expect(existsSync(join(inside, 'propre.txt'))).toBe(true);
  }, 60_000);

  it('takes the current folder when no root is given', async () => {
    const { inside, outside } = layout();
    const replies = await session([], [
      { name: 'inspect_file', arguments: { path: 'note.txt' } },
      { name: 'inspect_file', arguments: { path: join(outside, 'secret.txt') } },
    ], inside);
    expect(replies.get(1)!.result.isError).toBe(false);
    refused(replies.get(2));
  }, 60_000);

  it('accepts several roots', async () => {
    const { inside, outside } = layout();
    const replies = await session(['--root', inside, '--root', outside], [{ name: 'inspect_file', arguments: { path: join(outside, 'secret.txt') } }]);
    expect(replies.get(1)!.result.isError).toBe(false);
  }, 60_000);

  it('documents output in the schema, and its limit', async () => {
    const { inside } = layout();
    const replies = await session(['--root', inside], [{ method: 'tools/list' }]);
    const redact = replies.get(1)!.result.tools.find((t: { name: string }) => t.name === 'redact_file');
    expect(redact.inputSchema.properties.output.description).toMatch(/inside the server's roots/);
    expect(replies.get(0)!.result.instructions).toMatch(/roots/);
  }, 60_000);
});
