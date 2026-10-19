import { describe, expect, it } from 'vitest';
import { CLEAN_KEYS, offered, plan } from '../src/shared/clean-plan.js';
import type { Finding } from '../src/core/types.js';

const f = (label: string, extra: Partial<Finding> = {}): Finding => ({ kind: 'identity', confidence: 'confirmed', location: 'x', label, value: 'v', ...extra });

describe('[F-2.7] which cleaning options a file is offered', () => {
  it('offers an option only for a format that takes it and a file it would change', () => {
    const deck = [f('Speaker notes text'), f('Speaker notes text'), f('Hidden slides'), f('Comment text')];
    expect(offered('pptx', deck)).toEqual([
      { key: 'removeComments', count: 1 },
      { key: 'removeNotes', count: 2 },
      { key: 'removeHiddenSlides', count: 1 },
    ]);
    // The same findings in a PDF change nothing an option there removes.
    expect(offered('pdf', deck)).toEqual([]);
  });

  it('knows every option the cleaner takes, PDF and notebook ones included', () => {
    expect(CLEAN_KEYS).toEqual([
      'removeHidden', 'acceptChanges', 'removeComments', 'removeNotes', 'removeHiddenSlides', 'removeHiddenSheets',
      'stripActive', 'stripRemote', 'stripTracking', 'removeAttachments', 'flattenAnnotations', 'burnRedactions', 'clearOutputs', 'reencodeImages',
    ]);
    const pdf = [f('Embedded file', { kind: 'active-content' }), f('Annotation authors'), f('Text covered by a shape'), f('Tracking parameters in a link')];
    expect(offered('pdf', pdf).map((o) => o.key)).toEqual(['stripActive', 'stripTracking', 'removeAttachments', 'flattenAnnotations', 'burnRedactions']);
    expect(offered('ipynb', [f('Local path in an output', { location: 'cells[1].outputs[0]' })]).map((o) => o.key)).toEqual(['clearOutputs']);
  });

  it('plans what a download will do: the chosen options among those offered', () => {
    const findings = [f('Comment text'), f('Speaker notes text')];
    expect(plan('pptx', findings, { removeNotes: true, burnRedactions: true, removeComments: false })).toEqual([{ key: 'removeNotes', count: 1 }]);
    expect(plan('pptx', findings, {})).toEqual([]);
  });
});
