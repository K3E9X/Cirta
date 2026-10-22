import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { smokeServe } from '../scripts/smoke-serve.mjs';
import { serve, type Service } from '../src/cli/serve.js';

/*
 * [F-P3 2.5] The Docker image: what it runs and as whom, and the smoke test
 * CI runs against the container — itself checked here against the service
 * started in-process.
 */

describe('[F-P3 2.5] the Docker image', () => {
  const dockerfile = readFileSync('Dockerfile', 'utf8');

  it('runs ciirta serve as an unprivileged user, inspection only, on every interface of its container', () => {
    expect(dockerfile).toMatch(/^FROM node:22[.\d]*-alpine AS build$/m);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^EXPOSE 1344 8080$/m);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["ciirta"\]$/m);
    expect(dockerfile).toMatch(/^CMD \["serve", "--host", "0\.0\.0\.0"\]$/m);
    // The comments say how to change it; the instructions do not.
    expect(dockerfile.replace(/^#.*$/gm, '')).not.toMatch(/--allow-clean|--block-on/);
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    // What goes in is the npm package, as a user installs it; nothing of the build stage's dev dependencies.
    expect(dockerfile).toMatch(/npm pack/);
    expect(dockerfile).toMatch(/npm install --global --omit=dev/);
    const ignored = readFileSync('.dockerignore', 'utf8');
    for (const path of ['node_modules', '.git', 'dist-web', 'build', 'test']) expect(ignored).toMatch(new RegExp(`^${path.replace('.', '\\.')}$`, 'm'));
  });

  it('is built and smoke-tested in CI', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = ci.slice(ci.indexOf('\n  docker:'));
    expect(job).toMatch(/docker build -t ciirta:ci \./);
    expect(job).toMatch(/docker run -d --name ciirta --read-only --cap-drop ALL --security-opt no-new-privileges/);
    expect(job).toMatch(/node scripts\/smoke-serve\.mjs/);
  });

  describe('the smoke test', () => {
    let service: Service;
    beforeAll(async () => {
      service = await serve({ host: '127.0.0.1', http: 0, icap: 0, maxBytes: 1 << 20, allowClean: false, inspect: {}, clean: {}, lang: 'en', version: 'test', log: () => {} });
    });
    afterAll(() => service.close());

    it('passes against a service that works', async () => {
      expect(await smokeServe({ http: `http://127.0.0.1:${service.http!.port}`, icap: { host: '127.0.0.1', port: service.icap!.port } })).toEqual([]);
    });

    it('fails against nothing, and says what', async () => {
      const problems = await smokeServe({ http: 'http://127.0.0.1:9', icap: { host: '127.0.0.1', port: 9 } });
      expect(problems.length).toBeGreaterThan(0);
    });
  });
});
