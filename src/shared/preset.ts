/**
 * [P1-3] What a link to the page asks it to open on, read from the fragment:
 * `#tab=text`, `#lang=en`, `#format=pdf` or `#format=docx,odt`. The browser
 * never sends the fragment, so the server never learns what the visitor came
 * for. Anything unknown is ignored rather than refused: a stale link still
 * opens the page.
 */

export interface Preset {
  tab?: 'files' | 'text';
  lang?: 'fr' | 'en';
  /** Extensions, with their dot, each one the file picker already accepts. */
  accept?: string[];
}

export function parsePreset(hash: string, accepted: readonly string[]): Preset {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: Preset = {};
  const tab = params.get('tab');
  if (tab === 'files' || tab === 'text') out.tab = tab;
  const lang = params.get('lang');
  if (lang === 'fr' || lang === 'en') out.lang = lang;
  const formats = (params.get('format') ?? '')
    .split(',')
    .map((format) => `.${format.trim().toLowerCase()}`)
    .filter((extension) => extension.length > 1 && accepted.includes(extension));
  if (formats.length) out.accept = [...new Set(formats)];
  return out;
}
