/**
 * What makes a passage *look* machine-written.
 *
 * This is the third and last thing a local tool can say about AI text, and it
 * is the one most likely to be abused, so its shape matters as much as its
 * content. It measures; it does not conclude.
 *
 * The reason is not modesty. OpenAI withdrew its own AI-text classifier in July
 * 2023 at 26% true positives and 9% false positives. Liang et al. (Stanford,
 * 2023) then showed that the detectors still on the market flagged 61% of TOEFL
 * essays by non-native English writers as machine-written — a false positive
 * that lands, systematically, on the people least able to argue with it. Any
 * verdict built on these signals inherits that.
 *
 * What survives honest scrutiny is the individual indicators. A model does
 * overuse certain words. Its sentence lengths are measurably smoother than a
 * person's. It reaches for the same rhetorical shapes. Each of those is real,
 * each is weak, and every one of them has an innocent explanation — a careful
 * editor produces uniform sentences too, and a professional writer uses em
 * dashes on purpose.
 *
 * So the output is a list of measurements with their rates, and a count of how
 * many are present. Never a probability, never a label on the author.
 *
 * The intended use is the one the tool was built for: reading your own draft
 * before you send it. "Six of these are in your text, here is where" is
 * actionable. "78% AI" is not, and would not be true.
 */

/** Words and turns of phrase overrepresented in assistant prose. */
interface Tell {
  pattern: RegExp;
  /** Short label for the report. */
  label: string;
  language: 'fr' | 'en' | 'any';
  /**
   * Occurrences per thousand words below which this does not count as an
   * indicator, *and* a floor of two occurrences whatever the length.
   *
   * Distinctive phrases need neither — "a testament to" is a tell the first
   * time. Ordinary words need both: "crucial" is normal French, one of them
   * means nothing and five in a page means something. The rate alone is not
   * enough, because in a short passage a single occurrence clears any rate.
   */
  minRate?: number;
}

/**
 * The lexicon is deliberately French-first. Nearly every published detector is
 * trained on English, which makes them useless on the documents this tool
 * exists for, and makes a French list the part worth building carefully.
 */
