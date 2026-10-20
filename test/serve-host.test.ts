import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve, type Service } from '../src/cli/serve.js';

/*
 * [R5] `ciirta serve` on the loopback answered any Host. A web page the user
 * opens can point a name it controls at 127.0.0.1 (DNS rebinding) and then
 * read the API from its own origin. On the loopback only the loopback's own
 * names are answered — 127.0.0.1, localhost, [::1], with any port — plus the
 * --host given and each --allowed-host; anything else gets 421.
 */

const get = (port: number, host: string | undefined, path = '/health') =>
  new Promise<number>((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (host !== undefined) headers.host = host;
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers, setHost: host === undefined ? false : true }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });

describe('[R5] the HTTP API checks the Host it is asked for', () => {
  let loopback: Service;
  let allowed: Service;
  let open: Service;
  const common = { http: 0, maxBytes: 1024 * 1024, inspect: {}, clean: {}, lang: 'en' as const, version: 'test', log: () => {}, allowClean: false };

  beforeAll(async () => {
    loopback = await serve({ ...common, host: '127.0.0.1' });
    allowed = await serve({ ...common, host: '127.0.0.1', allowedHosts: ['ciirta.internal'] });
    open = await serve({ ...common, host: '0.0.0.0' });
  });
  afterAll(async () => {
    await Promise.all([loopback.close(), allowed.close(), open.close()]);
  });

  it.each(['127.0.0.1', 'localhost', '[::1]', 'LOCALHOST'])('answers %s, with or without a port', async (name) => {
    const port = loopback.http!.port;
    expect(await get(port, name)).toBe(200);
    expect(await get(port, `${name}:${port}`)).toBe(200);
  });

  it.each(['evil.example', 'evil.example:80', '127.0.0.1.evil.example', 'localhost.evil.example', '[::1].evil', '127.0.0.2'])('refuses %s with 421', async (name) => {
    expect(await get(loopback.http!.port, name)).toBe(421);
  });

  it('refuses every route, not only the health check', async () => {
    expect(await get(loopback.http!.port, 'evil.example', '/inspect')).toBe(421);
  });

  it('answers a name given with --allowed-host, and still refuses the others', async () => {
    const port = allowed.http!.port;
    expect(await get(port, 'ciirta.internal')).toBe(200);
    expect(await get(port, `ciirta.internal:${port}`)).toBe(200);
    expect(await get(port, 'localhost')).toBe(200);
    expect(await get(port, 'evil.example')).toBe(421);
  });

  it('listening beyond the loopback, it answers the names it is reached by', async () => {
    expect(await get(open.http!.port, 'ciirta.lan')).toBe(200);
  });
});
