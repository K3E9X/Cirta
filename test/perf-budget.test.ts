import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * [F-P2 2.8] The budget itself: every format it names has a time to inspect,
 * a time to clean and a peak memory, and CI runs the measurement on every push.
 * The measurement is scripts/perf.mjs (50 MB per format), too long for npm test.
 */

describe('[F-P2 2.8] the performance budget', () => {
  const budget = JSON.parse(readFileSync('perf-budget.json', 'utf8'));

  it('gives every format a time to inspect, a time to clean and a peak memory, for 50 MB', () => {
    expect(budget.sizeMB).toBe(50);
    expect(Object.keys(budget.formats).sort()).toEqual(['docx', 'epub', 'html', 'jpeg', 'odt', 'pdf', 'png', 'text', 'zip']);
    for (const [format, limits] of Object.entries<Record<string, number>>(budget.formats)) {
      for (const key of ['inspectMs', 'redactMs', 'rssMB']) expect(limits[key], `${format} ${key}`).toBeGreaterThan(0);
    }
  });

  it('is measured in CI, after the build, on every push', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const job = ci.slice(ci.indexOf('\n  perf:'));
    expect(job).toMatch(/runs-on: ubuntu-latest/);
    expect(job.indexOf('npm run build')).toBeGreaterThan(0);
    expect(job.indexOf('node scripts/perf.mjs')).toBeGreaterThan(job.indexOf('npm run build'));
    // Every format the script can build is in the budget, and the reverse.
    const script = readFileSync('scripts/perf.mjs', 'utf8');
    const built = [...script.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]).sort();
    expect(built).toEqual(Object.keys(budget.formats).sort());
  });
});
