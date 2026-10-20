/**
 * [R1] Rules run where a slow one can be stopped.
 *
 * A regular expression cannot be interrupted from the thread that runs it.
 * The patterns known to take exponential time are refused when the rules are
 * read (regex-risk.ts); what is left — a pattern that is merely quadratic on
 * a long document — runs in a worker the interface can terminate. Each rule
 * gets a budget; one that overruns is abandoned, reported as such, and the
 * rules after it run in a fresh worker.
 *
 * An abandoned rule is a finding at the rule's own level, not a note: a check
 * that `--fail-on` a leak must fail when it could not look, rather than pass.
 *
 * The core knows nothing of threads: an interface hands over how to start a
 * worker (worker_threads, a Web Worker) as a channel. The worker's code is
 * rulesWorkerMain below, which an interface either loads as its own script or
 * sends as source — so it refers to nothing outside itself.
 */

import type { Finding } from './types.js';
import { ABANDONED, ruleFinding, ruleFindings, type Rule, type RuleInput, type RulesRunner } from './rules.js';

/** One rule's budget, over every text of a file. A pattern of the usual kind takes milliseconds on megabytes. */
export const RULE_BUDGET_MS = 1000;

/** Both kinds of worker, seen from the side that starts them. */
export interface RulesChannel {
  send(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onError(listener: (error: unknown) => void): void;
  terminate(): void;
}

type FromWorker = { started: number } | { done: number; values: string[][] };

/**
 * The worker: for each rule from `from` on, says it started, then the values
 * it matched in each text, deduplicated and capped as ruleFindings does.
 */
export function rulesWorkerMain(post: (message: unknown) => void, listen: (listener: (message: unknown) => void) => void): void {
  listen((message) => {
    const { inputs, patterns, from } = message as { inputs: string[]; patterns: RegExp[]; from: number };
    for (let r = from; r < patterns.length; r++) {
      post({ started: r });
      const regex = patterns[r]!;
      const values = inputs.map((input) => {
        const text = input.length > 4 * 1024 * 1024 ? input.slice(0, 4 * 1024 * 1024) : input;
        const seen = new Set<string>();
        regex.lastIndex = 0;
        for (const m of text.matchAll(regex)) {
          if (!m[0] || seen.has(m[0])) continue;
          seen.add(m[0]);
          if (seen.size >= 50) break;
        }
        // The finding shows 200 characters; more would only weigh on the message.
        return [...seen].map((value) => value.slice(0, 400));
      });
      post({ done: r, values });
    }
  });
}

/**
 * A runner over workers `spawn` starts. Rules written as words are the core's
 * own expressions and run in place; patterns go to the worker.
 */
export function budgetedRules(spawn: () => RulesChannel, budgetMs = RULE_BUDGET_MS): RulesRunner {
  return async (inputs: RuleInput[], rules: Rule[]): Promise<Finding[]> => {
    const patterns = rules.filter((rule) => rule.pattern !== undefined);
    const results = new Map<Rule, string[][] | 'abandoned'>();
    let from = 0;
    while (from < patterns.length) {
      from = await new Promise<number>((resolve, reject) => {
        const channel = spawn();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const finish = (next: number) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          channel.terminate();
          resolve(next);
        };
        channel.onMessage((raw) => {
          const message = raw as FromWorker;
          if ('started' in message) {
            clearTimeout(timer);
            timer = setTimeout(() => {
              results.set(patterns[message.started]!, 'abandoned');
              finish(message.started + 1);
            }, budgetMs);
          } else {
            results.set(patterns[message.done]!, message.values);
            if (message.done === patterns.length - 1) finish(patterns.length);
          }
        });
        channel.onError((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          channel.terminate();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
        channel.send({ inputs: inputs.map((input) => input.text), patterns: patterns.map((rule) => rule.regex), from });
      });
    }

    // In the order ruleFindings gives, so a report does not depend on where the rules ran.
    const findings: Finding[] = [];
    const abandoned = new Set<Rule>();
    inputs.forEach((input, i) => {
      for (const rule of rules) {
        const result = rule.pattern === undefined ? undefined : results.get(rule);
        if (result === 'abandoned') abandoned.add(rule);
        else if (result) findings.push(...result[i]!.map((value) => ruleFinding(rule, value, input.location)));
        else if (rule.pattern === undefined) findings.push(...ruleFindings(input.text, [rule], input.location));
      }
    });
    for (const rule of abandoned) findings.push({ kind: rule.kind, confidence: rule.level, location: 'rules', label: ABANDONED, value: rule.label });
    return findings;
  };
}
