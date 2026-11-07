import { CARD_FIELDS } from '../cards/card.types';
import type { CardExtraction, CardSource } from '../cards/card.types';

export const AI_SYSTEM_PROMPT = `You are a financial data extraction and verification engine.
Use ONLY the official issuer content supplied by the user. Never use prior knowledge, memory, or assumptions.
If a value is not explicitly supported by the supplied content, return null.
Never invent an APR, fee, reward, bonus, condition, or date.
Preserve exact source wording in every evidence field. Evidence must be copied verbatim from the supplied content.
Distinguish a confirmed zero from missing information: if the content explicitly states zero, return that exact zero value; if the content is silent, return null.
Return only valid JSON. Do not wrap JSON in markdown fences.`;

export const AI_VERIFICATION_SYSTEM_PROMPT = `You are an independent financial-data verifier.
Check each extracted value against the supplied official issuer content only. Do not use prior knowledge.
A field is "verified" only when the quoted evidence appears in the supplied content and directly supports the value.
Use "mismatch" when the content contradicts the extracted value.
Use "unverified" when evidence is absent, paraphrased, or does not support the value.
Use "missing" when the extracted value is null and the content does not state it.
Never treat the extracted value as proof by itself.
Return only valid JSON. Do not wrap JSON in markdown fences.`;

export function buildExtractionPrompt(
  card: Pick<CardSource, 'name' | 'issuer' | 'sourceUrl'>,
  content: string,
): string {
  return `Extract credit card data for the card identified below.

CARD NAME: ${card.name}
ISSUER: ${card.issuer}
SOURCE URL: ${card.sourceUrl}

REQUIRED JSON KEYS:
${CARD_FIELDS.join('\n')}
evidence

RULES:
1. Every non-null field must have a matching entry in "evidence".
2. Each evidence entry must be an exact sentence, row, or table cell copied from the supplied content.
3. Do not infer a value from general banking knowledge.
4. If a field is not explicitly stated, set it to null. Do not write "Not explicitly listed".
5. A confirmed zero is not missing information. Preserve it as stated (for example "0%", "BDT 0", or "No annual fee").
6. Include restrictions that materially affect a fee, APR, bonus, or benefit.
7. Keep values concise but preserve currency, percentages, and qualifiers.
8. Keep evidence snippets concise (an exact phrase, table row, or short clause max). Write on a single line; do not include raw newlines or unescaped quotes in JSON string values.

"evidence" must be an object whose keys are the field names above and whose values are the exact supporting snippets.

OFFICIAL ISSUER CONTENT:
${content}`;
}

export function buildVerificationPrompt(
  card: Pick<CardSource, 'name' | 'issuer' | 'sourceUrl'>,
  content: string,
  extraction: CardExtraction,
): string {
  return `Verify the extracted credit card data below.

CARD NAME: ${card.name}
ISSUER: ${card.issuer}
SOURCE URL: ${card.sourceUrl}

EXTRACTED JSON:
${JSON.stringify(extraction, null, 2)}

REQUIRED RESPONSE SHAPE:
{
  "overallStatus": "verified" | "needs_review",
  "fields": [
    {
      "field": "purchaseApr",
      "value": "extracted value or null",
      "evidence": "exact supporting snippet copied from the content or null",
      "status": "verified" | "unverified" | "missing" | "mismatch",
      "reason": "short explanation or null"
    }
  ],
  "notes": "optional short explanation"
}

RULES:
1. Check every requested field: ${CARD_FIELDS.join(', ')}.
2. Every "verified" field must include an exact snippet from the official content.
3. Do not rely on the extracted value as evidence.
4. Set overallStatus to "verified" only when every non-null extracted value is verified and no field is a mismatch.
5. If a value is null and the content is silent, mark that field "missing".
6. Do not add information that is not present in the content.

OFFICIAL ISSUER CONTENT:
${content}`;
}