const TELLS: Tell[] = [
  // -- French openers and connectives -------------------------------------
  { pattern: /\bil (?:est|convient de) (?:important|noter|souligner|préciser)\b/gi, label: 'il est important de noter', language: 'fr' },
  { pattern: /\b(?:en|pour) conclusion\b|\bpour conclure\b|\ben résumé\b/gi, label: 'en conclusion / en résumé', language: 'fr' },
  { pattern: /\bplonge(?:ons|r)\b|\bexplorons\b|\bdécouvrons\b/gi, label: 'plongeons / explorons', language: 'fr' },
  { pattern: /\bn'hésitez pas à\b/gi, label: "n'hésitez pas à", language: 'fr' },
  { pattern: /\bvoici (?:quelques|les principaux|un aperçu)\b/gi, label: 'voici quelques…', language: 'fr' },
  { pattern: /\bnon seulement\b[^.!?]{0,60}\bmais (?:aussi|également)\b/gi, label: 'non seulement… mais aussi', language: 'fr' },
  { pattern: /\bdans (?:le|un) (?:paysage|monde) (?:en constante évolution|numérique|actuel)\b/gi, label: 'dans le paysage…', language: 'fr' },
  { pattern: /\btémoign(?:e|age) de\b/gi, label: 'témoignage de', language: 'fr' },
  { pattern: /\bjoue un rôle (?:crucial|clé|essentiel)\b/gi, label: 'joue un rôle crucial', language: 'fr' },
  { pattern: /\b(?:crucial|primordial|incontournable|multiforme|holistique)\w*\b/gi, label: 'crucial / primordial / holistique', language: 'fr', minRate: 2 },
  { pattern: /\bque ce soit\b[^.!?]{0,50}\bou\b/gi, label: 'que ce soit… ou…', language: 'fr' },

  // -- English, since drafts are often written or pasted in it -------------
  { pattern: /\bdelve\s+into\b|\bdelving\b/gi, label: 'delve into', language: 'en' },
  { pattern: /\b(?:rich\s+)?tapestry\b/gi, label: 'tapestry', language: 'en' },
  { pattern: /\ba testament to\b/gi, label: 'a testament to', language: 'en' },
  { pattern: /\bit'?s worth noting\b|\bit is important to note\b/gi, label: "it's worth noting", language: 'en' },
  { pattern: /\bnavigat\w+ the (?:complexit|landscape|challeng)\w*/gi, label: 'navigating the complexities', language: 'en' },
  { pattern: /\bin the realm of\b|\bin today'?s (?:fast-paced|digital|ever-evolving)\b/gi, label: 'in the realm of / in today’s…', language: 'en' },
  { pattern: /\b(?:pivotal|multifaceted|meticulous|nuanced|holistic|robust|seamless)\b/gi, label: 'pivotal / multifaceted / seamless', language: 'en', minRate: 2 },
  { pattern: /\b(?:leverage|harness|foster|underscore|elevate)\w*\b/gi, label: 'leverage / harness / foster', language: 'en', minRate: 2 },
  { pattern: /\bnot just\b[^.!?]{0,50}\bit'?s\b|\bisn'?t (?:just )?about\b[^.!?]{0,50}\bit'?s about\b/gi, label: "not just X, it's Y", language: 'en' },
  { pattern: /\b(?:in conclusion|in summary|to sum up|overall,)\b/gi, label: 'in conclusion / in summary', language: 'en' },
  { pattern: /\blet'?s dive in\b|\bbuckle up\b/gi, label: "let's dive in", language: 'en' },
  { pattern: /\bi hope this helps\b|\bfeel free to\b/gi, label: 'I hope this helps / feel free to', language: 'en' },
];

export interface StyleIndicator {
  label: string;
  count: number;
  /** Occurrences per thousand words, so long and short texts compare. */
  rate: number;
}

export type StyleBand = 'too-short' | 'few' | 'several' | 'many';

export interface Stylometry {
  words: number;
  sentences: number;
  /** Mean sentence length in words. */
  meanSentence: number;
  /**
   * Coefficient of variation of sentence length — the "burstiness" of the
   * prose. People vary their sentences a lot; generated text is smoother.
   * Reported as a number because the threshold depends entirely on genre:
   * technical documentation is uniform whoever writes it.
   */
  burstiness: number;
  /** Em and en dashes per thousand words. Assistants reach for them constantly. */
  dashRate: number;
  /** Share of paragraphs that open with a bolded lead-in, a very common shape. */
  boldLeadIns: number;
  /** Type/token ratio over the first 1000 words, a standard richness measure. */
  vocabularyRichness: number;
  indicators: StyleIndicator[];
  band: StyleBand;
}

/** Below this, none of the ratios mean anything and no band is offered. */
const MINIMUM_WORDS = 120;

const WORD = /[\p{L}\p{N}'’-]+/gu;

/**
 * Split on sentence-final punctuation followed by a space and a capital, so an
 * abbreviation or a decimal does not end a sentence.
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])["'»”]?\s+(?=[«"'“]?\p{Lu})/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function stylometry(text: string): Stylometry {
  const words = text.match(WORD) ?? [];
  const wordCount = words.length;
  const perThousand = (n: number) => (wordCount ? (n * 1000) / wordCount : 0);

  const lengths = sentences(text).map((s) => (s.match(WORD) ?? []).length).filter((n) => n > 0);
  const meanSentence = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const burstiness = meanSentence ? standardDeviation(lengths, meanSentence) / meanSentence : 0;

  const dashes = (text.match(/[—–]/g) ?? []).length;

  // A paragraph opening "**Something** — ..." is the house style of every
  // assistant that has ever written a summary.
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const bolded = paragraphs.filter((p) => /^\s*(?:[-*+]\s+)?\*\*[^*\n]{2,60}\*\*/.test(p)).length;

  const sample = words.slice(0, 1000).map((w) => w.toLowerCase());
  const vocabularyRichness = sample.length ? new Set(sample).size / sample.length : 0;

  const indicators: StyleIndicator[] = [];
  for (const tell of TELLS) {
    const count = (text.match(tell.pattern) ?? []).length;
    if (count === 0) continue;
    const rate = perThousand(count);
    // Both halves of "one means nothing, several means something".
    if (tell.minRate !== undefined && (count < 2 || rate < tell.minRate)) continue;
    indicators.push({ label: tell.label, count, rate });
  }
  indicators.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    words: wordCount,
    sentences: lengths.length,
    meanSentence,
    burstiness,
    dashRate: perThousand(dashes),
    boldLeadIns: paragraphs.length ? bolded / paragraphs.length : 0,
    vocabularyRichness,
    indicators,
    band: band(wordCount, indicators, burstiness, perThousand(dashes)),
  };
}

/**
 * How many indicators are present — not how likely anything is.
 *
 * Counting is the only aggregation that stays honest here. Weighting the
 * signals into a score would imply they had been calibrated against a labelled
 * corpus, which they have not, and the number would be read as a probability
 * whatever it was called.
 */
function band(
  words: number,
  indicators: StyleIndicator[],
  burstiness: number,
  dashRate: number,
): StyleBand {
  if (words < MINIMUM_WORDS) return 'too-short';
  let present = indicators.length;
  // Sentence lengths this uniform are unusual in prose, though ordinary in
  // documentation. Below 0.35 the variation is roughly a third of the mean.
  if (burstiness > 0 && burstiness < 0.35) present++;
  if (dashRate > 4) present++;
  if (present >= 6) return 'many';
  if (present >= 2) return 'several';
  return 'few';
}
