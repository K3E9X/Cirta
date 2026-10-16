import { describe, expect, it } from 'vitest';
import { inspectClipboardHtml } from '../src/core/clipboard.js';
import { translateLabel, translateLocation } from '../src/shared/french.js';

/*
 * Copying from a web page puts an HTML version on the clipboard next to the
 * text. A rich mail editor keeps part of it; these tests cover reading what
 * it carried. The markup below is made up — it imitates no real application,
 * and the module names none.
 */

const RICH =
  '<div class="chat-message prose whitespace-pre-wrap" data-message-id="a1f3" data-render-count="2">' +
  '<p style="font-family: &quot;Fictive Sans&quot;, ui-sans-serif; color: rgb(20, 20, 19)">Bonjour Marie,</p>' +
  '<p style="margin: 0">La facture <strong>n°118</strong> reste due.</p></div>';

const byLabel = (html: string) => new Map(inspectClipboardHtml(html).map((f) => [f.label, f]));

describe('what a paste carried besides its text', () => {
  it('lists the class names and page attributes the source page used', () => {
    const found = byLabel(RICH);
    expect(found.get('Class names carried by the copied text')?.value).toBe(
      '3 — chat-message, prose, whitespace-pre-wrap',
    );
    expect(found.get('Page attributes carried by the copied text')?.value).toBe(
      'data-message-id, data-render-count',
    );
  });

  it('reads a font name quoted with &quot;, which is how browsers write it', () => {
    // The semicolon closing `&quot;` also closes a CSS declaration; matching in
    // the raw HTML reported the font as "&quot".
    expect(byLabel(RICH).get('Fonts carried by the copied text')?.value).toBe('Fictive Sans, ui-sans-serif');
  });

  it('counts inline styles, and claims nothing about them', () => {
    const styles = byLabel(RICH).get('Inline styles carried by the copied text');
    expect(styles?.value).toBe('2');
    expect(styles?.confidence).toBe('informational');
  });

  it('reports the address of the page when the clipboard records it', () => {
    const found = byLabel('Version:0.9\nSourceURL:https://exemple.app/chat/123\n<p>x</p>');
    expect(found.get('Address of the page the text was copied from')?.value).toBe('https://exemple.app/chat/123');
  });

  it('reports a generator however its attributes are ordered', () => {
    for (const meta of [
      '<meta name="generator" content="Fictive Editor 4">',
      '<meta content="Fictive Editor 4" name="generator">',
    ]) {
      expect(byLabel(meta).get('Software named in the copied HTML')?.value).toBe('Fictive Editor 4');
    }
  });

  it('says nothing about bare markup, which carries nothing of its source', () => {
    expect(inspectClipboardHtml('<p>Bonjour <strong>Marie</strong></p>')).toEqual([]);
    expect(inspectClipboardHtml('   ')).toEqual([]);
  });

  it('reads in French', () => {
    expect(translateLabel('Fonts carried by the copied text', 'fr')).toBe('Polices emportées avec le texte');
    expect(translateLocation('clipboard (HTML)', 'fr')).toBe('presse-papiers (HTML)');
  });
});

/*
 * A clipboard can hold a whole copied page, and this runs on paste, in the
 * page's own thread. No pattern may be worse than linear.
 */
describe('cost on hostile clipboard HTML', () => {
  const cost = (html: string): number => {
    const started = Date.now();
    inspectClipboardHtml(html);
    return Date.now() - started;
  };

  it.each([
    ['an unclosed class attribute', '<div class="' + 'a '.repeat(200_000)],
    ['an unclosed style attribute', '<p style="' + 'font-family:x;'.repeat(100_000)],
    ['thousands of data attributes', '<p ' + ' data-x=1'.repeat(50_000) + '>'],
    ['an unterminated meta tag', '<meta name="generator"' + ' x'.repeat(200_000)],
    ['a copied page several megabytes long', RICH.repeat(20_000)],
  ])('stays fast on %s', (_name, html) => {
    expect(cost(html)).toBeLessThan(1_000);
  });
});
