/**
 * Text read from a file, made safe to print in a terminal.
 *
 * A terminal does not only display what it is sent: ESC starts a command. A
 * document's /Author holding `ESC ] 0 ;` retitled the window, `ESC [ 2K` and a
 * carriage return erased the line before it — a confirmed finding could be
 * printed and wiped in the same breath — OSC 8 made links, and OSC 52 writes
 * the clipboard where a terminal allows it (CWE-150). Bidirectional controls
 * do the same to the eye: U+202E turns the rest of a line around.
 *
 * Every value that came out of a file passes through here before it is
 * printed. Controls are shown, not removed, so the report still says what the
 * file contains: ESC prints as ␛ and BEL as ␇ (Unicode's control pictures), a
 * C1 control as \x9B, a bidi control as ⟨U+202E⟩. A tab is a space and line
 * breaks flatten, since each value sits on one line of the report.
 */

const BIDI = /[‪-‮⁦-⁩‎‏؜]/g;
// C0 except tab and line breaks, DEL, and the C1 block.
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;

const picture = (char: string): string => {
  const code = char.charCodeAt(0);
  if (code < 0x20) return String.fromCharCode(0x2400 + code);
  if (code === 0x7f) return '␡';
  return `\\x${code.toString(16).toUpperCase()}`;
};

export function terminalSafe(text: string): string {
  return text
    .replace(/\r\n|[\r\n]/g, ' ')
    .replace(/\t/g, ' ')
    .replace(CONTROL, picture)
    .replace(BIDI, (char) => `⟨U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟩`);
}

/**
 * JSON for a terminal. JSON.stringify already escapes C0 controls; it leaves
 * DEL, the C1 block and the bidi controls as they are, which a terminal can
 * still act on when the report is printed rather than piped. Escaping them is
 * the same JSON, read back to the same strings. An indent of 0 gives one line,
 * as a stream of reports (ciirta watch --json) needs.
 */
export function terminalJson(value: unknown, indent = 2): string {
  return JSON.stringify(value, null, indent).replace(
    /[\x7f-\x9f‪-‮⁦-⁩‎‏؜]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
