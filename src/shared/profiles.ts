/**
 * [F-P2 2.3] Profiles: the cleaning options and the --fail-on threshold, set
 * in one word. An option given explicitly is added to the profile's; a
 * --fail-on given explicitly wins over the profile's.
 *
 *   minimal   What the file says about its making, nothing else: the
 *             document reads exactly as before. Fails on a confirmed finding.
 *   balanced  Also what the file does or fetches — scripts, macros, remote
 *             resources, tracking parameters — none of which a reader sees.
 *             Fails on a confirmed finding.
 *   strict    Everything a clean can take out, content included: hidden
 *             text, tracked changes, comments, notes, hidden slides and
 *             sheets, attachments, annotations, covered text burnt in,
 *             notebook outputs, pictures rebuilt from their pixels. Fails on
 *             a probable finding. Needs the renderer and the image codec; a
 *             file that would need one that is missing is refused.
 */

import type { CleanChoices, CleanKey } from './clean-plan.js';

export type ProfileName = 'minimal' | 'balanced' | 'strict';
export type FailLevel = 'confirmed' | 'probable' | 'informational';

export interface Profile {
  options: CleanChoices;
  failOn: FailLevel;
}

const on = (...keys: CleanKey[]): CleanChoices => Object.fromEntries(keys.map((key) => [key, true]));

export const PROFILES: Record<ProfileName, Profile> = {
  minimal: { options: {}, failOn: 'confirmed' },
  balanced: { options: on('stripActive', 'stripRemote', 'stripTracking'), failOn: 'confirmed' },
  strict: {
    options: on(
      'removeHidden', 'acceptChanges', 'removeComments', 'removeNotes', 'removeHiddenSlides', 'removeHiddenSheets',
      'stripActive', 'stripRemote', 'stripTracking', 'removeAttachments', 'flattenAnnotations', 'burnRedactions',
      'clearOutputs', 'reencodeImages',
    ),
    failOn: 'probable',
  },
};

export const isProfile = (name: string): name is ProfileName => Object.hasOwn(PROFILES, name);
