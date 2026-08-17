/**
 * How much a local report can conclude about a statistical watermark.
 *
 * This module deliberately does not detect anything. Reading a keyed watermark
 * requires the vendor's secret key, so no local verdict exists and none is
 * offered here.
 *
 * What it does instead is report the one variable that actually governs whether
 * such a mark is readable at all: length. Detection is a hypothesis test over
 * token choices, and its statistical power grows with the number of tokens
 * observed. That makes "we found nothing" mean very different things at 80
 * tokens and at 8000, and a report that does not say which one it is invites
 * the reader to over-conclude.
 *
 * The bands come from published measurements:
 *   - Kirchenbauer et al., ICLR 2024, found that after sustained human
 *     paraphrasing a watermark remained detectable at a 1e-5 false-positive
 *     rate once roughly 800 tokens had been observed.
 *
 * Anthropic states the direction but no number: detection "doesn't work well on
 * small samples", and confidence grows with length. A "~100 tokens" figure
 * circulates in the press coverage; it is not in Anthropic's own text, so it is
 * not used here and is not attributed to them. Where a threshold is needed this
 * module says so is its own choice.
 *
 * In August 2026 this stopped being hypothetical. Anthropic's own explanation
 * ("How Claude's text watermark works") states that future Claude models will
 * carry a watermark — a version of DeepMind's SynthID-Text — to comply with the
 * EU Code of Practice on Transparency of AI-Generated Content, which took
 * effect on 2 August 2026. Models released before that date are covered by a
 * transition period and are being rolled out over the following months, so on
 * any given file "does it carry one" depends on which model wrote it and when.
 *
 * Three points from that page change what this tool should say, and one of them
 * is about this tool's own subject matter:
 *
 *   - "Nothing is added to the text and there are no hidden characters." The
 *     watermark is not invisible Unicode. Everything the character-level scan
 *     finds is somebody else's doing, and removing all of it leaves the
 *     watermark exactly as it was. The two are unrelated mechanisms that the
 *     press coverage merged into one word, "invisible".
 *   - The mark carries no identifying information and cannot be traced to a
 *     person, an organisation or a conversation.
 *   - It answers, at best, "how likely is it that Claude was involved in
 *     writing this" — not whether a human wrote it, and not whether some other
 *     model did, since another vendor's watermark uses a different key.
 *
 * The caveat worth stating precisely, because it is easy to get backwards:
 * light editing gives the watermark almost nothing to attach to, since nearly
 * all the words remain the person's. What a detector cannot do is separate
 * "Claude wrote this" from "Claude heavily edited this". So a future positive
 * result is a claim about involvement, not about authorship.
 *
 * The purpose is calibration, not targeting. This says what a silent report is
 * worth; it does not tell anyone what length to aim for.
 */

/**
 * Token counts are model-specific and no tokenizer ships with this package, so
 * the estimate is derived from script-aware character density and reported as a
 * range rather than a number pretending to precision.
 */
export interface TokenEstimate {
  characters: number;
  words: number;
  /** Lower and upper bounds of the estimate. */
  low: number;
  high: number;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

export function estimateTokens(text: string): TokenEstimate {
  const characters = [...text].length;
  const words = text.split(/\s+/).filter(Boolean).length;

  // CJK packs far more information per character, so the ratio differs sharply.
  // Latin scripts land near 3.5-4.5 characters per token across tokenizers.
  const dense = CJK.test(text);
  const low = Math.round(characters / (dense ? 2 : 4.5));
  const high = Math.round(characters / (dense ? 1 : 3.2));

  return { characters, words, low, high };
}

export type ExposureBand = 'too-short' | 'uncertain' | 'ample';

/**
 * Where, in *this* text, a watermark could live at all.
 *
 * Length is not the only thing that governs detectability, and Anthropic's own
 * explanation is unusually specific about the other one. The mark rides on
 * choices between words that are equally good — "overcast" or "grey" — and it
 * is not applied where only one answer is correct. Their examples: after
 * "Isaac Newton's most famous work was called Principia…" the next word has one
 * right answer, and "2 + 2 =" has one right answer. Code is the systematic case:
 * "code—which in very many cases has to be exact—has generally less
 * watermarking", though comments inside it are ordinary prose and can carry it.
 *
 * Factual density cannot be measured here without a model, and pretending
 * otherwise would be exactly the kind of invented number this tool avoids. Code
 * can be: a file that is mostly syntax has little room for the mark, and the
 * share of it that is comments says where what room there is would be. So that
 * is the one this reports, and it reports it as two counts rather than as an
 * adjusted verdict.
 */
export interface FreeChoice {
  /** The text reads as source code rather than prose. */
  code: boolean;
  /** Non-blank lines that are wholly a comment, when `code`. */
  commentLines: number;
  nonBlankLines: number;
}

export interface Exposure extends TokenEstimate {
  band: ExposureBand;
  freeChoice: FreeChoice;
}

/**
 * Line comment openers across the languages this tool accepts as source, plus
 * the block forms. Deliberately not a parser: a line that *starts* with one of
 * these is a comment for counting purposes, and a `//` inside a string literal
 * is miscounted. The number is an indication of proportion, not a compiler.
 */
const COMMENT_LINE = /^\s*(?:\/\/|#|--|;|%|\*|\/\*|<!--|"""|''')/;

/**
 * Lines that only a programming language produces. Prose does not end in a
 * brace or a semicolon, and does not open with an import or a declaration.
 */
const CODE_LINE =
  /[;{}]\s*$|^\s*(?:import|from|export|const|let|var|def|class|function|fn|func|public|private|package|use|#include|if|for|while|return|end)\b/;

function freeChoice(text: string): FreeChoice {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { code: false, commentLines: 0, nonBlankLines: 0 };

  const commentLines = lines.filter((line) => COMMENT_LINE.test(line)).length;
  const codeLines = lines.filter((line) => CODE_LINE.test(line)).length;

  // A quarter of the lines carrying syntax no prose produces. Set high enough
  // that a memo with a bulleted list or a quoted command does not trip it —
  // calling someone's letter "source code" would make the whole card wrong.
  const code = codeLines / lines.length > 0.25;

  return { code, commentLines, nonBlankLines: lines.length };
}

/**
 * Thresholds in tokens. Deliberately coarse: the precise cut-off depends on the
 * scheme, the key and the false-positive rate the verifier chooses, none of
 * which are knowable from here.
 *
 * These are this module's own choices, not a vendor's published figures, and
 * they are set well away from any number a reader could aim at. A threshold
 * presented as authoritative would read as "above this you are detectable,
 * below it you are safe", which is false in both directions.
 */
const SHORT_LIMIT = 200;
const AMPLE_LIMIT = 800;

export function exposure(text: string): Exposure {
  const estimate = estimateTokens(text);
  // Judge on the low bound, so the band is not overstated by a generous estimate.
  const band: ExposureBand =
    estimate.low < SHORT_LIMIT ? 'too-short' : estimate.low < AMPLE_LIMIT ? 'uncertain' : 'ample';
  return { ...estimate, band, freeChoice: freeChoice(text) };
}

