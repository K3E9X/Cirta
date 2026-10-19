#!/usr/bin/env node
/**
 * [F-P2 2.6] A SARIF file as GitHub annotations: one workflow command per
 * result (::error, ::warning, ::notice), which GitHub shows on the pull
 * request and the run whatever the repository's plan — code scanning, which
 * reads the SARIF itself, needs Advanced Security on a private repository.
 * A table of the results goes to the run's summary page too.
 *
 *   node scripts/sarif-annotations.mjs cirta.sarif
 *
 * The messages come from the documents inspected, so they are escaped as
 * workflow commands require: a value cannot end the command or start another.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

const COMMAND = { error: 'error', warning: 'warning', note: 'notice', none: 'notice' };

/** Workflow-command escaping: the data part, then a property's value. */
export const escapeData = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const escapeProperty = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function annotations(sarif) {
  const lines = [];
  for (const run of sarif.runs ?? []) {
    const names = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule.name ?? rule.id]));
    for (const result of run.results ?? []) {
      const file = result.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
      const command = COMMAND[result.level ?? 'warning'] ?? 'warning';
      const properties = [file ? `file=${escapeProperty(file)}` : undefined, `title=${escapeProperty(`Cirta: ${names.get(result.ruleId) ?? result.ruleId}`)}`].filter(Boolean).join(',');
      lines.push(`::${command} ${properties}::${escapeData(result.message?.text ?? '')}`);
    }
  }
  return lines;
}

/** The same results as a Markdown table for the run's summary page. */
export function summary(sarif) {
  const rows = [];
  for (const run of sarif.runs ?? []) {
    const names = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule.name ?? rule.id]));
    for (const result of run.results ?? []) {
      const cell = (text) => `\`${String(text).replace(/[\r\n]+/g, ' ').replace(/`/g, 'ʼ').replace(/\|/g, '\\|')}\``;
      rows.push(`| ${result.level ?? 'warning'} | ${cell(result.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? '')} | ${cell(names.get(result.ruleId) ?? result.ruleId)} | ${cell(result.message?.text ?? '')} |`);
    }
  }
  if (!rows.length) return '### Cirta\n\nNothing found in the files this change touches.\n';
  return ['### Cirta', '', `${rows.length} finding${rows.length > 1 ? 's' : ''} in the files this change touches.`, '', '| Level | File | Finding | Detail |', '|---|---|---|---|', ...rows, ''].join('\n');
}

if (process.argv[2]) {
  const sarif = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  for (const line of annotations(sarif)) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(sarif));
}
