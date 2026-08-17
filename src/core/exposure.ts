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
 *   - Anthropic states that detection needs roughly 100 tokens or more, and
 *     works less well on short, fact-dense or code-like passages where there
 *     are few alternative phrasings to bias.
 *   - Kirchenbauer et al., ICLR 2024, found that after sustained human
 *     paraphrasing a watermark remained detectable at a 1e-5 false-positive
 *     rate once roughly 800 tokens had been observed.
 *
 * As of 11 August 2026 this stopped being hypothetical. Anthropic turned on
 * text watermarking across Claude, using a variant of DeepMind's SynthID-Text,
 * under the EU AI Act's transparency code. Files get signed C2PA manifests,
 * which this tool does read; the text mark it does not, because the detection
 * API Anthropic has announced is not published yet and the keys are theirs.
 *
 * That deployment makes one caveat load-bearing rather than academic. The mark
 * is applied to what the model *emits*, so it records that text passed through
 * Claude — not that Claude composed it. Paste your own paragraph in, ask for it
 * to be reformatted, and the reply carries the mark. Any future detector,
 * Anthropic's included, answers "this came out of the model", which is a
 * narrower claim than "a machine wrote this" and much narrower than "this
 * person did not write it".
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

export interface Exposure extends TokenEstimate {
  band: ExposureBand;
}

/**
 * Thresholds in tokens. Deliberately coarse: the precise cut-off depends on the
 * scheme, the key and the false-positive rate the verifier chooses, none of
 * which are knowable from here.
 *
 * The lower bound is set at twice the ~100 tokens Anthropic gives as the floor
 * for a meaningful result. Sitting exactly on a vendor's stated minimum would
 * read as "above this you are detectable, below it you are safe", which is both
 * false and an invitation to game the number.
 */
const SHORT_LIMIT = 200;
const AMPLE_LIMIT = 800;

export function exposure(text: string): Exposure {
  const estimate = estimateTokens(text);
  // Judge on the low bound, so the band is not overstated by a generous estimate.
  const band: ExposureBand =
    estimate.low < SHORT_LIMIT ? 'too-short' : estimate.low < AMPLE_LIMIT ? 'uncertain' : 'ample';
  return { ...estimate, band };
}

