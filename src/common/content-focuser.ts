/**
 * Focuses and slices raw page or PDF text down to the concise section
 * relevant to a specific credit card.
 *
 * Prevents small local LLMs (e.g. 3B models) from:
 * 1. Choking on massive PDF dumps or multi-page HTML.
 * 2. Taking excessive time on prompt token evaluation (drops from 45s to ~3s).
 * 3. Getting confused by unrelated banking products (loans, accounts, other cards).
 */

export interface FocusOptions {
  maxChars?: number;
}

export function focusCardContent(
  content: string,
  cardName: string,
  cardSlug?: string,
  options: FocusOptions = {},
): string {
  const maxChars = options.maxChars ?? 3500;

  if (!content || content.length <= maxChars) {
    return content;
  }

  const stopWords = new Set([
    'bank',
    'plc',
    'credit',
    'card',
    'the',
    'and',
    'for',
    'ltd',
    'limited',
    'with',
    'from',
  ]);

  const rawKeywords = [
    ...cardName.toLowerCase().split(/[\s/-]+/),
    ...(cardSlug ? cardSlug.toLowerCase().split(/[\s/-]+/) : []),
  ];

  const keywords = Array.from(
    new Set(rawKeywords.filter((w) => w.length > 2 && !stopWords.has(w))),
  );

  const financialTerms = [
    'annual fee',
    'apr',
    'interest rate',
    'fee',
    'charge',
    'charges',
    'bdt',
    'tk',
    'usd',
    '$',
    '%',
    'bonus',
    'rewards',
    'cashback',
    'lounge',
    'renewal',
    'waiver',
    'introductory',
    'minimum payment',
    'late payment',
    'joining fee',
    'supplementary',
    'limit',
  ];

  const negativeTerms = [
    'home loan',
    'auto loan',
    'student account',
    'savings account',
    'fixed deposit',
    'sme loan',
    'remittance',
    'locker service',
  ];

  // Split into paragraphs (preferring double newlines if present)
  const rawBlocks = content.includes('\n\n')
    ? content.split(/\n{2,}/)
    : content.split(/\n/);

  const blocks = rawBlocks
    .map((b) => b.trim())
    .filter((b) => b.length > 15);

  if (blocks.length === 0) {
    return content.slice(0, maxChars);
  }

  const scoredBlocks: Array<{ index: number; score: number }> = [];
  const seenContent = new Set<string>();

  for (let i = 0; i < blocks.length; i++) {
    const text = blocks[i]!;
    const normalized = text.toLowerCase().replace(/\s+/g, ' ');
    if (seenContent.has(normalized)) {
      continue;
    }
    seenContent.add(normalized);

    const lower = text.toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      if (lower.includes(kw)) {
        score += 15;
      }
    }

    for (const term of financialTerms) {
      if (lower.includes(term)) {
        score += 4;
      }
    }

    for (const neg of negativeTerms) {
      if (lower.includes(neg)) {
        score -= 20;
      }
    }

    if (score > 0) {
      scoredBlocks.push({ index: i, score });
    }
  }

  if (scoredBlocks.length === 0) {
    return content.slice(0, maxChars);
  }

  // Sort by score descending
  scoredBlocks.sort((a, b) => b.score - a.score);

  // Pick top matched blocks and context
  const selectedIndices = new Set<number>();
  for (const match of scoredBlocks.slice(0, 8)) {
    selectedIndices.add(match.index);
    if (match.index > 0 && !negativeTerms.some((t) => blocks[match.index - 1]?.toLowerCase().includes(t))) {
      selectedIndices.add(match.index - 1);
    }
    if (match.index < blocks.length - 1 && !negativeTerms.some((t) => blocks[match.index + 1]?.toLowerCase().includes(t))) {
      selectedIndices.add(match.index + 1);
    }
  }

  const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);

  let result = '';
  const seenTexts = new Set<string>();

  for (const idx of sortedIndices) {
    const blockText = blocks[idx]!;
    const normalizedKey = blockText.toLowerCase().replace(/\s+/g, ' ');
    if (seenTexts.has(normalizedKey)) {
      continue;
    }
    seenTexts.add(normalizedKey);

    if (result.length + blockText.length + 2 > maxChars) {
      break;
    }
    result += (result ? '\n\n' : '') + blockText;
  }

  return result.length > 100 ? result : content.slice(0, maxChars);
}
