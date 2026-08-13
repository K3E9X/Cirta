/**
 * The Cirta mark, transcribed for a terminal.
 *
 * A terminal cannot render SVG, so this is a character-cell version of
 * `assets/logo.svg`: the same C held inside a rounded square. The SVG stays the
 * source of truth for the shape — if that changes, this should follow.
 *
 * Two transcriptions exist because box-drawing characters are not safe
 * everywhere. A legacy Windows console on a non-UTF-8 code page renders them as
 * mojibake, and a banner that arrives as garbage is worse than a plain one.
 */

const UNICODE = ['╭───────╮', '│  ╭──  │', '│  ╰──  │', '╰───────╯'];

const ASCII = ['+-------+', '|  .--  |', "|  '--  |", '+-------+'];

export interface BannerOptions {
  /** Box-drawing characters are only used where the terminal can show them. */
  unicode: boolean;
  /** Applied to the mark itself; the caller decides whether colour is wanted. */
  paint: (text: string) => string;
  /** Lines printed beside the mark, top-aligned. */
  lines: string[];
}

/**
 * Render the mark with text beside it.
 *
 * The mark occupies a fixed block, so the text column starts at the same offset
 * whichever transcription is in use and the layout does not shift between
 * platforms.
 */
export function banner({ unicode, paint, lines }: BannerOptions): string {
  const art = unicode ? UNICODE : ASCII;
  const height = Math.max(art.length, lines.length);
  const width = art[0]?.length ?? 0;

  const rows: string[] = [];
  for (let i = 0; i < height; i++) {
    const mark = art[i] ?? ' '.repeat(width);
    const text = lines[i] ?? '';
    // Trailing spaces on a blank text row would be invisible noise in a copy.
    rows.push(`  ${paint(mark)}${text ? `   ${text}` : ''}`.trimEnd());
  }
  return rows.join('\n');
}
