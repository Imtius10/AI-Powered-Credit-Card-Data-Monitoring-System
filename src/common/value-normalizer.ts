export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeForComparison(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

export function canonicalizeValue(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return normalizeForComparison(value)
    .replace(/,/g, '')
    .replace(/\busd?\$?\.?/g, 'usd')
    .replace(/\btk\.?/g, 'bdt')
    .replace(/\bbdt\.?/g, 'bdt')
    .replace(/\$/g, 'usd')
    .replace(/\s*%\s*/g, '%')
    .replace(/\s+/g, ' ')
    .trim();
}

export function valuesMatch(
  left: string | null,
  right: string | null,
): boolean {
  return canonicalizeValue(left) === canonicalizeValue(right);
}

export function evidenceContainsValue(
  evidence: string,
  value: string,
): boolean {
  const normalizedEvidence = normalizeForComparison(evidence);
  const normalizedValue = normalizeForComparison(value);

  if (normalizedEvidence.includes(normalizedValue)) {
    return true;
  }

  const valueDigits = normalizedValue.match(/\d+(?:\.\d+)?/g);
  if (!valueDigits || valueDigits.length === 0) {
    return false;
  }

  const evidenceDigits = new Set(
    normalizedEvidence.match(/\d+(?:\.\d+)?/g) ?? [],
  );

  return valueDigits.every((digit) => evidenceDigits.has(digit));
}

export function isZeroValue(value: string): boolean {
  return /(?:^|[^\d])0(?:\.0+)?(?:\s*%|\s*(?:bdt|usd))?$/.test(
    normalizeForComparison(value).replace(/\s+/g, ' ').trim(),
  );
}
