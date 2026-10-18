import { describe, expect, it } from 'vitest';
import { inspectFile, type Finding } from '../src/core/index.js';
import { workbook } from './helpers/active-xlsx.js';

/*
 * [F-2.1] A workbook carries more than its visible cells: connections to
 * databases with their servers and sometimes their passwords, queries that
 * refresh from the network, Power Query code, rows and columns hidden from
 * view, figures typed in white on white.
 */

const get = (findings: Finding[], label: string) => findings.filter((f) => f.label === label);

describe('[F-2.1] what a workbook connects to and keeps out of sight', () => {
  it('reports each data connection with its server, and a password stored in clear', async () => {
    const { findings } = await inspectFile(workbook(), 'budget.xlsx');
    const connections = get(findings, 'Data connection');
    expect(connections.map((f) => f.value)).toEqual(
      expect.arrayContaining([expect.stringContaining('sql-prod.interne.exemple'), expect.stringContaining('https://api.exemple/tarifs.xml')]),
    );
    expect(connections.every((f) => !f.value.includes('Hiver2026!'))).toBe(true);
    expect(get(findings, 'Password stored in a connection')[0]).toMatchObject({ confidence: 'confirmed', value: 'Ventes — Password=•••••••• (user compta)' });
  });

  it('reports query tables and the sources Power Query reads', async () => {
    const { findings } = await inspectFile(workbook(), 'budget.xlsx');
    expect(get(findings, 'Query table')[0]?.value).toBe('Ventes');
    const sources = get(findings, 'Power Query source').map((f) => f.value);
    expect(sources).toEqual(expect.arrayContaining(['Sql.Database("sql-prod.interne.exemple", "Ventes")', 'Web.Contents("https://api.exemple/tarifs")']));
  });

  it('reports hidden rows and columns, and cells in white type with what they say', async () => {
    const { findings } = await inspectFile(workbook(), 'budget.xlsx');
    expect(get(findings, 'Hidden rows and columns')[0]?.value).toBe('Budget: 2 rows (2, 5), 2 columns (C–D)');
    expect(get(findings, 'Cells in white type')[0]?.value).toBe('Budget!B1: Marge réelle 31 %');
  });
});
